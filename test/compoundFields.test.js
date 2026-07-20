const test = require('node:test');
const assert = require('node:assert');
const { parseCompoundSplit, applyCompoundSplit } = require('../runner/compoundFields');

test('parseCompoundSplit keeps a split whose label count matches the value\'s slot count', () => {
  const fields = [{ key: 'trips', type: 'url', value: 'DAC,CXB,2026-07-21,CXB,DAC,2026-08-03' }];
  const content = JSON.stringify({
    trips: { delimiter: ',', labels: ['From', 'To', 'Depart', 'Return From', 'Return To', 'Return Date'] },
  });
  const result = parseCompoundSplit(content, fields);
  assert.deepStrictEqual(result.trips, {
    delimiter: ',',
    labels: ['From', 'To', 'Depart', 'Return From', 'Return To', 'Return Date'],
  });
});

test('parseCompoundSplit REJECTS a split whose label count does not match the slot count (would not round-trip)', () => {
  // critical safety guard: rejoin is position-swap, so N labels MUST map to
  // exactly N delimiter-separated slots. A mismatched split would scramble the
  // value on rejoin (searching a wrong route/date silently). Reject -> the
  // field stays whole.
  const fields = [{ key: 'trips', type: 'url', value: 'DAC,CXB,2026-07-21,CXB,DAC,2026-08-03' }]; // 6 slots
  const content = JSON.stringify({ trips: { delimiter: ',', labels: ['From', 'To', 'Date'] } }); // 3 labels
  const result = parseCompoundSplit(content, fields);
  assert.strictEqual(result.trips, undefined);
});

test('parseCompoundSplit ignores a key that is not a real field', () => {
  const fields = [{ key: 'trips', type: 'url', value: 'a,b' }];
  const content = JSON.stringify({ made_up: { delimiter: ',', labels: ['x', 'y'] } });
  assert.deepStrictEqual(parseCompoundSplit(content, fields), {});
});

test('parseCompoundSplit ignores a single-slot value (nothing to split)', () => {
  const fields = [{ key: 'ss', type: 'url', value: 'Dhaka' }];
  const content = JSON.stringify({ ss: { delimiter: ',', labels: ['City'] } });
  assert.deepStrictEqual(parseCompoundSplit(content, fields), {});
});

test('parseCompoundSplit throws on unparseable content (caller keeps fields whole)', () => {
  assert.throws(() => parseCompoundSplit('not json', [{ key: 'trips', type: 'url', value: 'a,b' }]));
});

test('applyCompoundSplit turns a matched url field into a compound field with per-position parts', () => {
  const fields = [
    { key: 'trips', name: 'trips', type: 'url', value: 'DAC,CXB,2026-07-21', source: 'url' },
    { key: 'adult', name: 'adult', type: 'url', value: '3', source: 'url' },
  ];
  const splits = { trips: { delimiter: ',', labels: ['From', 'To', 'Depart'] } };
  const out = applyCompoundSplit(fields, splits);
  assert.strictEqual(out[0].type, 'compound');
  assert.strictEqual(out[0].delimiter, ',');
  assert.deepStrictEqual(out[0].parts, [
    { label: 'From', value: 'DAC' },
    { label: 'To', value: 'CXB' },
    { label: 'Depart', value: '2026-07-21' },
  ]);
  assert.strictEqual(out[1].type, 'url'); // untouched
});

test('applyCompoundSplit is a safe no-op identity when splits is empty/null', () => {
  const fields = [{ key: 'trips', name: 'trips', type: 'url', value: 'a,b' }];
  assert.deepStrictEqual(applyCompoundSplit(fields, {}), fields);
  assert.deepStrictEqual(applyCompoundSplit(fields, null), fields);
});

test('applyCompoundSplit does not mutate the input', () => {
  const fields = [{ key: 'trips', name: 'trips', type: 'url', value: 'a,b' }];
  applyCompoundSplit(fields, { trips: { delimiter: ',', labels: ['X', 'Y'] } });
  assert.strictEqual(fields[0].type, 'url');
});
