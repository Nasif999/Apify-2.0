// replay-runner.js — the Phase 2 hybrid replay engine (Node + Playwright).
//
// Given a recording (from the extension) and a map of new values, it either:
//   - URL-replay: navigates a parameterized version of the recorded final URL
//     (for URL-driven sites like booking/youtube), or
//   - step-replay: re-executes the recorded steps with Playwright, substituting
//     new values (for sites that don't encode state in the URL).
//
// This is Node-only (uses playwright). The pure decision logic lives in
// ../extension/lib/replay.js and is shared/tested separately.
const { chromium } = require('playwright');
const {
  buildReplayUrl,
  isUrlDriven,
  auxiliarySteps,
  stripResolvedIdParams,
  resolveStepForReplay,
  needsSearchSubmitFallback,
} = require('../extension/lib/replay');
const { scrapeCards } = require('./scrape');
const { structureResults, loadEnv } = require('./structure');
const { shouldRescue, extractFromPage } = require('./pageExtract');
const { dismissPopups } = require('./popups');

function finalUrl(recording) {
  const steps = (recording && recording.steps) || [];
  return steps.length ? steps[steps.length - 1].url : null;
}

// Step down the page in viewport-sized increments, pausing after each so
// lazy-loaded images have a chance to swap in their real `src` before we
// scrape. Generic — works on any site's infinite/lazy-loading list. Does NOT
// scroll back to the top afterward: some sites unload/blank an image's `src`
// again once it leaves the viewport (to save memory on long result lists),
// so scrolling back up can undo progress already made. Scraping reads the
// whole document regardless of scroll position, so there's no need to.
async function autoScroll(page, steps = 8, opts = {}) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    // A capped per-step wait — worst case (a permanently-broken image that
    // never crosses the loaded threshold) must not multiply out to minutes
    // across several steps.
    // waitForFunction's real signature is (pageFunction, arg, options) — the
    // options object must go in the THIRD slot, or Playwright treats it as
    // `arg` (silently ignored by this zero-param predicate) and falls back
    // to its own 30s default timeout instead of the one requested here.
    await page
      .waitForFunction(
        () => {
          const imgs = Array.from(document.querySelectorAll('img'));
          if (!imgs.length) return true;
          const loaded = imgs.filter((im) => im.complete && im.naturalWidth > 0).length;
          return loaded / imgs.length > 0.8;
        },
        undefined,
        { timeout: 1500 }
      )
      .catch(() => {});
    // Requested output count drives how many steps this loop was given
    // (scrollSteps below), but that count is sized for the WORST case (a
    // slow, deeply-paginated site). Most sites have enough cards on-page well
    // before the last step — checking after each step and stopping the
    // moment enough real cards already exist trims the wasted tail of
    // scroll+settle cycles without ever cutting a scroll short: it only ever
    // stops EARLY when the target is already met, never skips scrolling that
    // was still needed to reach it.
    if (opts.enoughCards && (await opts.enoughCards().catch(() => false))) break;
  }
  // A network-quiet wait is a real completion signal (no more in-flight
  // image requests) rather than hoping a fixed delay was long enough.
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
}

// Apply one recorded step to the page, using `value` (already substituted).
async function applyStep(page, step, value) {
  const sel = step.selector;
  switch (step.fieldType) {
    case 'text':
      await page.fill(sel, String(value ?? ''));
      return;
    case 'dropdown':
      // Try by visible label first, then by value.
      try {
        await page.selectOption(sel, { label: String(value) });
      } catch {
        await page.selectOption(sel, String(value));
      }
      return;
    case 'tickmark': {
      // On sites like booking.com, ticking a filter checkbox triggers a FULL
      // page navigation (new URL with the filter's nflt param), not an
      // in-place AJAX update -- confirmed live: each recorded filter step's
      // own url already carries the previous filter's nflt value, meaning
      // the click before it caused a real navigation. Firing the next
      // filter's check() immediately (previous behavior) raced that
      // navigation: the click could land on the page an instant before it
      // got torn down, so the event never reached the server and that
      // filter silently failed to apply -- symptom: only some of several
      // ticked filters actually landed in the final URL. Racing the
      // check/uncheck against a navigation wait (same pattern as 'submit')
      // lets it settle whichever way this particular filter behaves: sites
      // that navigate get the built-in wait, sites that update in place
      // just hit the timeout harmlessly.
      const action = value ? page.check(sel) : page.uncheck(sel);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        action,
      ]);
      return;
    }
    case 'calendar':
      // Native date input: fill. Custom picker: best-effort click to open it.
      try {
        await page.fill(sel, String(value ?? ''));
      } catch {
        await page.click(sel);
      }
      return;
    case 'stepper':
      // Known Phase-2 gap: recorded steppers share a selector and carry no count,
      // so we can only re-click once. URL-driven recordings avoid this path.
      await page.click(sel);
      return;
    case 'submit':
      // Enter-to-submit (search boxes) — fires no click/change during recording,
      // so it's captured as its own step. Replay it and wait for the navigation
      // it triggers before moving on.
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        page.press(sel, 'Enter'),
      ]);
      return;
    default:
      await page.click(sel);
  }
}

