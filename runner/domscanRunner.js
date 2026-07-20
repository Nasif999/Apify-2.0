// domscanRunner.js — Playwright glue for the opt-in "scan for missed fields"
// QA step: loads the recorded page for real, finds interactive elements the
// recording didn't capture (domscan.js), narrows them with AI (domscanFilter.js).
// Not unit tested — same convention as scrape.js/replay-runner.js (a real
// browser launch has no meaningful jsdom equivalent); verified live instead.
// Never blocks or fails automation creation: any error here should be caught
// by the caller and treated as "no warnings".
const path = require('path');
const { chromium } = require('playwright');
const { loadEnv } = require('./structure');
const { filterMeaningfulCandidates } = require('./domscanFilter');

function finalUrl(recording) {
  const steps = (recording && recording.steps) || [];
  return steps.length ? steps[steps.length - 1].url : null;
}

function recordedSelectors(recording) {
  return ((recording && recording.steps) || []).map((s) => s.selector).filter(Boolean);
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Returns { warnings: [{label, fieldType}], engine: 'ai'|'heuristic' }.
async function scanForMissedFields(recording, opts = {}) {
  loadEnv(opts.envDir || process.cwd());
  const url = finalUrl(recording);
  if (!url) return { warnings: [], engine: 'heuristic' };

  const browser = await chromium.launch({ headless: opts.headless !== false });
  let rawCandidates;
  try {
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(opts.settleMs != null ? opts.settleMs : 2000);

    await page.addScriptTag({ path: path.join(__dirname, '../extension/lib/classify.js') });
    await page.addScriptTag({ path: path.join(__dirname, '../extension/lib/label.js') });
    await page.addScriptTag({ path: path.join(__dirname, 'domscan.js') });

    rawCandidates = await page.evaluate((selectors) => {
      const candidates = window.ApifyDomscan.findInteractiveCandidates(document);
      const diffed = window.ApifyDomscan.diffCandidates(candidates, selectors);
      // el is a live DOM node — not serializable across the evaluate boundary.
      return diffed.map((c) => ({ label: c.label, fieldType: c.fieldType }));
    }, recordedSelectors(recording));
  } finally {
    await browser.close();
  }

  const key = process.env.DEEPSEEK_API_KEY;
  const site = (recording.sites && recording.sites[0]) || '';
  if (key && rawCandidates.length) {
    const filtered = await filterMeaningfulCandidates(rawCandidates, site, key, opts);
    if (filtered) return { warnings: filtered, engine: 'ai' };
  }
  return { warnings: rawCandidates, engine: 'heuristic' };
}

module.exports = { scanForMissedFields };
