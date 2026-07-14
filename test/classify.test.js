const test = require('node:test');
const assert = require('node:assert');
const { makeDom } = require('./_setup');
const { classifyField } = require('../extension/lib/classify');

function el(html) {
  return makeDom(html).body.firstElementChild;
}

test('plain text input -> text', () => {
  assert.strictEqual(classifyField(el('<input type="text">')), 'text');
});

test('input with no type -> text', () => {
  assert.strictEqual(classifyField(el('<input>')), 'text');
});

test('search input -> text', () => {
  assert.strictEqual(classifyField(el('<input type="search">')), 'text');
});

test('textarea -> text', () => {
  assert.strictEqual(classifyField(el('<textarea></textarea>')), 'text');
});

test('contenteditable div -> text', () => {
  assert.strictEqual(classifyField(el('<div contenteditable="true"></div>')), 'text');
});

test('select -> dropdown', () => {
  assert.strictEqual(classifyField(el('<select><option>a</option></select>')), 'dropdown');
});

test('role=combobox -> dropdown', () => {
  assert.strictEqual(classifyField(el('<div role="combobox"></div>')), 'dropdown');
});

test('role=listbox -> dropdown', () => {
  assert.strictEqual(classifyField(el('<ul role="listbox"></ul>')), 'dropdown');
});

test('date input -> calendar', () => {
  assert.strictEqual(classifyField(el('<input type="date">')), 'calendar');
});

test('datetime-local input -> calendar', () => {
  assert.strictEqual(classifyField(el('<input type="datetime-local">')), 'calendar');
});

test('text input with datepicker class -> calendar', () => {
  assert.strictEqual(classifyField(el('<input type="text" class="hasDatepicker">')), 'calendar');
});

test('element with check-in aria-label -> calendar', () => {
  assert.strictEqual(classifyField(el('<div aria-label="Check-in date"></div>')), 'calendar');
});

test('checkbox -> tickmark', () => {
  assert.strictEqual(classifyField(el('<input type="checkbox">')), 'tickmark');
});

test('radio -> tickmark', () => {
  assert.strictEqual(classifyField(el('<input type="radio">')), 'tickmark');
});

test('role=switch -> tickmark', () => {
  assert.strictEqual(classifyField(el('<button role="switch"></button>')), 'tickmark');
});

test('aria-checked element -> tickmark', () => {
  assert.strictEqual(classifyField(el('<div role="checkbox" aria-checked="false"></div>')), 'tickmark');
});

test('button labeled + -> stepper', () => {
  assert.strictEqual(classifyField(el('<button>+</button>')), 'stepper');
});

test('button with increase aria-label -> stepper', () => {
  assert.strictEqual(classifyField(el('<button aria-label="Increase adults"></button>')), 'stepper');
});

test('button with decrement aria-label -> stepper', () => {
  assert.strictEqual(classifyField(el('<button aria-label="Decrement number of rooms"></button>')), 'stepper');
});

test('plain button -> unknown', () => {
  assert.strictEqual(classifyField(el('<button>Search</button>')), 'unknown');
});

test('tickmark takes precedence over text for a checkbox', () => {
  // a checkbox is an <input>; must not be misread as text
  assert.strictEqual(classifyField(el('<input type="checkbox" class="form-control">')), 'tickmark');
});

test('a <select> is always dropdown, even with a date-ish label', () => {
  // regression: booking child-age <select> labelled "Age of child at check-out"
  // was misread as calendar because of the "check-out" hint.
  const doc = makeDom('<select name="age" aria-label="Age of child at check-out"><option>8</option></select>');
  assert.strictEqual(classifyField(doc.querySelector('select')), 'dropdown');
});

test('structural stepper: a button flanking a number in a counter group', () => {
  // booking occupancy +/- buttons: SVG icons, no +/- text, no aria-label.
  const doc = makeDom(
    '<div class="counter"><button class="dec"></button><span>2</span><button class="inc"></button></div>'
  );
  const incButton = doc.querySelector('button.inc');
  assert.strictEqual(classifyField(incButton), 'stepper');
});

test('a lone button next to text that is not a counter is not a stepper', () => {
  const doc = makeDom('<div><span>Results</span><button>Search</button></div>');
  assert.strictEqual(classifyField(doc.querySelector('button')), 'unknown');
});

test('a free-text input merely labelled with a date word is text, not calendar', () => {
  // regression: DATE_HINT used to match any "date"/"return"/"departure" label,
  // misreading a plain text input as a calendar.
  assert.strictEqual(classifyField(el('<input type="text" aria-label="Return date">')), 'text');
  assert.strictEqual(classifyField(el('<input type="text" placeholder="Departure">')), 'text');
});

test('a non-input date-picker widget with a date label is calendar', () => {
  assert.strictEqual(classifyField(el('<div aria-label="Departure date"></div>')), 'calendar');
});
