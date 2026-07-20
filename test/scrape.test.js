const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDom } = require('./_setup');
const { extractCards, imgSrc } = require('../runner/scrape');

test('finds a link+image nested inside a shadow root (web-component sites)', () => {
  const doc = makeDom(`<my-card>Product Alpha — costs 42 dollars</my-card>`);
  const host = doc.querySelector('my-card');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<a href="/product/alpha"><img src="/alpha.jpg" /></a>`;

  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].href, '/product/alpha');
  assert.equal(cards[0].img, '/alpha.jpg');
  assert.match(cards[0].text, /Product Alpha/);
});

test('finds a link nested inside TWO levels of shadow root', () => {
  const doc = makeDom(`<outer-card>Nested Widget — priced at 10 dollars</outer-card>`);
  const outerHost = doc.querySelector('outer-card');
  const outerShadow = outerHost.attachShadow({ mode: 'open' });
  const innerHost = doc.createElement('inner-card');
  outerShadow.appendChild(innerHost);
  const innerShadow = innerHost.attachShadow({ mode: 'open' });
  innerShadow.innerHTML = `<a href="/nested/1"><img src="/n1.jpg" /></a>`;

  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].href, '/nested/1');
});

test('imgSrc prefers currentSrc, then a real src, then lazy-load data attributes', () => {
  const doc = makeDom(`
    <img id="a" src="https://x/real.jpg" />
    <img id="b" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://x/lazy.jpg" />
    <img id="c" data-original="https://x/orig.jpg" />
    <img id="d" srcset="https://x/set1.jpg 1x, https://x/set2.jpg 2x" />
    <img id="e" />
  `);
  assert.equal(imgSrc(doc.getElementById('a')), 'https://x/real.jpg');
  assert.equal(imgSrc(doc.getElementById('b')), 'https://x/lazy.jpg');
  assert.equal(imgSrc(doc.getElementById('c')), 'https://x/orig.jpg');
  assert.equal(imgSrc(doc.getElementById('d')), 'https://x/set1.jpg');
  assert.equal(imgSrc(doc.getElementById('e')), '');
  assert.equal(imgSrc(null), '');
});

test('finds a plain div-based card (booking.com style)', () => {
  const doc = makeDom(`
    <li>
      <a href="https://example.com/hotel/1">
        <img src="/h1.jpg" />
        <div>Hotel Grand Pacific</div>
        <div>★ 8.7 · BDT 612,927</div>
      </a>
    </li>
  `);
  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].href, 'https://example.com/hotel/1');
  assert.match(cards[0].text, /Hotel Grand Pacific/);
});

test('finds a custom-element card with no matching tag/class (YouTube style)', () => {
  const doc = makeDom(`
    <ytd-video-renderer>
      <a href="https://www.youtube.com/watch?v=abc123">
        <img src="/thumb.jpg" />
      </a>
      <span>Some Video Title</span>
      <span>1.2M views · 3 years ago</span>
    </ytd-video-renderer>
  `);
  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].href, 'https://www.youtube.com/watch?v=abc123');
  assert.match(cards[0].text, /Some Video Title/);
  assert.deepEqual(cards[0].lines, ['Some Video Title', '1.2M views · 3 years ago']);
});

test('skips a link with no nearby image', () => {
  const doc = makeDom(`<a href="/nav">Home 2024</a>`);
  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 0);
});

test('skips a link whose card text has no digits', () => {
  const doc = makeDom(`
    <li>
      <a href="/x"><img src="/i.jpg" /><div>Just some plain descriptive text with no numbers at all here</div></a>
    </li>
  `);
  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 0);
});

test('dedups when multiple links share the same card container', () => {
  const doc = makeDom(`
    <li>
      <a href="/a"><img src="/i.jpg" /></a>
      <a href="/b">Extra link</a>
      <div>Card Name 42 reviews</div>
    </li>
  `);
  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 1);
});

test('respects the max cap', () => {
  const items = Array.from({ length: 5 }, (_, i) =>
    `<li><a href="/item${i}"><img src="/i${i}.jpg" /><div>Product number ${i}</div><div>Price $${i}9.99 · rating 4.${i}</div></a></li>`
  ).join('');
  const doc = makeDom(items);
  const cards = extractCards(doc, 3);
  assert.equal(cards.length, 3);
});

test('ignores a zero-size accessibility-only leaf when the container has real layout', () => {
  const doc = makeDom(`
    <ytd-video-renderer>
      <a href="/watch?v=abc"><img src="/thumb.jpg" /></a>
      <span class="ghost">Now playing</span>
      <div>Real Video Title</div>
      <div>10M views</div>
    </ytd-video-renderer>
  `);
  const container = doc.querySelector('ytd-video-renderer');
  const ghost = doc.querySelector('.ghost');
  const realLeaves = Array.from(container.querySelectorAll('*')).filter(
    (el) => el !== ghost && el.children.length === 0
  );
  container.getBoundingClientRect = () => ({ width: 300, height: 100 });
  ghost.getBoundingClientRect = () => ({ width: 0, height: 0 });
  for (const el of realLeaves) el.getBoundingClientRect = () => ({ width: 100, height: 20 });

  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].lines, ['Real Video Title', '10M views']);
});

test('keeps a single card even when its chapter list carries a thumbnail per chapter', () => {
  const chapters = Array.from({ length: 15 }, (_, i) =>
    `<a href="/watch?v=xyz&t=${i * 20}s"><img src="/ch${i}.jpg" />Chapter ${i} 0:${i}0</a>`
  ).join('');
  const doc = makeDom(`
    <ytd-video-renderer>
      <a href="/watch?v=xyz"><img src="/thumb.jpg" /></a>
      <div>1 A.M Study Session [lofi hip hop]</div>
      <div>134M views</div>
      <div>${chapters}</div>
    </ytd-video-renderer>
  `);
  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].href, '/watch?v=xyz');
});

test('still rejects a wrapper genuinely merging several image-heavy cards', () => {
  // Short per-item text forces the climb past each <li> (too short on its
  // own) up to the shared <body> — which, with 3 images × 10 items, is
  // clearly a many-card wrapper and must be rejected outright rather than
  // merged into one bogus card.
  const items = Array.from({ length: 10 }, (_, i) =>
    `<li><a href="/item${i}"><img src="/i${i}.jpg" /><img src="/t${i}.jpg" /><img src="/b${i}.jpg" />Item ${i}</a></li>`
  ).join('');
  const doc = makeDom(items);
  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 0);
});

test('keeps a single card even when it nests many links (a video with an expandable chapter list)', () => {
  const chapters = Array.from({ length: 28 }, (_, i) =>
    `<a href="/watch?v=xyz&t=${i * 20}s">Chapter ${i} 0:${i}0</a>`
  ).join('');
  const doc = makeDom(`
    <ytd-video-renderer>
      <a href="/watch?v=xyz"><img src="/thumb.jpg" /></a>
      <div>1 A.M Study Session [lofi hip hop]</div>
      <div>134M views</div>
      <div>6 years ago</div>
      <div>${chapters}</div>
    </ytd-video-renderer>
  `);
  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].href, '/watch?v=xyz');
  assert.match(cards[0].text, /1 A\.M Study Session/);
});

test('does not collapse several sibling cards into one shared wrapper', () => {
  const items = Array.from({ length: 5 }, (_, i) =>
    `<li><a href="/item${i}"><img src="/i${i}.jpg" /><div>Product number ${i}</div><div>Price $${i}9.99 · rating 4.${i}</div></a></li>`
  ).join('');
  const doc = makeDom(items);
  const cards = extractCards(doc, 30);
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map((c) => c.href), ['/item0', '/item1', '/item2', '/item3', '/item4']);
});