// Resolve a step for replay (substituting Enter-submit for a default/trending
// suggestion pick when applicable — see resolveStepForReplay) and compute its
// effective value. Override lookup stays keyed on the ORIGINAL step: only it
// could ever be a real form field the user set; a substituted step is
// synthetic and was never exposed as one.
function resolveAndOverride(allSteps, step, newValues) {
  const resolved = resolveStepForReplay(allSteps, step, newValues);
  const idKey = String(step.id);
  let value = resolved.value;
  if (idKey in newValues) value = newValues[idKey];
  else if (step.selector in newValues) value = newValues[step.selector];
  return { resolved, value };
}

// A null/undefined value means "leave this field alone for this run" (the
// automation.html pause toggle, or an unticked filter). For a checkbox that's
// naturally an uncheck, but for text/dropdown/calendar/stepper actually
// CALLING applyStep with null is actively harmful: text/calendar fill '' onto
// a page that otherwise would have shown its own default, dropdown throws
// trying to select option "null", and a stepper still clicks (nothing to
// "empty" for a counter). Skipping the step outright — no interaction at all —
// is the one behavior that's correct for every field type, and is also
// cheaper: it can't hang on a locator timeout the way a doomed applyStep call
// could (see auxiliarySteps' timeout-budget note).
async function applyStepOrSkip(page, resolved, value, log, id) {
  if (value == null) {
    log.push({ id, selector: resolved.selector, ok: 'skipped' });
    return;
  }
  try {
    await applyStep(page, resolved, value);
    log.push({ id, selector: resolved.selector, ok: true });
  } catch (e) {
    log.push({ id, selector: resolved.selector, ok: false, error: e.message });
  }
}

// Replay recorded DOM interactions (filter checkboxes, sort dropdowns —
// anything with a real field type) on the CURRENT page, without navigating.
// Used after URL-replay, whose navigation already produced the page these
// steps were originally recorded on.
async function applyAuxiliarySteps(page, recording, newValues) {
  const allSteps = recording.steps || [];
  const steps = auxiliarySteps(recording);
  const log = [];
  for (const step of steps) {
    const { resolved, value } = resolveAndOverride(allSteps, step, newValues);
    await applyStepOrSkip(page, resolved, value, log, step.id);
    // Filter checkboxes on sites like booking.com trigger an async AJAX
    // re-render of the results list on each click. Firing the next click
    // immediately can hit the page mid-re-render (element detached/covered
    // by a loading overlay), so the click silently no-ops or throws and
    // gets logged ok:false -- symptom: "not all filters get clicked" even
    // though every step ran. Give the page a moment to settle between
    // clicks so each selector is actionable when it's used.
    if (value != null) {
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    }
  }
  return log;
}

// Live-verified-only (Playwright DOM interaction, not unit-tested — see
// pageExtract.js's extractFromPage for the same convention). Recovers the
// navigation a bare text-fill step never captured (see
// needsSearchSubmitFallback). A blind ArrowDown+Enter isn't safe here:
// twitter-typeahead's built-in Bloodhound matcher does fuzzy SUBSEQUENCE
// matching, not prefix filtering -- confirmed live on AmarStock typing "ACI",
// the top suggestion was "ACHIASF" (A...C...I appear in order, just not
// adjacent), so blind-arrowing landed on the wrong stock entirely. Preferring
// a suggestion whose own text is an EXACT match for what was typed fixes
// that; ArrowDown+Enter (accept whatever the widget ranks first) is the
// fallback for widgets that don't expose this class, or when nothing typed
// matches exactly.
// Broad, no-site-hints selector for a typeahead/autosuggest option row --
// twitter-typeahead's `.tt-suggestion`, react-autosuggest's
// `.react-autosuggest__suggestion`, and any ARIA-correct combobox
// (`[role="option"]`) all match, so this generalizes across widgets we never
// tuned for instead of hardcoding one library's class name.
const SUGGESTION_SELECTOR =
  '.tt-suggestion .s, .tt-suggestion, .react-autosuggest__suggestion, [role="option"], li[role="option"]';

