const test = require('node:test');
const assert = require('node:assert');
const { makeDom } = require('./_setup');
const { generateSelector } = require('../extension/lib/selector');

test('prefers a stable id', () => {
  const doc = makeDom('<input id="search-box">');
  const el = doc.querySelector('input');
  assert.strictEqual(generateSelector(el), '#search-box');
});

test('ignores an auto-generated-looking id and falls through', () => {
  const doc = makeDom('<input id="ember1234" name="q">');
  const el = doc.querySelector('input');
  assert.strictEqual(generateSelector(el), 'input[name="q"]');
});

test('prefers a test-hook attribute over name/class', () => {
  const doc = makeDom('<button data-testid="submit-btn" name="go" class="x">Go</button>');
  const el = doc.querySelector('button');
  assert.strictEqual(generateSelector(el), '[data-testid="submit-btn"]');
});

test('uses name attribute when no id or test hook', () => {
  const doc = makeDom('<input name="email">');
  const el = doc.querySelector('input');
  assert.strictEqual(generateSelector(el), 'input[name="email"]');
});

test('uses aria-label when no id, test hook, or name', () => {
  const doc = makeDom('<button aria-label="Close dialog"></button>');
  const el = doc.querySelector('button');
  assert.strictEqual(generateSelector(el), 'button[aria-label="Close dialog"]');
});

test('uses a stable class combo when no better signal', () => {
  const doc = makeDom('<div class="filter-toggle active"></div>');
  const el = doc.querySelector('div');
  assert.strictEqual(generateSelector(el), 'div.filter-toggle.active');
});

test('skips hashed-looking classes and falls back to nth-of-type', () => {
  const doc = makeDom('<section id="root"><span class="css-1a2b3c"></span><span class="css-1a2b3c"></span></section>');
  const el = doc.querySelectorAll('span')[1];
  assert.strictEqual(generateSelector(el), '#root > span:nth-of-type(2)');
});

test('nth-of-type is anchored to the nearest stable ancestor', () => {
  const doc = makeDom('<main data-testid="results"><ul><li></li><li></li><li></li></ul></main>');
  const el = doc.querySelectorAll('li')[2];
  assert.strictEqual(generateSelector(el), '[data-testid="results"] li:nth-of-type(3)');
});

test('generated selector actually resolves back to the element', () => {
  const doc = makeDom('<form><input name="q"><input name="loc"></form>');
  const el = doc.querySelector('input[name="loc"]');
  const sel = generateSelector(el);
  assert.strictEqual(doc.querySelector(sel), el);
});
