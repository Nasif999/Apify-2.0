// fieldNaming.js — AI suggests a friendlier name per form field (e.g. turn
// "stepper"/"stepper" x3 into "Adults"/"Children"/"Infants").
//
// Purely additive/optional, unlike paramClassify.js's exclusion-based
// tracking classifier: a bad or missing AI suggestion for a field just means
// that field keeps its current (heuristic-derived) name — it can never lose
// a field or hide real data the way an exclusion-based classifier could.
// That's a structurally safer shape, chosen deliberately after the
// tracking-param classifier once excluded every real field on a bad answer.
const { chatJSON, loadEnv } = require('./structure');

// A field's captured context (see extension/lib/context.js) is often the ONLY
// thing that identifies an icon-only control: the button says nothing, but the
// "Adults" text beside it and its data-testid say everything. Fold whatever
// was captured into the prompt.
function contextLine(ctx) {
  if (!ctx) return '';
  const bits = [];
  const attrs = ctx.attrs || {};
  const notable = Object.entries(attrs)
    .filter(([k]) => k !== 'class' && k !== 'style')
    .map(([k, v]) => `${k}=${v}`);
  if (notable.length) bits.push(`attrs: ${notable.join(' ')}`);
  if (ctx.nearbyText) bits.push(`nearby text: "${ctx.nearbyText}"`);
  if (ctx.options && ctx.options.length) bits.push(`options: ${ctx.options.join('/')}`);
  if (ctx.ancestors && ctx.ancestors.length) bits.push(`inside: ${ctx.ancestors.join(' < ')}`);
  return bits.length ? `\n    ${bits.join('\n    ')}` : '';
}

function buildNamingPrompt(fields, siteDomain, stepLabels = []) {
  const lines = fields.map(
    (f) => `${f.key}: currently named "${f.name}" (type: ${f.type}, value: ${JSON.stringify(f.value)})${contextLine(f.context)}`
  );
  const context = stepLabels.length
    ? `\n\nThe user's recorded actions on this page, in order, were: ${stepLabels.join(', ')}.`
    : '';
  return (
    `These are form fields derived from a browser automation recorded on ${siteDomain}. ` +
    'Some have unhelpful names (blank, or just the bare field type like "stepper" or ' +
    '"dropdown") because the page gave no usable label. Suggest a short, human-readable ' +
    "name for each field you can meaningfully improve, using the field's type/value and " +
    'the user\'s recorded actions for context (e.g. three "stepper" fields following a ' +
    'destination search are very likely passenger counts: Adults/Children/Infants). ' +
    "Skip any field whose current name is already clear — don't rename it. Return ONLY a " +
    'JSON object mapping field key to suggested name, no prose.' +
    context +
    '\n\n' +
    lines.join('\n')
  );
}

// Keeps only keys that exist in the field list (a hallucinated key would
// otherwise silently do nothing since applyNamingSuggestions only looks up
// by real field key anyway, but validating here keeps the contract explicit)
// and drops empty/blank suggested names.
function parseNamingSuggestions(content, fieldKeys) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : content;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no parseable JSON object in response');
  const obj = JSON.parse(body.slice(start, end + 1));
  const known = new Set(fieldKeys);
  const out = {};
  for (const [key, name] of Object.entries(obj)) {
    if (!known.has(key)) continue;
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

// Returns a NEW fields array with `.name` overridden wherever a valid
// suggestion exists for that key; every other field is unchanged. Passing an
// empty/null suggestions map is a safe identity no-op.
function applyNamingSuggestions(fields, suggestions) {
  if (!suggestions) return fields;
  return fields.map((f) => (suggestions[f.key] ? { ...f, name: suggestions[f.key] } : f));
}

async function callDeepSeek(fields, siteDomain, stepLabels, apiKey, opts = {}) {
  const prompt = buildNamingPrompt(fields, siteDomain, stepLabels);
  const content = await chatJSON(
    'You suggest human-readable form field names and reply with JSON only.',
    prompt,
    apiKey,
    opts
  );
  return parseNamingSuggestions(content, fields.map((f) => f.key));
}

// Returns the suggestions object, or null if AI naming wasn't available/failed
// — the caller keeps every field's original name on null (applyNamingSuggestions(fields, null) is a no-op).
async function suggestFieldNames(fields, siteDomain, stepLabels = [], opts = {}) {
  loadEnv(opts.envDir || process.cwd());
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || !fields.length) return null;
  try {
    return await callDeepSeek(fields, siteDomain, stepLabels, key, opts);
  } catch {
    return null;
  }
}

module.exports = { buildNamingPrompt, parseNamingSuggestions, applyNamingSuggestions, suggestFieldNames };
