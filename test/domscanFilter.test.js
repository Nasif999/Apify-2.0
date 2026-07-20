const test = require('node:test');
const assert = require('node:assert');
const { buildScanPrompt, parseScanFilter } = require('../runner/domscanFilter');

test('buildScanPrompt numbers every candidate with its label and field type', () => {
  const candidates = [
    { label: 'Free WiFi', fieldType: 'tickmark' },
    { label: 'Sort by', fieldType: 'dropdown' },
  ];
  const prompt = buildScanPrompt(candidates, 'www.booking.com');
  assert.match(prompt, /1\. Free WiFi \(tickmark\)/);
  assert.match(prompt, /2\. Sort by \(dropdown\)/);
  assert.match(prompt, /www\.booking\.com/);
});

test('parseScanFilter keeps only candidates whose 1-based index was returned', () => {
  const candidates = [
    { label: 'Free WiFi', fieldType: 'tickmark' },
    { label: 'Advertisement close button', fieldType: 'tickmark' },
  ];
  const kept = parseScanFilter('[1]', candidates);
  assert.deepStrictEqual(kept, [candidates[0]]);
});

test('parseScanFilter matches correctly even when the AI trims a long label', () => {
  // regression: this is the bug actually observed live. The AI was asked
  // (and told "copied verbatim") to echo back "Free WiFi: 217 properties"
  // but returned just "Free WiFi", trimming the count suffix that real
  // booking.com filter labels always carry. Text matching against arbitrary
  // LLM-paraphrased strings is fundamentally unreliable — index-based
  // matching sidesteps the whole problem since a number can't be paraphrased.
  const candidates = [
    { label: 'Free WiFi: 217 properties', fieldType: 'tickmark' },
    { label: 'List', fieldType: 'tickmark' },
    { label: 'Grid', fieldType: 'tickmark' },
    { label: '5 stars: 5 properties', fieldType: 'tickmark' },
  ];
  const kept = parseScanFilter('[1, 4]', candidates);
  assert.deepStrictEqual(kept, [candidates[0], candidates[3]]);
});

test('parseScanFilter ignores an out-of-range or non-integer index', () => {
  const candidates = [{ label: 'Free WiFi', fieldType: 'tickmark' }];
  const kept = parseScanFilter('[1, 99, 1.5, "x"]', candidates);
  assert.deepStrictEqual(kept, [candidates[0]]);
});

test('parseScanFilter reads a fenced JSON array with prose around it', () => {
  const candidates = [{ label: 'Free WiFi', fieldType: 'tickmark' }];
  const content = 'Sure thing:\n```json\n[1]\n```\n';
  assert.deepStrictEqual(parseScanFilter(content, candidates), [candidates[0]]);
});

test('parseScanFilter throws on unparseable content (caller falls back to unfiltered candidates)', () => {
  assert.throws(() => parseScanFilter('not json', [{ label: 'x', fieldType: 'tickmark' }]));
});
