const test = require('node:test');
const assert = require('node:assert');
const { assessResults } = require('../runner/verify');

test('flags results that all share the same name', () => {
  const { suspicious, reason } = assessResults([
    { name: 'Hotel', url: 'http://x/1' },
    { name: 'Hotel', url: 'http://x/2' },
    { name: 'hotel', url: 'http://x/3' },
  ]);
  assert.equal(suspicious, true);
  assert.match(reason, /same name/);
});

test('flags results that all share the same url', () => {
  const { suspicious, reason } = assessResults([
    { name: 'A', url: 'http://x/1' },
    { name: 'B', url: 'http://x/1' },
  ]);
  assert.equal(suspicious, true);
  assert.match(reason, /same URL/);
});

test('does not flag normal varied results', () => {
  const { suspicious } = assessResults([
    { name: 'Hotel A', url: 'http://x/1' },
    { name: 'Hotel B', url: 'http://x/2' },
  ]);
  assert.equal(suspicious, false);
});

test('does not flag zero or one result (nothing to compare)', () => {
  assert.equal(assessResults([]).suspicious, false);
  assert.equal(assessResults([{ name: 'Only', url: 'http://x/1' }]).suspicious, false);
});
