const test = require('node:test');
const assert = require('node:assert');
const { parseClassification, buildPrompt } = require('../runner/paramClassify');

test('buildPrompt lists every key with its sample value', () => {
  const prompt = buildPrompt({ ss: 'Bangkok, Thailand', aid: '304142' }, 'www.booking.com');
  assert.match(prompt, /ss/);
  assert.match(prompt, /Bangkok, Thailand/);
  assert.match(prompt, /aid/);
  assert.match(prompt, /www\.booking\.com/);
});

test('buildPrompt includes the recorded step labels for context', () => {
  // regression: without step context, the AI can't tell "selected_currency"
  // (which the user DID set -- a real recorded click: "Prices in Pound
  // Sterling" -> "Malaysian Ringgit MYR") apart from "lang" (which no step
  // ever touches, just page-load default). Both first appear in the exact
  // same url transition (the search navigation), so url-diffing alone can't
  // distinguish them -- the AI needs to see what the user actually did.
  const prompt = buildPrompt({ ss: 'x' }, 'www.booking.com', ['Kuala Lumpur Malaysia', 'Malaysian Ringgit MYR']);
  assert.match(prompt, /Kuala Lumpur Malaysia/);
  assert.match(prompt, /Malaysian Ringgit MYR/);
});

test('buildPrompt tolerates missing step labels (backward compatible)', () => {
  assert.doesNotThrow(() => buildPrompt({ ss: 'x' }, 'www.booking.com'));
});

test('parseClassification reads a bare JSON array of tracking keys', () => {
  const keys = ['ss', 'checkin', 'aid', 'sid'];
  const result = parseClassification('["aid", "sid"]', keys);
  assert.deepStrictEqual([...result].sort(), ['aid', 'sid']);
});

test('parseClassification reads a fenced JSON array with prose around it', () => {
  const keys = ['ss', 'aid'];
  const content = 'Here is the list:\n```json\n["aid"]\n```\nHope that helps!';
  const result = parseClassification(content, keys);
  assert.deepStrictEqual([...result], ['aid']);
});

test('parseClassification ignores hallucinated keys not in the original list', () => {
  const keys = ['ss', 'aid'];
  const result = parseClassification('["aid", "made_up_key"]', keys);
  assert.deepStrictEqual([...result], ['aid']);
});

test('parseClassification throws on unparseable content (caller falls back to heuristic)', () => {
  assert.throws(() => parseClassification('not json at all', ['ss']));
});
