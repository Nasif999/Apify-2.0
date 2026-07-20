// domscanFilter.js — AI judgment layer on top of domscan.js's raw candidates:
// which unrecorded interactive elements are actually meaningful fields
// (filters, search inputs) vs. page chrome (nav links, ad close buttons,
// cookie banners) that classify.js's heuristics alone can't tell apart.
// Flag-only: this never adds fields to a form by itself, it only produces
// the list shown to the user as a suggestion (see server/domscanRunner.js).
const { chatJSON, extractJsonArray } = require('./structure');

function buildScanPrompt(candidates, siteDomain) {
  const lines = candidates.map((c, i) => `${i + 1}. ${c.label} (${c.fieldType})`);
  return (
    `These are interactive elements found on a page from ${siteDomain} that a ` +
    "browser-automation recording did NOT capture. Return a JSON array of the " +
    'NUMBERS of the ones that look like meaningful user-facing search fields ' +
    'or filters — NOT navigation links, ads, cookie banners, sign-in prompts, ' +
    'or other page chrome. Return ONLY a JSON array of numbers, no prose.\n\n' +
    lines.join('\n')
  );
}

// Matches by 1-based index, not by echoing the label text back: an LLM asked
// to copy a label "verbatim" routinely trims trailing detail anyway (e.g.
// booking.com's "Free WiFi: 217 properties" came back as just "Free WiFi" in
// testing) — text matching against arbitrary paraphrased output is
// fundamentally unreliable. A number can't be paraphrased. Out-of-range or
// non-integer indices (hallucinated or malformed) are silently dropped.
function parseScanFilter(content, candidates) {
  const arr = extractJsonArray(content);
  if (!arr) throw new Error('no parseable JSON array in response');
  const kept = [];
  for (const n of arr) {
    if (Number.isInteger(n) && n >= 1 && n <= candidates.length) kept.push(candidates[n - 1]);
  }
  return kept;
}

// Returns the AI-filtered candidate list, or null if AI classification wasn't
// available/failed — the caller falls back to the full unfiltered list.
async function filterMeaningfulCandidates(candidates, siteDomain, apiKey, opts = {}) {
  if (!candidates.length) return candidates;
  try {
    const prompt = buildScanPrompt(candidates, siteDomain);
    const content = await chatJSON(
      'You identify meaningful form fields on a webpage and reply with JSON only.',
      prompt,
      apiKey,
      opts
    );
    return parseScanFilter(content, candidates);
  } catch {
    return null;
  }
}

module.exports = { buildScanPrompt, parseScanFilter, filterMeaningfulCandidates };
