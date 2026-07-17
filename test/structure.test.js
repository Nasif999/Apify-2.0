const test = require('node:test');
const assert = require('node:assert');
const { heuristicParse, extractJsonArray } = require('../runner/structure');

test('heuristicParse pulls name/price/rating from a real booking card', () => {
  const cards = [
    {
      text: "Hotel Grand Pacific Opens in new window Cox's BazarShow on map3 km from centreBeach nearby 400 m from beach Scored 8.7 8.7 Fabulous 13 reviews Lowest price for your stay 4× Standard BDT 113,413",
      href: 'https://www.booking.com/hotel/bd/grand-pacific.html',
      img: 'https://x/img.jpg',
    },
  ];
  const [row] = heuristicParse(cards);
  assert.strictEqual(row.name, 'Hotel Grand Pacific');
  assert.strictEqual(row.rating, '8.7');
  assert.strictEqual(row.price, 'BDT 113,413');
  assert.strictEqual(row.url, 'https://www.booking.com/hotel/bd/grand-pacific.html');
  assert.strictEqual(row.image, 'https://x/img.jpg');
});

test('extractJsonArray reads a bare JSON array', () => {
  const arr = extractJsonArray('[{"name":"A","url":"http://x/1"}]');
  assert.deepStrictEqual(arr, [{ name: 'A', url: 'http://x/1' }]);
});

test('extractJsonArray reads a fenced JSON array with prose around it', () => {
  const content = 'Here you go:\n```json\n[{"name":"A","url":"http://x/1"}]\n```\nDone.';
  const arr = extractJsonArray(content);
  assert.deepStrictEqual(arr, [{ name: 'A', url: 'http://x/1' }]);
});

test('extractJsonArray returns null on unparseable content', () => {
  assert.strictEqual(extractJsonArray('no json here'), null);
});
