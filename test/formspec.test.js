const test = require('node:test');
const assert = require('node:assert');
const { deriveFormSpec } = require('../server/formspec');

const booking = require('../runner/fixtures/booking-coxsbazar.json');
const selenium = require('../runner/fixtures/selenium-webform.json');

test('URL-driven recording -> url-mode form of the params the search added', () => {
  const spec = deriveFormSpec(booking);
  assert.strictEqual(spec.mode, 'url');
  const keys = spec.fields.map((f) => f.key);
  // state params the user set are present
  for (const k of ['ss', 'checkin', 'checkout', 'group_children', 'age', 'nflt']) {
    assert.ok(keys.includes(k), `expected form field for ${k}`);
  }
  // tracking params present in the first URL are excluded
  assert.ok(!keys.includes('aid'), 'aid (tracking) should not be a form field');
  assert.ok(!keys.includes('sid'), 'sid (tracking) should not be a form field');
});

test('URL-driven field carries the recorded value', () => {
  const spec = deriveFormSpec(booking);
  const checkin = spec.fields.find((f) => f.key === 'checkin');
  assert.strictEqual(checkin.value, '2026-07-19');
});

test('step-driven recording -> step-mode form keyed by step id', () => {
  const spec = deriveFormSpec(selenium);
  assert.strictEqual(spec.mode, 'step');
  const keys = spec.fields.map((f) => f.key);
  assert.deepStrictEqual(keys, ['1', '2', '3']); // the 3 input steps, not the submit click
  assert.strictEqual(spec.fields[0].type, 'text');
  assert.strictEqual(spec.fields[1].type, 'dropdown');
  assert.strictEqual(spec.fields[2].type, 'tickmark');
});
