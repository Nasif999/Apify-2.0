const test = require('node:test');
const assert = require('node:assert');
const { buildReplayUrl, isUrlDriven } = require('../extension/lib/replay');

const BOOKING_FINAL =
  'https://www.booking.com/searchresults.en-gb.html?aid=304142&ss=Cox%27s+Bazar%2C+Bangladesh&checkin=2026-07-19&checkout=2026-08-18&group_adults=5&age=14&age=12&age=17';

test('buildReplayUrl swaps given params and keeps the rest', () => {
  const out = buildReplayUrl(BOOKING_FINAL, { ss: 'Dhaka, Bangladesh', checkin: '2026-09-01' });
  const p = new URL(out).searchParams;
  assert.strictEqual(p.get('ss'), 'Dhaka, Bangladesh');
  assert.strictEqual(p.get('checkin'), '2026-09-01');
  assert.strictEqual(p.get('checkout'), '2026-08-18'); // untouched
  assert.strictEqual(p.get('aid'), '304142'); // untouched tracking param
});

test('buildReplayUrl adds a param that was not originally present', () => {
  const out = buildReplayUrl('https://a.com/s?x=1', { y: '2' });
  const p = new URL(out).searchParams;
  assert.strictEqual(p.get('x'), '1');
  assert.strictEqual(p.get('y'), '2');
});

test('buildReplayUrl expands an array value into repeated params', () => {
  const out = buildReplayUrl(BOOKING_FINAL, { age: ['5', '7'] });
  const ages = new URL(out).searchParams.getAll('age');
  assert.deepStrictEqual(ages, ['5', '7']);
});

test('buildReplayUrl leaves the url unchanged when no new params', () => {
  const out = buildReplayUrl('https://a.com/s?x=1&y=2', {});
  const p = new URL(out).searchParams;
  assert.strictEqual(p.get('x'), '1');
  assert.strictEqual(p.get('y'), '2');
});

test('isUrlDriven: true when a search adds state params to the URL', () => {
  const rec = {
    steps: [
      { url: 'https://www.booking.com/index.html?aid=304142&label=x' },
      { url: 'https://www.booking.com/searchresults.html?aid=304142&label=x&ss=Dhaka&checkin=2026-09-01' },
    ],
  };
  assert.strictEqual(isUrlDriven(rec), true);
});

test('isUrlDriven: true for a single new query param (YouTube search)', () => {
  const rec = {
    steps: [
      { url: 'https://www.youtube.com/' },
      { url: 'https://www.youtube.com/results?search_query=lofi' },
    ],
  };
  assert.strictEqual(isUrlDriven(rec), true);
});

test('isUrlDriven: false when the URL never gains or changes params', () => {
  const rec = {
    steps: [
      { url: 'https://app.example.com/dashboard' },
      { url: 'https://app.example.com/dashboard' },
    ],
  };
  assert.strictEqual(isUrlDriven(rec), false);
});

test('isUrlDriven: false for an empty recording', () => {
  assert.strictEqual(isUrlDriven({ steps: [] }), false);
});
