// fieldEdits.js — user/AI curation of an automation's derived form.
//
// deriveFormSpec (formspec.js) turns a recording into a raw field list, but on
// real sites that list leaks junk (opaque url params shown as editable boxes)
// and can't tell an on/off filter (swimming pool, free cancellation) from a
// real input (destination, dates). This module layers per-field overrides on
// top of the canonical formspec — hide a field, mark it a filter, rename it —
// applied on read so the recording and the run path are never touched.
//
// Pure functions here are unit-tested; the two thin async wrappers just call
// the shared DeepSeek helper and are live-verified (same split as structure.js
// / pageExtract.js).
const { chatJSON, extractJsonArray } = require('./structure');

// Apply the stored fieldEdits overlay to a formspec, returning a NEW spec.
//   hidden  -> field removed from the served form (its recorded value still
//              rides along in the replay base url, so search keeps working).
//   filter  -> rendered as a tick/untick checkbox; onValue is what a ticked box
//              sends (defaults to the recorded value), an unticked box sends null.
//   name    -> display rename.
// Edits for keys not in the spec are ignored (a stale edit from another
// recording can never resurrect a field). Never mutates its inputs.
function applyFieldEdits(formspec, fieldEdits) {
  const edits = fieldEdits || {};
  const fields = (formspec.fields || [])
    .filter((f) => !(edits[f.key] && edits[f.key].hidden))
    .map((f) => {
      const e = edits[f.key];
      if (!e) return { ...f };
      const next = { ...f };
      if (e.name) next.name = e.name;
      if (e.filter) {
        next.filter = true;
        next.onValue = e.onValue != null ? e.onValue : f.value;
      }
      return next;
    });
  return { ...formspec, fields };
}

function fieldList(fields) {
  return (fields || []).map((f) => `- ${f.key}: "${f.name}" (currently ${JSON.stringify(f.value)})`).join('\n');
}

// Ask the model which fields are on/off FILTERS (amenity/refinement toggles the
// user either wants or doesn't) vs real search INPUTS (a value the user types or
// picks: destination, dates, guest counts, query text).
function buildFilterDetectPrompt(fields, site, stepLabels = []) {
  return (
    `A web form was derived from a recording on ${site || 'a website'}. Its fields:\n` +
    `${fieldList(fields)}\n\n` +
    (stepLabels.length ? `Labels seen while recording: ${stepLabels.join(', ')}.\n\n` : '') +
    'Identify which fields are on/off FILTERS — boolean refinements the user simply wants ' +
    'applied or not (e.g. "free cancellation", "swimming pool", "5-star only", "in stock"). ' +
    'Do NOT include real inputs the user types or picks a value for (destination, dates, ' +
    'number of guests, search text, sort order). Return ONLY a JSON array of the field keys ' +
    'that are filters, e.g. ["hotelfacility","fc"]. Return [] if none.'
  );
}

function parseFilterDetection(content, fields) {
  const arr = extractJsonArray(content);
  if (!Array.isArray(arr)) return [];
  const known = new Set((fields || []).map((f) => f.key));
  return arr.filter((k) => known.has(k));
}

const COMMAND_ACTIONS = new Set(['remove', 'make_filter', 'rename', 'none']);

// One plain-English instruction about the form -> a single structured action.
function buildFieldCommandPrompt(fields, instruction) {
  return (
    'You edit a web form derived from a recording. Its fields:\n' +
    `${fieldList(fields)}\n\n` +
    `The user says: "${instruction}"\n\n` +
    'Decide the single best action and reply with ONLY a JSON object:\n' +
    '{"action":"remove"|"make_filter"|"rename"|"none","key":"<field key>","newName":"<for rename>","message":"<one sentence to the user>"}\n' +
    '- remove: the field should not appear in the form.\n' +
    '- make_filter: the field is an on/off filter and should be a checkbox.\n' +
    '- rename: give the field a clearer display name (put it in newName).\n' +
    '- none: the request does not match any field or is not doable — explain why in message.\n' +
    'key MUST be one of the exact field keys above. Always fill message.'
  );
}

function firstJsonObject(content) {
  const fenced = String(content || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : String(content || '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Validate the model's action against the real fields. Anything invalid (bad
// action, unknown key, rename with no name, unparseable reply) degrades to a
// safe {action:'none'} with an explanatory message — the form is never changed
// on a request the parser can't stand behind.
function parseFieldCommand(content, fields) {
  const obj = firstJsonObject(content);
  if (!obj || !COMMAND_ACTIONS.has(obj.action)) {
    return { action: 'none', message: (obj && obj.message) || "Sorry, I couldn't understand that change." };
  }
  const message = obj.message || '';
  if (obj.action === 'none') return { action: 'none', message: message || 'No matching field found.' };

  const known = new Set((fields || []).map((f) => f.key));
  if (!known.has(obj.key)) {
    return { action: 'none', message: message || `No field matches "${obj.key}".` };
  }
  if (obj.action === 'rename' && !(obj.newName && String(obj.newName).trim())) {
    return { action: 'none', message: message || 'A rename needs a new name.' };
  }
  const out = { action: obj.action, key: obj.key, message };
  if (obj.action === 'rename') out.newName = String(obj.newName).trim();
  return out;
}

// --- thin async wrappers (live-verified only) ---

async function detectFilters(fields, site, stepLabels, apiKey, opts = {}) {
  const content = await chatJSON(
    'You classify web-form fields and reply with a JSON array only.',
    buildFilterDetectPrompt(fields, site, stepLabels),
    apiKey,
    opts
  );
  return parseFilterDetection(content, fields);
}

async function runFieldCommand(fields, instruction, apiKey, opts = {}) {
  const content = await chatJSON(
    'You edit a web form and reply with a single JSON object only.',
    buildFieldCommandPrompt(fields, instruction),
    apiKey,
    opts
  );
  return parseFieldCommand(content, fields);
}

module.exports = {
  applyFieldEdits,
  buildFilterDetectPrompt,
  parseFilterDetection,
  buildFieldCommandPrompt,
  parseFieldCommand,
  detectFilters,
  runFieldCommand,
};
