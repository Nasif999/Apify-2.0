const test = require('node:test');
const assert = require('node:assert');
const { makeDom } = require('./_setup');
const { captureFieldValue } = require('../extension/lib/fieldvalue');

function el(html) {
  return makeDom(html).body.firstElementChild;
}

test('tickmark: returns the checked boolean', () => {
  assert.strictEqual(captureFieldValue(el('<input type="checkbox" checked>'), 'tickmark'), true);
  assert.strictEqual(captureFieldValue(el('<input type="checkbox">'), 'tickmark'), false);
});

test('dropdown (native select): returns the selected option\'s text', () => {
  const dom = makeDom('<select><option>A</option><option selected>B</option></select>');
  assert.strictEqual(captureFieldValue(dom.querySelector('select'), 'dropdown'), 'B');
});

test('text input: returns el.value', () => {
  const dom = makeDom('<input type="text">');
  const input = dom.querySelector('input');
  input.value = 'Dhaka';
  assert.strictEqual(captureFieldValue(input, 'text'), 'Dhaka');
});

test('calendar: prefers aria-label over textContent when both exist', () => {
  const cell = el('<span class="day" aria-label="20 July 2026">20</span>');
  assert.strictEqual(captureFieldValue(cell, 'calendar'), '20 July 2026');
});

test('calendar: falls back to own text only, cleaned, when no date attribute exists', () => {
  // regression: this is the bug actually observed live on gozayaan.com. A
  // calendar-day cell's raw textContent came through completely uncleaned
  // ("\n          20\n            \n                    \n                  ")
  // because this fallback used bare el.textContent with no clean() call, and
  // never got the own-text-only treatment getLabel already has (so a nested
  // price badge, e.g. "6" + a nested "8.6K" badge, was concatenated into the
  // day's value too: "\n          6\n... 8.6K...").
  const cell = el('<span class="day">20<span class="badge">4K</span></span>');
  assert.strictEqual(captureFieldValue(cell, 'calendar'), '20');
});

test('calendar: own-text is cleaned of internal whitespace/newlines too', () => {
  const cell = el('<span class="day">\n          20\n        </span>');
  assert.strictEqual(captureFieldValue(cell, 'calendar'), '20');
});

test('contenteditable text field: returns cleaned textContent', () => {
  const dom = makeDom('<div contenteditable="true">\n  hello  \n</div>');
  assert.strictEqual(captureFieldValue(dom.querySelector('div'), 'text'), 'hello');
});

test('unknown click: returns trimmed text under the length cap', () => {
  const div = el('<div>New Delhi, India</div>');
  assert.strictEqual(captureFieldValue(div, 'unknown'), 'New Delhi, India');
});

test('unknown click: returns empty string when text exceeds the length cap', () => {
  const div = el(`<div>${'x'.repeat(200)}</div>`);
  assert.strictEqual(captureFieldValue(div, 'unknown'), '');
});

test('stepper: no meaningful value, always empty string', () => {
  assert.strictEqual(captureFieldValue(el('<button>+</button>'), 'stepper'), '');
});