// Click whichever rendered suggestion's own text exactly matches `needle`,
// falling back to ArrowDown+Enter (accept the widget's own top pick) when
// nothing matches exactly. Shared by submitSearchFallback (no click was ever
// captured) and stepReplay's forTextId handling (a click WAS captured, but
// for a different query than this run is using) -- same problem either way:
// find the right suggestion live, don't trust a selector recorded against a
// different search's DOM.
async function clickMatchingSuggestion(page, selector, needle) {
  await page.waitForTimeout(400); // let the suggestion dropdown render
  const trimmed = String(needle).trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The ticker/label is usually its own child span (twitter-typeahead's `.s`,
  // or a generic first child) inside the option row -- matching THAT exactly
  // (not the whole row's concatenated text, which also contains the full
  // name and would match any suggestion merely starting with the same
  // letters) is what tells "ACI" apart from "ACIFORMULA".
  const exactLabel = page
    .locator(SUGGESTION_SELECTOR)
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i') })
    .first();
  if (await exactLabel.count().catch(() => 0)) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
      exactLabel.click().catch(() => {}),
    ]);
    return true;
  }
  await page.press(selector, 'ArrowDown').catch(() => {});
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
    page.press(selector, 'Enter').catch(() => {}),
  ]);
  return false;
}

async function submitSearchFallback(page, selector, value) {
  await clickMatchingSuggestion(page, selector, value);
}

async function stepReplay(page, recording, newValues, opts) {
  const steps = recording.steps || [];
  let lastUrl = null;
  const log = [];
  for (const step of steps) {
    if (step.url && step.url !== lastUrl) {
      await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      lastUrl = step.url;
    }
    const { resolved, value } = resolveAndOverride(steps, step, newValues);
    // A click the recorder linked to a preceding text fill (forTextId — a
    // suggestion picked from a search box's dropdown) was recorded against
    // THAT search's DOM. Replaying it as a blind click-by-selector only ever
    // reproduces the exact original query by luck of the widget re-rendering
    // suggestions in the same DOM shape; the moment this run's value differs
    // from what was typed at record time (a new title, a new ticker) the
    // stale selector points at a suggestion for the WRONG query, or at
    // nothing at all. Re-searching live for whichever suggestion's own text
    // matches this run's effective value (the override if the linked field
    // was overridden, else the exact title/label originally clicked) is the
    // same fix already proven for the "no click captured at all" case (see
    // submitSearchFallback) — just applied to the "a click was captured, for
    // a possibly different query" case too.
    if (resolved.forTextId != null) {
      const linkedStep = steps.find((s) => s.id === resolved.forTextId);
      const idKey = linkedStep ? String(linkedStep.id) : null;
      const overridden = !!linkedStep && (idKey in newValues || linkedStep.selector in newValues);
      const linkedValue = linkedStep ? resolveAndOverride(steps, linkedStep, newValues).value : null;
      const needle = overridden ? linkedValue : step.value || linkedValue;
      if (needle != null) {
        const clickSelector = linkedStep ? linkedStep.selector : resolved.selector;
        const ok = await clickMatchingSuggestion(page, clickSelector, needle).catch(() => false);
        log.push({ id: step.id, selector: resolved.selector, ok });
      } else {
        log.push({ id: step.id, selector: resolved.selector, ok: 'skipped' });
      }
    } else {
      await applyStepOrSkip(page, resolved, value, log, step.id);
    }
    if (needsSearchSubmitFallback(steps) && value != null) {
      await submitSearchFallback(page, resolved.selector, value);
    }
  }
  await page.waitForTimeout(opts.settleMs != null ? opts.settleMs : 1500);
  return { mode: 'step', steps: log, finalUrl: page.url(), title: await page.title() };
}

