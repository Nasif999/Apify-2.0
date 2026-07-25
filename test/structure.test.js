const test = require('node:test');
const assert = require('node:assert');
const {
  heuristicParse,
  extractJsonArray,
  extractJsonItems,
  extractJsonSummary,
  parseKind,
  buildKindPrompt,
  buildInformationalPrompt,
  buildCombinedExtractPrompt,
  notesPrefix,
  buildFixPrompt,
} = require('../runner/structure');

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

test('heuristicParse pulls title/channel/views/duration from a lines-based video card', () => {
  const cards = [
    {
      text: 'irrelevant flattened blob',
      lines: ['Best of lofi hip hop', 'Lofi Girl', '55M views', '4 years ago', '1:02:34'],
      href: 'https://www.youtube.com/watch?v=abc123',
      img: 'https://x/thumb.jpg',
    },
  ];
  const [row] = heuristicParse(cards);
  assert.strictEqual(row.name, 'Best of lofi hip hop');
  assert.strictEqual(row.subtitle, 'Lofi Girl');
  assert.strictEqual(row.metrics.views, '55M');
  assert.strictEqual(row.metrics.publishedAgo, '4 years ago');
  assert.strictEqual(row.metrics.duration, '1:02:34');
  assert.strictEqual(row.url, 'https://www.youtube.com/watch?v=abc123');
});

test('heuristicParse does not let a "Now playing" status badge steal the title slot', () => {
  const cards = [
    {
      text: 'irrelevant',
      lines: ['Now playing', 'Best of lofi hip hop 2021', 'Lofi Girl', '55M views', '4 years ago'],
      href: 'https://www.youtube.com/watch?v=n61ULEU7CO0&list=RDn61ULEU7CO0',
      img: 'https://x/thumb.jpg',
    },
  ];
  const [row] = heuristicParse(cards);
  assert.strictEqual(row.name, 'Best of lofi hip hop 2021');
  assert.strictEqual(row.subtitle, 'Lofi Girl');
  assert.strictEqual(row.metrics.status, 'Now playing');
});

test('does not read a stray "$" inside a long description line as a price', () => {
  const cards = [
    {
      text: 'irrelevant',
      lines: [
        'Dan Martell',
        'Get your FREE Sell by Chat Playbook here: https://go.danmartell.com/48pqVxy Are you building an',
        '192k views',
        '7 months ago',
      ],
      href: 'https://www.youtube.com/watch?v=abc',
      img: 'https://x/thumb.jpg',
    },
  ];
  const [row] = heuristicParse(cards);
  assert.strictEqual(row.price, null);
  assert.strictEqual(row.name, 'Dan Martell');
});

test('still recognizes a price that is its own short line', () => {
  const cards = [
    { text: 'irrelevant', lines: ['Some Course', 'Channel', '$10', '21k views'], href: 'https://x/1', img: 'https://x/i.jpg' },
  ];
  const [row] = heuristicParse(cards);
  assert.strictEqual(row.price, '$10');
});

