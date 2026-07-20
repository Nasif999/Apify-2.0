const test = require('node:test');
const assert = require('node:assert');
const { makeDom } = require('./_setup');
const { findInteractiveCandidates, diffCandidates } = require('../runner/domscan');

test('findInteractiveCandidates finds a checkbox, a select, and a text input', () => {
  const doc = makeDom(`
    <input type="checkbox" aria-label="Free WiFi">
    <select aria-label="Sort by"><option>Price</option></select>
    <input type="text" aria-label="City">
    <div>just some text, not interactive</div>
  `);
  const candidates = findInteractiveCandidates(doc);
  const labels = candidates.map((c) => c.label).sort();
  assert.deepStrictEqual(labels, ['City', 'Free WiFi', 'Sort by']);
});

test('findInteractiveCandidates reports the fieldType classify.js assigned', () => {
  const doc = makeDom('<input type="checkbox" aria-label="Free WiFi">');
  const [candidate] = findInteractiveCandidates(doc);
  assert.strictEqual(candidate.fieldType, 'tickmark');
});

test('findInteractiveCandidates ignores non-interactive elements entirely', () => {
  const doc = makeDom('<div>hello</div><span>world</span><p>text</p>');
  assert.deepStrictEqual(findInteractiveCandidates(doc), []);
});

test('diffCandidates excludes an element whose selector matches an already-recorded selector', () => {
  const doc = makeDom('<input type="checkbox" id="cb1" aria-label="Free WiFi">');
  const candidates = findInteractiveCandidates(doc);
  const diffed = diffCandidates(candidates, ['#cb1']);
  assert.deepStrictEqual(diffed, []);
});

test('diffCandidates keeps a candidate whose selector does not match any recorded selector', () => {
  const doc = makeDom(`
    <input type="checkbox" id="cb1" aria-label="Free WiFi">
    <input type="checkbox" id="cb2" aria-label="Pet friendly">
  `);
  const candidates = findInteractiveCandidates(doc);
  const diffed = diffCandidates(candidates, ['#cb1']);
  assert.strictEqual(diffed.length, 1);
  assert.strictEqual(diffed[0].label, 'Pet friendly');
});

test('diffCandidates matches by el.matches() against the recorded selector, not string identity', () => {
  // regression guard: a recorded selector is often attribute-based
  // (e.g. input[name="fc=2"]), which never equals what generateSelector
  // would produce fresh for the same element -- string comparison would
  // wrongly treat every already-recorded field as "missed".
  const doc = makeDom('<input type="checkbox" name="fc=2" aria-label="Free cancellation">');
  const candidates = findInteractiveCandidates(doc);
  const diffed = diffCandidates(candidates, ['input[name="fc=2"]']);
  assert.deepStrictEqual(diffed, []);
});
