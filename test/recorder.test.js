const test = require('node:test');
const assert = require('node:assert');
const { newRecording, addAction, serialize } = require('../extension/lib/recorder');

const U = 'https://www.youtube.com/results';

test('newRecording starts empty with a startedAt', () => {
  const rec = newRecording(1000);
  assert.strictEqual(rec.startedAt, 1000);
  assert.deepStrictEqual(rec.actions, []);
});

test('addAction assigns an incrementing id, timestamp, and domain', () => {
  const rec = newRecording(0);
  const a = addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'cats', url: U }, 1500);
  assert.strictEqual(a.id, 1);
  assert.strictEqual(a.timestamp, 1500);
  assert.strictEqual(a.domain, 'www.youtube.com');
  assert.strictEqual(rec.actions.length, 1);
});

test('consecutive text inputs on the same selector coalesce to the final value', () => {
  const rec = newRecording(0);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'c', url: U }, 1);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'ca', url: U }, 2);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'cats', url: U }, 3);
  const out = serialize(rec);
  assert.strictEqual(out.steps.length, 1);
  assert.strictEqual(out.steps[0].value, 'cats');
});

test('a text-field click followed by typing on the same selector coalesces into one field', () => {
  // regression: on IMDb the user clicked the search box (recorded as a text
  // step with the box's current value) and then typed. Without merging these,
  // the same input would surface twice in the form -- once empty from the
  // click, once with the typed value. They are one field; keep the final value.
  const rec = newRecording(0);
  addAction(rec, { type: 'click', fieldType: 'text', selector: '#q', value: '', url: U }, 1);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'du', url: U }, 2);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'dune', url: U }, 3);
  const out = serialize(rec);
  assert.strictEqual(out.steps.length, 1);
  assert.strictEqual(out.steps[0].value, 'dune');
});

test('a text-field click with NO typing still yields one editable text step', () => {
  // regression: this is the IMDb bug. The user clicked the search box and
  // picked a suggestion from the dropdown WITHOUT typing anything, so no
  // input event ever fired. The search box must still become an editable
  // field -- otherwise the automation has no way to search for anything else.
  const rec = newRecording(0);
  addAction(rec, { type: 'click', fieldType: 'text', selector: '#q', value: '', url: U, label: 'Search IMDb' }, 1);
  addAction(rec, { type: 'click', fieldType: 'unknown', selector: '.suggestion', value: 'Dune', url: U }, 2);
  const out = serialize(rec);
  const textSteps = out.steps.filter((s) => s.fieldType === 'text');
  assert.strictEqual(textSteps.length, 1);
  assert.strictEqual(textSteps[0].selector, '#q');
  // and it is surfaced as an editable variable, not swallowed
  assert.ok(out.variables.some((v) => v.fieldType === 'text' && v.selector === '#q'));
});

test('text steps on DIFFERENT selectors still do not coalesce', () => {
  const rec = newRecording(0);
  addAction(rec, { type: 'click', fieldType: 'text', selector: '#from', value: '', url: U }, 1);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#to', value: 'x', url: U }, 2);
  const out = serialize(rec);
  assert.strictEqual(out.steps.length, 2);
});

test('inputs on the same selector separated by another action do not coalesce', () => {
  const rec = newRecording(0);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'cats', url: U }, 1);
  addAction(rec, { type: 'click', fieldType: 'unknown', selector: '#search', url: U }, 2);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'dogs', url: U }, 3);
  const out = serialize(rec);
  assert.strictEqual(out.steps.length, 3);
});

test('serialize lists distinct sites in first-seen order', () => {
  const rec = newRecording(0);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'x', url: 'https://a.com/p' }, 1);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#r', value: 'y', url: 'https://b.com/p' }, 2);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#s', value: 'z', url: 'https://a.com/q' }, 3);
  const out = serialize(rec);
  assert.deepStrictEqual(out.sites, ['a.com', 'b.com']);
});

test('serialize extracts variables from field actions and skips unknown clicks', () => {
  const rec = newRecording(0);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'cats', url: U, label: 'Search' }, 1);
  addAction(rec, { type: 'click', fieldType: 'unknown', selector: '#btn', url: U }, 2);
  const out = serialize(rec);
  assert.strictEqual(out.variables.length, 1);
  assert.strictEqual(out.variables[0].name, 'Search');
  assert.strictEqual(out.variables[0].fieldType, 'text');
  assert.strictEqual(out.variables[0].value, 'cats');
});

test('variable name falls back to fieldType + ordinal when no label', () => {
  const rec = newRecording(0);
  addAction(rec, { type: 'change', fieldType: 'dropdown', selector: '#d', value: '5', url: U }, 1);
  const out = serialize(rec);
  assert.strictEqual(out.variables[0].name, 'dropdown_1');
});

test('serialize extracts query params from the final URL', () => {
  const rec = newRecording(0);
  addAction(rec, { type: 'input', fieldType: 'text', selector: '#q', value: 'x', url: 'https://a.com/s?ss=KL' }, 1);
  addAction(rec, { type: 'change', fieldType: 'tickmark', selector: '#f', value: true, url: 'https://a.com/results?ss=Kuala+Lumpur&checkin=2026-07-19&checkout=2026-08-18' }, 2);
  const out = serialize(rec);
  assert.strictEqual(out.urlParams.checkin, '2026-07-19');
  assert.strictEqual(out.urlParams.checkout, '2026-08-18');
  assert.strictEqual(out.urlParams.ss, 'Kuala Lumpur');
});

test('serialize collects repeated query params into an array', () => {
  const rec = newRecording(0);
  addAction(rec, { type: 'change', fieldType: 'dropdown', selector: '#age', value: '4', url: 'https://a.com/r?age=16&age=12&age=4' }, 1);
  const out = serialize(rec);
  assert.deepStrictEqual(out.urlParams.age, ['16', '12', '4']);
});

test('serialize gives empty urlParams when there are no steps', () => {
  const rec = newRecording(0);
  const out = serialize(rec);
  assert.deepStrictEqual(out.urlParams, {});
});

test('nested: a field revealed by a stepper links to its parent', () => {
  const rec = newRecording(0);
  const stepper = addAction(rec, { type: 'click', fieldType: 'stepper', selector: '#add-child', url: U }, 1);
  addAction(rec, { type: 'change', fieldType: 'dropdown', selector: '#child-age', value: '10', url: U, revealedBy: stepper.id }, 2);
  const out = serialize(rec);
  const parent = out.steps.find((s) => s.id === stepper.id);
  const child = out.steps.find((s) => s.revealedBy === stepper.id);
  assert.strictEqual(parent.hasNested, true);
  assert.strictEqual(child.nested, true);
  assert.strictEqual(child.parentId, stepper.id);
});
