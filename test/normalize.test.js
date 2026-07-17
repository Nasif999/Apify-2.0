const test = require('node:test');
const assert = require('node:assert');
const { normalizeResults } = require('../runner/normalize');

test('keeps valid rows and coerces fields to the schema', () => {
  const out = normalizeResults([
    { name: '  Grand Pacific  ', price: 'BDT 113,413', rating: '8.7', image: 'http://x/i.jpg', url: 'http://x/h1' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], {
    name: 'Grand Pacific',
    price: 'BDT 113,413',
    rating: 8.7,
    image: 'http://x/i.jpg',
    url: 'http://x/h1',
  });
});

test('drops rows missing a name or a url', () => {
  const out = normalizeResults([
    { name: '', url: 'http://x/1' },
    { name: 'No URL Hotel', url: '' },
    { name: 'Good', url: 'http://x/2' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, 'Good');
});

test('rating that is not a number becomes null', () => {
  const out = normalizeResults([{ name: 'H', url: 'http://x/1', rating: 'n/a' }]);
  assert.strictEqual(out[0].rating, null);
});

test('missing optional fields default to null', () => {
  const out = normalizeResults([{ name: 'H', url: 'http://x/1' }]);
  assert.strictEqual(out[0].price, null);
  assert.strictEqual(out[0].rating, null);
  assert.strictEqual(out[0].image, null);
});

test('dedupes by url, keeping the first occurrence', () => {
  const out = normalizeResults([
    { name: 'First', url: 'http://x/1' },
    { name: 'Dup', url: 'http://x/1' },
    { name: 'Second', url: 'http://x/2' },
  ]);
  assert.deepStrictEqual(out.map((r) => r.name), ['First', 'Second']);
});

test('non-array input returns an empty array', () => {
  assert.deepStrictEqual(normalizeResults(null), []);
  assert.deepStrictEqual(normalizeResults(undefined), []);
  assert.deepStrictEqual(normalizeResults({}), []);
});

test('extracts a numeric rating embedded in a string', () => {
  const out = normalizeResults([{ name: 'H', url: 'http://x/1', rating: 'Scored 9.2' }]);
  assert.strictEqual(out[0].rating, 9.2);
});