// Replay a recording. `newValues`:
//   - URL-replay: keyed by URL query-param name (e.g. { ss: 'Dhaka', checkin: '...' })
//   - step-replay: keyed by step selector
// A realistic desktop context reduces anti-bot interstitials that fire on the
// default headless fingerprint.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function replay(recording, newValues = {}, opts = {}) {
  const headless = opts.headless !== false;
  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 800 },
      locale: 'en-GB',
      timezoneId: 'Asia/Dhaka',
    });
    const page = await context.newPage();
    let result;
    // Real, coarse-grained progress: each call marks a stage the run has
    // actually reached (not a smoothed/simulated clock). No-op by default so
    // every existing caller/test is unaffected.
    const report = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

    report('navigating', 5);
    if (!opts.forceSteps && isUrlDriven(recording)) {
      const target = stripResolvedIdParams(buildReplayUrl(finalUrl(recording), newValues));
      const resp = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Wait for a content signal if given (e.g. results cards), else settle.
      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: opts.waitTimeout || 20000 }).catch(() => {});
      }
      await page.waitForTimeout(opts.settleMs != null ? opts.settleMs : 4000);
      result = {
        mode: 'url',
        target,
        status: resp ? resp.status() : null,
        finalUrl: page.url(),
        title: await page.title(),
      };
    } else {
      result = await stepReplay(page, recording, newValues, opts);
    }

    // Dismiss blocking overlays (cookie/consent/sign-in modals) before scraping.
    if (opts.dismissPopups !== false) {
      result.dismissedPopups = await dismissPopups(page).catch(() => 0);
    }

    // A URL-driven search commonly has post-search refinement layered on top
    // (filter checkboxes, sort dropdowns) that the URL never encodes — those
    // steps were recorded but ignored until now. Replay them here, on the
    // page the URL navigation already produced.
    if (result.mode === 'url') {
      report('applying filters', 15);
      result.auxSteps = await applyAuxiliarySteps(page, recording, newValues);
      // Aux steps (filter checkboxes) can navigate the page (see
      // applyStep's 'tickmark' case) — result.finalUrl was captured right
      // after the initial goto, before any of that ran, so it always
      // reported the pre-filter URL even when every filter applied
      // correctly. Refresh it so callers/debugging see what the page
      // actually ended up on.
      result.finalUrl = page.url();
    }

    if (opts.scrape) {
      // Many sites lazy-load thumbnails AND only render more results as you
      // scroll (infinite scroll) — the deeper the requested output count, the
      // further down the page needs to be walked before that many results
      // (and their images) even exist in the DOM to scrape.
      const maxCards = opts.maxCards || 30;
      const scrollSteps = Math.min(25, Math.max(8, Math.ceil(maxCards / 2)));
      report('loading results', 20);
      await autoScroll(page, scrollSteps, {
        enoughCards: async () => (await scrapeCards(page, { max: maxCards })).length >= maxCards,
      }).catch(() => {});
      report('scraping', 30);
      const cards = await scrapeCards(page, { max: maxCards });
      report(opts.ai ? 'extracting with AI' : 'extracting', 40);
      const structured = await structureResults(cards, {
        envDir: opts.envDir || process.cwd(),
        ai: opts.ai,
        values: newValues,
        notes: opts.notes,
        domain: (() => {
          try {
            return new URL(page.url()).hostname;
          } catch {
            return null;
          }
        })(),
      });
      report('finalizing', 90);
      result.results = structured.results;
      result.engine = structured.engine;
      result.summary = structured.summary;
      if (opts.includeRaw) result.rawCards = cards;

      // Generalization rescue: the card detector above only recognizes results
      // shaped as a link wrapping an image + digit-bearing text. When that
      // shape doesn't fit a site (text-only lists, tables, thumbnail-less
      // job/news/wiki results, search engines) it returns nothing, a single
      // over-climbed blob, or duplicates. In those cases fall back to
      // extracting from the whole rendered page via LLM, which assumes no
      // structure. Only runs on AI runs that came up short — tuned sites keep
      // their fast, free path untouched. Best-effort: any failure leaves the
      // original results in place.
      if (opts.ai && shouldRescue(result.results, maxCards)) {
        loadEnv(opts.envDir || process.cwd());
        const key = process.env.DEEPSEEK_API_KEY;
        if (key) {
          try {
            const rescued = await extractFromPage(page, {
              apiKey: key,
              values: newValues,
              notes: opts.notes,
              maxCards,
            });
            if (rescued.results.length > result.results.length) {
              result.results = rescued.results.slice(0, maxCards);
              result.engine = rescued.engine;
            }
            // A synthesized write-up is strictly additive value — adopt it
            // whenever the rescue found one and the card path didn't, even if
            // the rescue's item count didn't win (a page can be short on
            // browsable items yet still have a perfectly good single answer).
            if (rescued.summary && !result.summary) result.summary = rescued.summary;
          } catch {
            /* keep original results — rescue is best-effort */
          }
        }
      }
    }

    if (opts.screenshotPath) {
      await page.screenshot({ path: opts.screenshotPath }).catch(() => {});
      result.screenshotPath = opts.screenshotPath;
    }
    return result;
  } finally {
    await browser.close();
  }
}

module.exports = { replay, finalUrl, applyStep, stepReplay };
