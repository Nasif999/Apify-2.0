const test = require('node:test');
const assert = require('node:assert');
const { buildNamingPrompt, parseNamingSuggestions, applyNamingSuggestions } = require('../runner/fieldNaming');

test('buildNamingPrompt lists every field key/type/name and the step context', () => {
  const fields = [
    { key: '8', name: 'stepper', type: 'stepper', value: '' },
    { key: 'trips', name: 'trips', type: 'url', value: 'CXB,DAC,2026-07-20' },
  ];
  const prompt = buildNamingPrompt(fields, 'gozayaan.com', ['Dhaka', "Cox's Bazar, Bangladesh", 'Search']);
  assert.match(prompt, /8/);
  assert.match(prompt, /stepper/);
  assert.match(prompt, /trips/);
  assert.match(prompt, /gozayaan\.com/);
  assert.match(prompt, /Cox's Bazar, Bangladesh/);
});

test('buildNamingPrompt includes each field\'s captured context when present', () => {
  // the whole point of capturing rich context at record time: an icon-only
  // stepper is unnameable from its own markup, but its nearby text ("Adults")
  // and data-testid identify it exactly. That detail must reach the prompt.
  const fields = [
    {
      key: '8',
      name: 'stepper',
      type: 'stepper',
      value: '',
      context: {
        tag: 'button',
        attrs: { 'data-testid': 'adults-increment' },
        nearbyText: 'Adults | 2',
        ancestors: ['div.counter', 'div.row'],
      },
    },
  ];
  const prompt = buildNamingPrompt(fields, 'example.com', []);
  assert.match(prompt, /adults-increment/);
  assert.match(prompt, /Adults/);
});

test('buildNamingPrompt still works for fields with no captured context', () => {
  const fields = [{ key: '8', name: 'stepper', type: 'stepper', value: '' }];
  assert.doesNotThrow(() => buildNamingPrompt(fields, 'example.com', []));
});

test('parseNamingSuggestions keeps only keys that exist in the field list', () => {
  const fieldKeys = ['8', 'trips'];
  const result = parseNamingSuggestions('{"8": "Adults", "made_up_key": "Nope"}', fieldKeys);
  assert.deepStrictEqual(result, { 8: 'Adults' });
});

test('parseNamingSuggestions drops empty/blank suggested names', () => {
  const result = parseNamingSuggestions('{"8": "Adults", "9": "  ", "10": ""}', ['8', '9', '10']);
  assert.deepStrictEqual(result, { 8: 'Adults' });
});

test('parseNamingSuggestions reads a fenced JSON object with prose around it', () => {
  const content = 'Here you go:\n```json\n{"8": "Adults"}\n```\nHope that helps!';
  assert.deepStrictEqual(parseNamingSuggestions(content, ['8']), { 8: 'Adults' });
});

test('parseNamingSuggestions throws on unparseable content (caller keeps original names)', () => {
  assert.throws(() => parseNamingSuggestions('not json', ['8']));
});

test('applyNamingSuggestions overrides only the fields with a valid suggestion', () => {
  const fields = [
    { key: '8', name: 'stepper', type: 'stepper', value: '' },
    { key: '9', name: 'stepper', type: 'stepper', value: '' },
    { key: 'trips', name: 'trips', type: 'url', value: 'x' },
  ];
  const out = applyNamingSuggestions(fields, { 8: 'Adults' });
  assert.strictEqual(out[0].name, 'Adults');
  assert.strictEqual(out[1].name, 'stepper'); // no suggestion -- keeps original
  assert.strictEqual(out[2].name, 'trips'); // no suggestion -- keeps original
});

test('applyNamingSuggestions is a safe no-op identity when suggestions is empty/null', () => {
  const fields = [{ key: '8', name: 'stepper', type: 'stepper', value: '' }];
  assert.deepStrictEqual(applyNamingSuggestions(fields, {}), fields);
  assert.deepStrictEqual(applyNamingSuggestions(fields, null), fields);
});

test('applyNamingSuggestions does not mutate the input array/objects', () => {
  const fields = [{ key: '8', name: 'stepper', type: 'stepper', value: '' }];
  const out = applyNamingSuggestions(fields, { 8: 'Adults' });
  assert.strictEqual(fields[0].name, 'stepper');
  assert.notStrictEqual(out, fields);
});
