const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDom } = require('./_setup');
const { serializePage, buildPageExtractPrompt, shouldRescue } = require('../runner/pageExtract');

test('serializePage keeps link text and href as markdown', () => {
  const doc = makeDom(`<div><a href="/item/1">Blue Widget</a> <span>$19.99</span></div>`);
  const out = serializePage(doc);
  assert.match(out, /\[Blue Widget\]\(\/item\/1\)/);
  assert.match(out, /\$19\.99/);
});

test('serializePage keeps an image src next to its link', () => {
  const doc = makeDom(`<a href="/p/2"><img src="/thumb2.jpg" />Green Gadget</a>`);
  const out = serializePage(doc);
  assert.match(out, /\/thumb2\.jpg/);
  assert.match(out, /Green Gadget/);
  assert.match(out, /\/p\/2/);
});

test('serializePage drops script, style, and noscript content', () => {
  const doc = makeDom(`
    <script>var secret = "DO_NOT_LEAK";</script>
    <style>.x{color:red}</style>
    <noscript>enable js</noscript>
    <p>Visible text here</p>
  `);
  const out = serializePage(doc);
  assert.ok(!out.includes('DO_NOT_LEAK'));
  assert.ok(!out.includes('color:red'));
  assert.match(out, /Visible text here/);
});

test('serializePage skips nav, header, and footer chrome', () => {
  const doc = makeDom(`
    <nav>Home About Contact</nav>
    <header>Site Banner</header>
    <main><p>Real result content</p></main>
    <footer>Copyright 2026</footer>
  `);
  const out = serializePage(doc);
  assert.match(out, /Real result content/);
  assert.ok(!out.includes('About Contact'));
  assert.ok(!out.includes('Copyright 2026'));
});

test('serializePage prefers <main> when present', () => {
  const doc = makeDom(`<aside>sidebar junk</aside><main><p>the results</p></main>`);
  const out = serializePage(doc);
  assert.match(out, /the results/);
  assert.ok(!out.includes('sidebar junk'));
});

test('serializePage respects the maxChars cap', () => {
  const doc = makeDom('<p>' + 'x'.repeat(5000) + '</p>');
  const out = serializePage(doc, { maxChars: 500 });
  assert.ok(out.length <= 500);
});

test('buildPageExtractPrompt includes the page text, search values, and notes', () => {
  const prompt = buildPageExtractPrompt('[Widget](/w) $5', {
    values: { q: 'widgets' },
    notes: ['price is in the .rate span'],
  });
  assert.ok(prompt.includes('[Widget](/w)'));
  assert.ok(prompt.includes('widgets'));
  assert.ok(prompt.includes('price is in the .rate span'));
});

test('buildPageExtractPrompt works with no values or notes', () => {
  const prompt = buildPageExtractPrompt('some page text', {});
  assert.ok(prompt.includes('some page text'));
});

test('shouldRescue: true when extraction found nothing', () => {
  assert.equal(shouldRescue([]), true);
  assert.equal(shouldRescue(null), true);
});

test('shouldRescue: true when only a single item was found (over-climb / no-fit)', () => {
  assert.equal(shouldRescue([{ name: 'Only One', url: '/x' }]), true);
});

test('shouldRescue: true when every result is a duplicate (same name)', () => {
  const dupes = [
    { name: 'Menu', url: '/a' },
    { name: 'Menu', url: '/b' },
    { name: 'Menu', url: '/c' },
  ];
  assert.equal(shouldRescue(dupes), true);
});

test('shouldRescue: false when several varied results were found', () => {
  const good = [
    { name: 'Hotel A', url: '/a' },
    { name: 'Hotel B', url: '/b' },
    { name: 'Hotel C', url: '/c' },
  ];
  assert.equal(shouldRescue(good), false);
});

test('shouldRescue: true when results fall well short of the requested count', () => {
  const few = [
    { name: 'A', url: '/a' },
    { name: 'B', url: '/b' },
  ];
  assert.equal(shouldRescue(few, 8), true); // 2 of 8 asked — the site clearly didn't fit
});

test('shouldRescue: false when the count is merely a little under requested', () => {
  const most = Array.from({ length: 20 }, (_, i) => ({ name: 'H' + i, url: '/h' + i }));
  assert.equal(shouldRescue(most, 30), false); // 20 of 30 is a normal full page, not a failure
});
