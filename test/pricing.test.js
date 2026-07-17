const test = require('node:test');
const assert = require('node:assert');
const { quoteRate } = require('../server/pricing');

const rec = (n) => ({ steps: Array.from({ length: n }, (_, i) => ({ id: i })) });

test('price is a clean multiple of 5, at or above the floor', () => {
  const q = quoteRate(rec(5));
  assert.ok(q.price % 5 === 0, 'price should be a multiple of 5');
  assert.ok(q.price >= 10, 'price should be at least the floor');
});

test('more steps never lowers the price', () => {
  assert.ok(quoteRate(rec(30)).price >= quoteRate(rec(3)).price);
});

test('a larger output count costs more', () => {
  const small = quoteRate(rec(10), { outputCount: 5 }).price;
  const large = quoteRate(rec(10), { outputCount: 50 }).price;
  assert.ok(large > small, 'scraping 50 results should cost more than 5');
});

test('pricing is deterministic', () => {
  assert.strictEqual(quoteRate(rec(12)).price, quoteRate(rec(12)).price);
});

test('reports currency BDT and echoes the output count', () => {
  const q = quoteRate(rec(4), { outputCount: 20 });
  assert.strictEqual(q.currency, 'BDT');
  assert.strictEqual(q.outputCount, 20);
});
