// compoundFields.js — AI splits a single url param that packs several values
// into one delimited string (e.g. gozayaan.com's trips=DAC,CXB,2026-07-21,
// CXB,DAC,2026-08-03 encodes from/to/depart/return-from/return-to/return-date)
// into per-position labeled sub-inputs the user can edit individually.
//
// SAFETY: the rejoin (done client-side in automation.html) is pure
// position-swap — same delimiter, same slot count, only the values change.
// So the guard here is strict: a split is only accepted if its label count
// EXACTLY matches the recorded value's delimiter-slot count. A mismatched
// split would scramble the value on rejoin (silently searching a wrong
// route/date), so it's rejected and the field stays whole. Purely additive
// like the naming overlay: a rejected/absent split just leaves the single
// raw field, never loses data.
const { chatJSON } = require('./structure');

function buildCompoundPrompt(urlFields, siteDomain, stepLabels = []) {
  const lines = urlFields.map((f) => `${f.key}: ${JSON.stringify(f.value)}`);
  const context = stepLabels.length
    ? `\n\nThe user's recorded actions on this page, in order, were: ${stepLabels.join(', ')}.`
    : '';
  return (
    `These are url query parameters from a search on ${siteDomain}. Some pack ` +
    'several distinct values into one delimited string (e.g. a flight "trips" ' +
    'param may encode origin, destination, and dates joined by commas). For ' +
    'EACH such compound parameter, return its delimiter and an ordered list of ' +
    'short human-readable labels — EXACTLY ONE label per delimiter-separated ' +
    'slot, in order. Skip parameters that hold a single value. Return ONLY a ' +
    'JSON object mapping parameter name to {"delimiter": "...", "labels": [...]}, ' +
    'no prose.' +
    context +
    '\n\n' +
    lines.join('\n')
  );
}

// Validates each proposed split against the field's actual value: the label
// count must equal the number of delimiter-separated slots, or the split is
// dropped (kept whole) so the position-swap rejoin can never scramble it.
function parseCompoundSplit(content, fields) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : content;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no parseable JSON object in response');
  const obj = JSON.parse(body.slice(start, end + 1));
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  const out = {};
  for (const [key, spec] of Object.entries(obj)) {
    const field = byKey[key];
    if (!field || !spec || typeof spec.delimiter !== 'string' || !Array.isArray(spec.labels)) continue;
    const slots = String(field.value).split(spec.delimiter);
    if (slots.length < 2) continue; // single value — nothing to split
    if (spec.labels.length !== slots.length) continue; // would not round-trip — reject
    out[key] = { delimiter: spec.delimiter, labels: spec.labels.map(String) };
  }
  return out;
}

// Returns a NEW fields array with each matched url field converted to a
// `compound` field carrying per-position { label, value } parts. Every other
// field is unchanged. Empty/null splits is a safe identity no-op.
function applyCompoundSplit(fields, splits) {
  if (!splits) return fields;
  return fields.map((f) => {
    const split = splits[f.key];
    if (!split) return f;
    const values = String(f.value).split(split.delimiter);
    const parts = split.labels.map((label, i) => ({ label, value: values[i] }));
    return { ...f, type: 'compound', delimiter: split.delimiter, parts };
  });
}

async function callDeepSeek(urlFields, siteDomain, stepLabels, apiKey, opts = {}) {
  const prompt = buildCompoundPrompt(urlFields, siteDomain, stepLabels);
  const content = await chatJSON(
    'You split compound url parameters into labeled parts and reply with JSON only.',
    prompt,
    apiKey,
    opts
  );
  return parseCompoundSplit(content, urlFields);
}

// Returns the splits object, or null if AI wasn't available/failed — the
// caller then leaves every field whole (applyCompoundSplit(fields, null) is a no-op).
async function suggestCompoundSplits(fields, siteDomain, stepLabels = [], opts = {}) {
  const { loadEnv } = require('./structure');
  loadEnv(opts.envDir || process.cwd());
  const key = process.env.DEEPSEEK_API_KEY;
  // Only url fields whose value actually contains a plausible delimiter are
  // worth asking about — a single-token value can never be compound.
  const candidates = fields.filter((f) => f.type === 'url' && /[,;|]/.test(String(f.value)));
  if (!key || !candidates.length) return null;
  try {
    return await callDeepSeek(candidates, siteDomain, stepLabels, key, opts);
  } catch {
    return null;
  }
}

module.exports = { buildCompoundPrompt, parseCompoundSplit, applyCompoundSplit, suggestCompoundSplits };
