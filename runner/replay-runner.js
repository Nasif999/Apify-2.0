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
} = require('../extension/lib/replay');
const { scrapeCards } = require('./scrape');
const { structureResults } = require('./structure');
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
async function autoScroll(page, steps = 8) {
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
    case 'tickmark':
      if (value) await page.check(sel);
      else await page.uncheck(sel);
      return;
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
    try {
      await applyStep(page, resolved, value);
      log.push({ id: step.id, selector: resolved.selector, ok: true });
    } catch (e) {
      log.push({ id: step.id, selector: resolved.selector, ok: false, error: e.message });
    }
  }
  return log;
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
    try {
      await applyStep(page, resolved, value);
      log.push({ id: step.id, selector: resolved.selector, ok: true });
    } catch (e) {
      log.push({ id: step.id, selector: step.selector, ok: false, error: e.message });
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
      result.auxSteps = await applyAuxiliarySteps(page, recording, newValues);
    }

    if (opts.scrape) {
      // Many sites lazy-load thumbnails AND only render more results as you
      // scroll (infinite scroll) — the deeper the requested output count, the
      // further down the page needs to be walked before that many results
      // (and their images) even exist in the DOM to scrape.
      const maxCards = opts.maxCards || 30;
      const scrollSteps = Math.min(25, Math.max(8, Math.ceil(maxCards / 2)));
      await autoScroll(page, scrollSteps).catch(() => {});
      const cards = await scrapeCards(page, { max: maxCards });
      const structured = await structureResults(cards, {
        envDir: opts.envDir || process.cwd(),
        ai: opts.ai,
        values: newValues,
        domain: (() => {
          try {
            return new URL(page.url()).hostname;
          } catch {
            return null;
          }
        })(),
      });
      result.results = structured.results;
      result.engine = structured.engine;
      if (opts.includeRaw) result.rawCards = cards;
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
