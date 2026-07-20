const test = require('node:test');
const assert = require('node:assert');
const { makeDom } = require('./_setup');
const { getLabel } = require('../extension/lib/label');

function el(html) {
  return makeDom(html).body.firstElementChild;
}

test('aria-label wins over everything else', () => {
  assert.strictEqual(getLabel(el('<button aria-label="Search flights">Go</button>')), 'Search flights');
});

test('plain text button falls back to its own text', () => {
  assert.strictEqual(getLabel(el('<button>Search</button>')), 'Search');
});

test('a calendar-day cell with a nested price badge is named from its own text only, not the badge', () => {
  // regression: booking.com's day cells nest a "lowest price" badge inside the
  // clickable cell (`<span class="day">20<span class="lowest">4K</span></span>`).
  // getLabel used to grab the whole element's textContent, producing a garbled
  // "20\n            \n                    4K" label instead of just "20".
  const cell = el('<span class="day">20<span class="lowest">4K</span></span>');
  assert.strictEqual(getLabel(cell), '20');
});

test('a button whose text lives entirely in a nested child still gets that text', () => {
  // own-text-only must not break the common case of a wrapped label
  // (e.g. <button><span>Search</span></button>) where there is no direct
  // text node on the button itself.
  const btn = el('<button><span>Search</span></button>');
  assert.strictEqual(getLabel(btn), 'Search');
});

test('a wrapped filter checkbox label (multiple nested spans) still reads as a whole', () => {
  // regression guard: closest('label') must still win before we ever reach
  // the own-text-only fallback, so multi-span filter labels like booking.com's
  // "Swimming pool: 405 properties" keep working.
  const dom = makeDom(
    '<label><input type="checkbox" id="cb1"><span class="name">Swimming pool</span>: <span class="count">405 properties</span></label>'
  );
  const input = dom.querySelector('#cb1');
  assert.strictEqual(getLabel(input), 'Swimming pool: 405 properties');
});

test('an unlabeled <select> is never named from its concatenated option list', () => {
  // regression: this is the bug actually observed live on gozayaan.com. A
  // <select> with no aria-label/wrapping-label falls through getLabel's
  // generic textContent fallback -- but a <select>'s textContent is every
  // <option>'s text joined ("2 3 4 5 6 7 8 9 10 11" for a passenger-count
  // dropdown), never a meaningful name. That fallback must be skipped for
  // <select> elements specifically; falling to '' (formspec then shows the
  // honest fieldType word "dropdown") beats a garbled fake-looking label.
  const dom = makeDom('<select><option>2</option><option>3</option><option>4</option></select>');
  assert.strictEqual(getLabel(dom.querySelector('select')), '');
});

test('a <select> WITH an aria-label still uses it (the select-guard only skips the textContent fallback)', () => {
  const dom = makeDom('<select aria-label="Adults"><option>2</option><option>3</option></select>');
  assert.strictEqual(getLabel(dom.querySelector('select')), 'Adults');
});

test('an icon-only stepper button with no label anywhere on itself reads its counter row\'s own label', () => {
  // regression: this is the bug actually observed live -- gozayaan.com's
  // passenger +/- steppers have no text, no aria-label, no wrapping <label>.
  // Every one of them got named "" (falling back to the bare fieldType word
  // "stepper"), making 9 distinct counters ("Adults", "Children", "Infants")
  // completely indistinguishable in the form. Real counter UIs are almost
  // always a labeled row wrapping the +/- widget (the label text a SIBLING
  // of the counter, not inside it) -- climb from the button's immediate
  // counter-group parent to that row and read the row's own text.
  const dom = makeDom(
    '<div class="row">Adults<div class="counter"><button class="dec">-</button><span>2</span><button class="inc">+</button></div></div>'
  );
  const incButton = dom.querySelector('button.inc');
  assert.strictEqual(getLabel(incButton), 'Adults');
});

test('the counter-row climb does not fire when the row has no own text (avoids inventing a label)', () => {
  const dom = makeDom(
    '<div class="row"><div class="counter"><button class="dec">-</button><span>2</span><button class="inc">+</button></div></div>'
  );
  const incButton = dom.querySelector('button.inc');
  assert.strictEqual(getLabel(incButton), '');
});
