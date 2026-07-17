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
const { buildReplayUrl, isUrlDriven } = require('../extension/lib/replay');
const { scrapeCards } = require('./scrape');
const { structureResults } = require('./structure');

function finalUrl(recording) {
  const steps = (recording && recording.steps) || [];
  return steps.length ? steps[steps.length - 1].url : null;
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
    default:
      await page.click(sel);
  }
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
    const value = step.selector in newValues ? newValues[step.selector] : step.value;
    try {
      await applyStep(page, step, value);
      log.push({ id: step.id, selector: step.selector, ok: true });
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

    if (isUrlDriven(recording)) {
      const target = buildReplayUrl(finalUrl(recording), newValues);
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

    if (opts.scrape) {
      const cards = await scrapeCards(page, { max: opts.maxCards || 30 });
      const structured = await structureResults(cards, { envDir: opts.envDir || process.cwd() });
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
