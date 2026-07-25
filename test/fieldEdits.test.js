const test = require('node:test');
const assert = require('node:assert');
const {
  applyFieldEdits,
  buildFilterDetectPrompt,
  parseFilterDetection,
  buildFieldCommandPrompt,
  parseFieldCommand,
} = require('../runner/fieldEdits');

const SPEC = {
  mode: 'url',
  fields: [
    { key: 'ss', name: 'ss', type: 'url', value: "Cox's Bazar" },
    { key: 'dest_id', name: 'dest_id', type: 'url', value: '-3414440' },
    { key: 'hotelfacility', name: 'hotelfacility', type: 'url', value: '433' },
    { key: 'fc', name: 'fc', type: 'url', value: '5' },
  ],
};

// --- applyFieldEdits ---

test('applyFieldEdits: hides a field (dropped from served fields)', () => {
  const out = applyFieldEdits(SPEC, { dest_id: { hidden: true } });
  assert.deepStrictEqual(out.fields.map((f) => f.key), ['ss', 'hotelfacility', 'fc']);
});

test('applyFieldEdits: marks a field as a filter and carries its recorded value as onValue', () => {
  const out = applyFieldEdits(SPEC, { hotelfacility: { filter: true } });
  const f = out.fields.find((x) => x.key === 'hotelfacility');
  assert.strictEqual(f.filter, true);
  assert.strictEqual(f.onValue, '433');
});

test('applyFieldEdits: explicit onValue overrides the recorded value', () => {
  const out = applyFieldEdits(SPEC, { hotelfacility: { filter: true, onValue: '999' } });
  assert.strictEqual(out.fields.find((x) => x.key === 'hotelfacility').onValue, '999');
});

test('applyFieldEdits: renames a field', () => {
  const out = applyFieldEdits(SPEC, { hotelfacility: { name: 'Swimming pool' } });
  assert.strictEqual(out.fields.find((x) => x.key === 'hotelfacility').name, 'Swimming pool');
});

test('applyFieldEdits: does not mutate the input formspec or its fields', () => {
  const before = JSON.stringify(SPEC);
  applyFieldEdits(SPEC, { dest_id: { hidden: true }, fc: { filter: true, name: '5 stars' } });
  assert.strictEqual(JSON.stringify(SPEC), before);
});

test('applyFieldEdits: ignores edits for keys not in the formspec', () => {
  const out = applyFieldEdits(SPEC, { nonexistent: { hidden: true } });
  assert.strictEqual(out.fields.length, SPEC.fields.length);
});

test('applyFieldEdits: no edits returns an equivalent spec', () => {
  const out = applyFieldEdits(SPEC, {});
  assert.deepStrictEqual(out.fields.map((f) => f.key), SPEC.fields.map((f) => f.key));
});

test('applyFieldEdits: preserves mode', () => {
  assert.strictEqual(applyFieldEdits(SPEC, {}).mode, 'url');
});

// --- buildFilterDetectPrompt ---

test('buildFilterDetectPrompt: includes every field key and the site', () => {
  const p = buildFilterDetectPrompt(SPEC.fields, 'booking.com', ['Swimming pool', 'Cox\'s Bazar']);
  assert.match(p, /hotelfacility/);
  assert.match(p, /dest_id/);
  assert.match(p, /booking\.com/);
});

// --- parseFilterDetection ---

test('parseFilterDetection: keeps only returned keys that exist as fields', () => {
  const keys = parseFilterDetection('["hotelfacility","fc","bogus"]', SPEC.fields);
  assert.deepStrictEqual(keys, ['hotelfacility', 'fc']);
});

test('parseFilterDetection: unparseable content yields an empty list', () => {
  assert.deepStrictEqual(parseFilterDetection('sorry, I cannot', SPEC.fields), []);
});

test('parseFilterDetection: handles a fenced json array', () => {
  const keys = parseFilterDetection('```json\n["fc"]\n```', SPEC.fields);
  assert.deepStrictEqual(keys, ['fc']);
});

// --- buildFieldCommandPrompt ---

test('buildFieldCommandPrompt: includes the instruction and the field keys', () => {
  const p = buildFieldCommandPrompt(SPEC.fields, 'make fc a checkbox');
  assert.match(p, /make fc a checkbox/);
  assert.match(p, /fc/);
});

// --- parseFieldCommand ---

test('parseFieldCommand: valid make_filter action for an existing key', () => {
  const r = parseFieldCommand('{"action":"make_filter","key":"fc","message":"Turned 5 stars into a checkbox."}', SPEC.fields);
  assert.strictEqual(r.action, 'make_filter');
  assert.strictEqual(r.key, 'fc');
  assert.match(r.message, /checkbox/);
});

test('parseFieldCommand: rename requires a newName', () => {
  const r = parseFieldCommand('{"action":"rename","key":"fc"}', SPEC.fields);
  assert.strictEqual(r.action, 'none');
  assert.ok(r.message);
});

test('parseFieldCommand: rename with newName is kept', () => {
  const r = parseFieldCommand('{"action":"rename","key":"fc","newName":"Star rating","message":"Renamed."}', SPEC.fields);
  assert.strictEqual(r.action, 'rename');
  assert.strictEqual(r.newName, 'Star rating');
});

test('parseFieldCommand: unknown key is coerced to none with a message', () => {
  const r = parseFieldCommand('{"action":"remove","key":"ghost","message":"ok"}', SPEC.fields);
  assert.strictEqual(r.action, 'none');
  assert.ok(r.message);
});

test('parseFieldCommand: unknown action is coerced to none', () => {
  const r = parseFieldCommand('{"action":"explode","key":"fc","message":"boom"}', SPEC.fields);
  assert.strictEqual(r.action, 'none');
});

test('parseFieldCommand: unparseable content is none with a message', () => {
  const r = parseFieldCommand('I could not understand that.', SPEC.fields);
  assert.strictEqual(r.action, 'none');
  assert.ok(r.message);
});

test('parseFieldCommand: action none passes through its message', () => {
  const r = parseFieldCommand('{"action":"none","message":"No field matches \'price\'."}', SPEC.fields);
  assert.strictEqual(r.action, 'none');
  assert.match(r.message, /price/);
});
