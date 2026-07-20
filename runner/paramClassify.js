// paramClassify.js — AI classification of a recording's URL params into
// "tracking/session noise" vs "real search state the user should edit".
//
// The regex denylist in server/formspec.js is a fixed, hand-maintained list —
// it only knows the tracking-param names someone already thought to add. This
// module asks an LLM to make the same judgment call per-recording, which
// generalizes to sites whose tracking param names nobody has seen yet.
// Primary path: DeepSeek. Fallback: the caller keeps using the regex denylist
// on any failure (network error, bad response, no API key) — this module
// never blocks or breaks automation creation, it only tries to do better.
const { loadEnv, chatJSON, extractJsonArray } = require('./structure');

// stepLabels (the recording's own recorded action labels, e.g. "Kuala Lumpur
// Malaysia", "Malaysian Ringgit MYR") give the AI the context url-diffing
// alone can't provide. A url param the user actually set (destination,
// currency, a filter) and a param that's just page-load default chrome
// (language, a display-only entity-type code) both first appear in the exact
// same url transition (the search navigation) and never change again during
// the recording — structurally indistinguishable from the url alone. Seeing
// what the user's recorded clicks/inputs actually were is the only way to
// tell "this corresponds to something you did" from "this is just chrome".
function buildPrompt(paramMap, siteDomain, stepLabels = []) {
  const lines = Object.entries(paramMap).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  const context = stepLabels.length
    ? `\n\nThe user's recorded actions on this page, in order, were: ${stepLabels.join(', ')}.`
    : '';
  return (
    `These are the query parameters on a search-results url from ${siteDomain}. ` +
    'Return a JSON array containing ONLY the parameter names that are tracking, ' +
    'analytics, session, affiliate/marketing identifiers, or page-load defaults ' +
    "(language, locale, currency, or similar) that don't correspond to any of " +
    'the user\'s recorded actions below — NOT parameters that represent real ' +
    'search state the user actually set (destination, dates, guest counts, ' +
    'filters, sort order, a currency/language the user explicitly picked, etc). ' +
    'Return ONLY a JSON array of strings, no prose.' +
    context +
    '\n\n' +
    lines.join('\n')
  );
}

// Keeps only names that were actually in the original key list — an LLM
// hallucinating a key that was never a param would otherwise corrupt the form.
function parseClassification(content, originalKeys) {
  const arr = extractJsonArray(content);
  if (!arr) throw new Error('no parseable JSON array in response');
  const known = new Set(originalKeys);
  return new Set(arr.filter((k) => known.has(k)));
}

async function callDeepSeek(paramMap, siteDomain, stepLabels, apiKey, opts = {}) {
  const prompt = buildPrompt(paramMap, siteDomain, stepLabels);
  const content = await chatJSON('You classify url query parameters and reply with JSON only.', prompt, apiKey, opts);
  return parseClassification(content, Object.keys(paramMap));
}

// Returns a Set of tracking-param keys, or null if AI classification wasn't
// available/failed — the caller falls back to the regex denylist on null.
async function classifyTrackingParams(paramMap, siteDomain, stepLabels = [], opts = {}) {
  loadEnv(opts.envDir || process.cwd());
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || !Object.keys(paramMap).length) return null;
  try {
    return await callDeepSeek(paramMap, siteDomain, stepLabels, key, opts);
  } catch {
    return null;
  }
}

module.exports = { classifyTrackingParams, buildPrompt, parseClassification };