test('heuristicParse pulls price/rating/reviews from a lines-based shopping card', () => {
  const cards = [
    {
      text: 'irrelevant',
      lines: ['Wireless Mouse', 'Acme Corp', '$19.99', '4.5 stars', '1,204 reviews'],
      href: 'https://shop.example.com/item/1',
      img: 'https://x/mouse.jpg',
    },
  ];
  const [row] = heuristicParse(cards);
  assert.strictEqual(row.name, 'Wireless Mouse');
  assert.strictEqual(row.subtitle, 'Acme Corp');
  assert.strictEqual(row.price, '$19.99');
  assert.strictEqual(row.rating, '4.5');
  assert.strictEqual(row.metrics.reviews, '1,204');
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

test('parseKind: recognizes an INFORMATIONAL reply', () => {
  assert.strictEqual(parseKind('INFORMATIONAL'), 'informational');
  assert.strictEqual(parseKind('  informational.\n'), 'informational');
});

test('parseKind: defaults to listing for a LISTING reply', () => {
  assert.strictEqual(parseKind('LISTING'), 'listing');
});

test('parseKind: defaults to listing on garbage/empty/unexpected content (safe default preserves existing behavior)', () => {
  assert.strictEqual(parseKind(''), 'listing');
  assert.strictEqual(parseKind(undefined), 'listing');
  assert.strictEqual(parseKind('I am not sure what this page is.'), 'listing');
});

test('buildKindPrompt includes the domain and up to 5 card excerpts', () => {
  const cards = Array.from({ length: 8 }, (_, i) => ({ text: `card ${i}` }));
  const prompt = buildKindPrompt({ domain: 'imdb.com', cards });
  assert.ok(prompt.includes('imdb.com'));
  assert.ok(prompt.includes('card 0'));
  assert.ok(prompt.includes('card 4'));
  assert.ok(!prompt.includes('card 5'));
});

test('buildKindPrompt falls back to a card\'s lines when it has no flattened text', () => {
  const prompt = buildKindPrompt({ domain: 'x.com', cards: [{ lines: ['Josh Grisetti', 'Actor'] }] });
  assert.ok(prompt.includes('Josh Grisetti'));
});

test('buildInformationalPrompt includes the user\'s search values and the cards as JSON', () => {
  const prompt = buildInformationalPrompt([{ text: 'Josh Grisetti, actor' }], { 1: 'The Batman' });
  assert.ok(prompt.includes('The Batman'));
  assert.ok(prompt.includes('Josh Grisetti'));
});

test('buildInformationalPrompt works with no search values given', () => {
  const prompt = buildInformationalPrompt([{ text: 'x' }], undefined);
  assert.ok(prompt.includes('x'));
});

test('buildCombinedExtractPrompt includes domain, search values, notes, and cards, and asks for per-item card/text typing', () => {
  const prompt = buildCombinedExtractPrompt([{ text: 'Hotel X' }], {
    domain: 'booking.com',
    values: { ss: 'Dhaka' },
    notes: ['price is in the .rate span'],
  });
  assert.ok(prompt.includes('booking.com'));
  assert.ok(prompt.includes('Dhaka'));
  assert.ok(prompt.includes('price is in the .rate span'));
  assert.ok(prompt.includes('Hotel X'));
  assert.ok(prompt.includes('"card"'));
  assert.ok(prompt.includes('"text"'));
});

test('buildCombinedExtractPrompt works with no domain, values, or notes given', () => {
  const prompt = buildCombinedExtractPrompt([{ text: 'x' }], {});
  assert.ok(prompt.includes('a website'));
  assert.ok(prompt.includes('x'));
});

test('buildCombinedExtractPrompt asks the model to tag each item\'s own type and return {items}', () => {
  const prompt = buildCombinedExtractPrompt([{ text: 'DSEX Index 5,412.30' }], {});
  assert.ok(prompt.includes('"items"'));
  assert.ok(prompt.includes('"type"'));
});

test('buildCombinedExtractPrompt asks for an optional {summary} write-up for informational content', () => {
  const prompt = buildCombinedExtractPrompt([{ text: 'DSEX Index 5,412.30' }], {});
  assert.ok(prompt.includes('"summary"'));
  assert.ok(prompt.includes('"headline"'));
  assert.ok(prompt.includes('"facts"'));
  assert.ok(/wikipedia/i.test(prompt));
});

test('buildCombinedExtractPrompt tells the model never to narrate the scrape/capture process in the summary', () => {
  const prompt = buildCombinedExtractPrompt([{ text: 'DSEX Index 5,412.30' }], {});
  assert.ok(/never (mention|talk about|reference).*(scrap|captur|extract)/i.test(prompt));
});

test('buildCombinedExtractPrompt tells the model to type comparable-but-linkless items (flights, rates) as "text", never force "card" with a null url', () => {
  const prompt = buildCombinedExtractPrompt([{ text: 'US Bangla DAC-CXB BDT 62,684' }], {});
  assert.match(prompt, /flight/i);
  assert.match(prompt, /never (use|type|mark|call) (it|this|them)? ?"card"/i);
});

test('buildCombinedExtractPrompt warns that "text" items are deduped by name, so linkless comparable rows need distinguishing detail in their name', () => {
  const prompt = buildCombinedExtractPrompt([{ text: 'US Bangla DAC-CXB BDT 62,684' }], {});
  assert.match(prompt, /dedup/i);
  assert.match(prompt, /(unique|distinguish)/i);
});

test('extractJsonItems: parses a {items} object', () => {
  const out = extractJsonItems('```json\n{"items":[{"name":"DSEX Index","type":"text"}]}\n```');
  assert.deepStrictEqual(out, [{ name: 'DSEX Index', type: 'text' }]);
});

test('extractJsonItems: falls back to a bare JSON array (legacy shape)', () => {
  const out = extractJsonItems('[{"name":"Hotel A","url":"/a"}]');
  assert.deepStrictEqual(out, [{ name: 'Hotel A', url: '/a' }]);
});

test('extractJsonItems: returns null when nothing parseable is found', () => {
  assert.strictEqual(extractJsonItems('no json here'), null);
});

test('extractJsonSummary: pulls the summary object out alongside items', () => {
  const out = extractJsonSummary(
    '{"items":[{"name":"ACI"}],"summary":{"headline":"ACI","text":"ACI is in a circuit breaker.","facts":{"lower":"175.60"}}}'
  );
  assert.deepStrictEqual(out, { headline: 'ACI', text: 'ACI is in a circuit breaker.', facts: { lower: '175.60' } });
});

test('extractJsonSummary: null when the model omits it or replies with a bare array (legacy shape)', () => {
  assert.strictEqual(extractJsonSummary('{"items":[{"name":"Hotel A"}]}'), null);
  assert.strictEqual(extractJsonSummary('[{"name":"Hotel A"}]'), null);
});

test('notesPrefix: empty string when there are no notes', () => {
  assert.strictEqual(notesPrefix(undefined), '');
  assert.strictEqual(notesPrefix([]), '');
});

test('notesPrefix: renders each note as a bullet', () => {
  const out = notesPrefix(['price is in the .rate span', 'always include amenities']);
  assert.ok(out.includes('price is in the .rate span'));
  assert.ok(out.includes('always include amenities'));
});

test('buildFixPrompt includes the complaint and the cards', () => {
  const prompt = buildFixPrompt([{ text: 'Hotel X' }], 'no price shown', [], []);
  assert.ok(prompt.includes('no price shown'));
  assert.ok(prompt.includes('Hotel X'));
});

test('buildFixPrompt includes prior results when given, omits the block when not', () => {
  const withPrior = buildFixPrompt([{ text: 'x' }], 'missing rating', [{ name: 'x', rating: null }], []);
  assert.ok(withPrior.includes('"rating": null') || withPrior.includes('rating'));
  const withoutPrior = buildFixPrompt([{ text: 'x' }], 'missing rating', [], []);
  assert.ok(!withoutPrior.includes('Previous extraction'));
});

test('buildFixPrompt includes known notes for this automation when given', () => {
  const prompt = buildFixPrompt([{ text: 'x' }], 'missing amenities', [], ['always include amenities']);
  assert.ok(prompt.includes('always include amenities'));
});
