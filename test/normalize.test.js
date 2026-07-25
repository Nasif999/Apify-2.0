const test = require('node:test');
const assert = require('node:assert');
const { normalizeResults, normalizeSummary } = require('../runner/normalize');

test('keeps valid rows and coerces fields to the schema', () => {
  const out = normalizeResults([
    { name: '  Grand Pacific  ', price: 'BDT 113,413', rating: '8.7', image: 'http://x/i.jpg', url: 'http://x/h1' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], {
    name: 'Grand Pacific',
    subtitle: null,
    price: 'BDT 113,413',
    rating: 8.7,
    metrics: {},
    image: 'http://x/i.jpg',
    url: 'http://x/h1',
    type: 'card',
  });
});

test('carries subtitle and metrics through', () => {
  const out = normalizeResults([
    {
      name: 'Some Video',
      subtitle: 'Some Channel',
      url: 'http://x/v1',
      metrics: { views: '1.2M', duration: '12:34' },
    },
  ]);
  assert.strictEqual(out[0].subtitle, 'Some Channel');
  assert.deepStrictEqual(out[0].metrics, { views: '1.2M', duration: '12:34' });
});

test('non-object metrics defaults to an empty object', () => {
  const out = normalizeResults([{ name: 'H', url: 'http://x/1', metrics: 'nope' }]);
  assert.deepStrictEqual(out[0].metrics, {});
});

test('drops bare duration-only fragments when a real video result is present', () => {
  const out = normalizeResults([
    { name: 'Best of lofi hip hop', subtitle: 'Lofi Girl', url: 'http://x/v1', metrics: { views: '55M' } },
    { name: 'Intro', subtitle: 'Intro', url: 'http://x/v2', metrics: { duration: '0:00' } },
    { name: 'WYS - Snowman', url: 'http://x/v3', metrics: { duration: '0:15' } },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Best of lofi hip hop');
});

test('keeps all rows when none are substantive (nothing to prefer)', () => {
  const out = normalizeResults([
    { name: 'Intro', url: 'http://x/v1', metrics: { duration: '0:00' } },
    { name: 'Chapter 2', url: 'http://x/v2', metrics: { duration: '1:30' } },
  ]);
  assert.equal(out.length, 2);
});

test('a livestream "X watching" count counts as substantive too', () => {
  const out = normalizeResults([
    { name: 'Real Video', url: 'http://x/v1', metrics: { views: '10K' } },
    { name: 'Live Stream', url: 'http://x/v2', metrics: { watching: '7.1K' } },
    { name: 'Bare Chapter', url: 'http://x/v3', metrics: { duration: '0:15' } },
  ]);
  assert.deepStrictEqual(out.map((r) => r.name), ['Real Video', 'Live Stream']);
});

test('keeps rows lacking price/rating/metrics entirely, even when mixed with rows that have a rating', () => {
  // regression: this is the bug actually observed live on booking.com. A row
  // with NO rating/price/metrics at all (a real Dhaka apartment listing with
  // no reviews yet) is not a "duration-only fragment" -- it never had a
  // duration metric to begin with, that concept doesn't even apply outside
  // video sites. The old isSubstantive() check excluded it anyway just for
  // lacking rating/price, discarding 5 of 10 real, distinct listings and
  // silently returning half the results the user asked for.
  const out = normalizeResults([
    { name: 'Renaissance Dhaka Gulshan Hotel', url: 'http://x/h1', rating: '9.1' },
    { name: 'Bright & Airy 3BR South-Facing Apartment', url: 'http://x/h2' },
    { name: 'ADD Eden', url: 'http://x/h3' },
  ]);
  assert.deepStrictEqual(
    out.map((r) => r.name),
    ['Renaissance Dhaka Gulshan Hotel', 'Bright & Airy 3BR South-Facing Apartment', 'ADD Eden']
  );
});

test('keeps all rows when every row is substantive', () => {
  const out = normalizeResults([
    { name: 'Video A', url: 'http://x/v1', metrics: { views: '10K' } },
    { name: 'Video B', url: 'http://x/v2', metrics: { views: '20K' } },
  ]);
  assert.equal(out.length, 2);
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

test('per-item type "text": keeps a row with a name but no url (e.g. a data table with no per-row link)', () => {
  const out = normalizeResults([
    { type: 'text', name: 'DSEX Index', subtitle: '5,412.30', metrics: { change: '+1.2%' } },
    { type: 'text', name: 'DS30 Index', subtitle: '2,011.10' },
  ]);
  assert.deepStrictEqual(out.map((r) => r.name), ['DSEX Index', 'DS30 Index']);
  assert.strictEqual(out[0].url, null);
  assert.strictEqual(out[0].type, 'text');
});

test('per-item type "text": still drops a row with no name at all', () => {
  const out = normalizeResults([{ type: 'text', subtitle: 'no name here' }]);
  assert.strictEqual(out.length, 0);
});

test('per-item type "text": dedupes by name when url is absent', () => {
  const out = normalizeResults([
    { type: 'text', name: 'DSEX Index', subtitle: '5,412.30' },
    { type: 'text', name: 'DSEX Index', subtitle: 'stale dup' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].subtitle, '5,412.30');
});

test('an item with no explicit type and no url still drops (safe default, unchanged from before per-item types existed)', () => {
  const out = normalizeResults([{ name: 'No URL Hotel' }]);
  assert.strictEqual(out.length, 0);
});

test('mixed run: a "card" item without a url is dropped while a sibling "text" item without a url is kept', () => {
  const out = normalizeResults([
    { type: 'card', name: 'Some Hotel' }, // no url -> dropped, cards need a real link
    { type: 'text', name: 'Circuit Breaker', subtitle: '10.00%' }, // no url -> kept, it's a fact not a link
    { type: 'card', name: 'Other Hotel', url: 'http://x/h2' },
  ]);
  assert.deepStrictEqual(
    out.map((r) => [r.name, r.type]),
    [
      ['Circuit Breaker', 'text'],
      ['Other Hotel', 'card'],
    ]
  );
});

test('normalizeSummary: keeps a headline, prose text, and cleaned-up facts', () => {
  const out = normalizeSummary({
    headline: '  ACI — Circuit Breaker  ',
    text: 'ACI is currently in a circuit breaker band between 175.60 and 214.60 (10%).',
    facts: { 'Lower bound': '175.60', 'Upper bound': ' 214.60 ', empty: '', junk: null },
  });
  assert.deepStrictEqual(out, {
    headline: 'ACI — Circuit Breaker',
    text: 'ACI is currently in a circuit breaker band between 175.60 and 214.60 (10%).',
    facts: { 'Lower bound': '175.60', 'Upper bound': '214.60' },
  });
});

test('normalizeSummary: null/missing input returns null (no summary for comparable listings)', () => {
  assert.strictEqual(normalizeSummary(null), null);
  assert.strictEqual(normalizeSummary(undefined), null);
  assert.strictEqual(normalizeSummary('not an object'), null);
});

test('normalizeSummary: an object with nothing usable (no headline, text, or facts) returns null', () => {
  assert.strictEqual(normalizeSummary({}), null);
  assert.strictEqual(normalizeSummary({ headline: '', text: '', facts: {} }), null);
});

test('normalizeSummary: a headline-only or text-only summary is still valid', () => {
  assert.deepStrictEqual(normalizeSummary({ headline: 'ACI' }), { headline: 'ACI', text: null, facts: {} });
  assert.deepStrictEqual(normalizeSummary({ text: 'Just a sentence.' }), {
    headline: null,
    text: 'Just a sentence.',
    facts: {},
  });
});
