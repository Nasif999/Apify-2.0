// scrape.js — pull raw candidate result cards from a live page (Playwright).
//
// Deliberately generic: no tag names, class names, or "cards"/"articles" hints.
// Real sites vary too much (custom elements like <ytd-video-renderer>, plain
// <div>s, semantic <article>s) for a fixed selector list to hold up everywhere.
// Instead: find every link, then walk up from it to the nearest ancestor that
// also carries an image and a meaningful chunk of digit-bearing text (a
// price/rating/view-count) — that ancestor is the "card". Works the same way
// on booking.com's div soup and YouTube's custom elements.

// Native querySelectorAll never descends into shadow roots — a site built
// with web components (common for date pickers, custom selects, design
// systems) would silently look empty. Walk shadow trees explicitly so the
// same query reaches content wrapped in one (or several, nested) of them.
function deepQueryAll(root, selector) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    // The root itself can BE a shadow host (this is exactly what happens when
    // card-climbing lands on one) — check its own shadowRoot, not just
    // descendants'.
    if (node.shadowRoot) walk(node.shadowRoot);
    if (!node.querySelectorAll) return;
    out.push(...node.querySelectorAll(selector));
    for (const el of node.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(root);
  return out;
}

function deepQuery(root, selector) {
  const walk = (node) => {
    if (!node) return null;
    if (node.shadowRoot) {
      const inShadow = walk(node.shadowRoot);
      if (inShadow) return inShadow;
    }
    if (!node.querySelector) return null;
    const hit = node.querySelector(selector);
    if (hit) return hit;
    for (const el of node.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const inner = walk(el.shadowRoot);
        if (inner) return inner;
      }
    }
    return null;
  };
  return walk(root);
}

// `.parentElement` is null once climbing reaches the top of a shadow root —
// it has no parent element of its own, even though its host element (out in
// the light DOM, or another shadow root) is the logical continuation. Cross
// that boundary transparently so climbing from inside a shadow tree keeps
// working exactly like climbing through regular nested elements.
function parentOrHost(el) {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode && el.getRootNode();
  return root && root.host ? root.host : null;
}
// Pull each leaf element's own text out of a card container, in document
// order, deduped. This gives back the card's original "lines" (title,
// channel, views, price, rating — whatever the site actually shows) instead
// of one flattened blob, so the structuring stage can tell them apart. Works
// the same whether the site used <div>s, <span>s, or table cells for layout.
function cardLines(container, clean) {
  const lines = [];
  // Sites sometimes stash accessibility-only or state-badge text (e.g. a
  // zero-size "Now playing" label overlaid on a mix's thumbnail) as an
  // ordinary leaf element. A real layout engine reports these as 0×0, so skip
  // them there — but jsdom has no layout engine at all (every element is
  // always 0×0), so only apply this once the container itself measures as
  // real content; otherwise the check would wipe out every test fixture.
  const cRect = container.getBoundingClientRect && container.getBoundingClientRect();
  const containerHasLayout = !!(cRect && (cRect.width > 0 || cRect.height > 0));
  const leaves = deepQueryAll(container, '*');
  for (const el of leaves) {
    if (el.children.length > 0) continue; // only leaf nodes carry a distinct line
    if (containerHasLayout) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
    }
    const t = clean(el.innerText || el.textContent);
    if (t && lines[lines.length - 1] !== t) lines.push(t);
  }
  if (!lines.length) {
    const t = clean(container.innerText || container.textContent);
    if (t) lines.push(t);
  }
  return lines;
}

// Many sites lazy-load thumbnails: `src` stays a blank placeholder until the
// image scrolls into view, with the real URL parked in a `data-*` attribute
// or `srcset` in the meantime. Try the common spots, in order of reliability.
function imgSrc(img) {
  if (!img) return '';
  if (img.currentSrc) return img.currentSrc;
  const src = img.getAttribute('src') || '';
  if (src && !/^data:image\/gif/i.test(src)) return src;
  const lazyAttr =
    img.getAttribute('data-src') ||
    img.getAttribute('data-original') ||
    img.getAttribute('data-lazy-src') ||
    img.getAttribute('data-thumb');
  if (lazyAttr) return lazyAttr;
  const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
  if (srcset) return srcset.split(',')[0].trim().split(/\s+/)[0];
  return src;
}

function extractCards(doc, max) {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const accepted = []; // containers already claimed as a card
  const out = [];

  for (const link of deepQueryAll(doc, 'a[href]')) {
    let container = null;
    let el = link;
    for (let hops = 0; hops < 6 && el; hops++, el = parentOrHost(el)) {
      const img = deepQuery(el, 'img');
      if (!img) continue;
      const text = clean(el.innerText || el.textContent);
      // Real result cards carry a name + price/rating/count: enough text, and
      // at least one digit. Filters out nav links and image-only tiles. The
      // upper bound is generous — a single card can legitimately be verbose
      // (e.g. a video's chapter list expanded into its card's text).
      if (text.length < 25 || text.length > 3000) continue;
      if (!/\d/.test(text)) continue;
      // Reject only if we climbed onto a wrapper around SEVERAL cards, not a
      // single card that happens to nest many images (e.g. a video's own
      // expandable chapter list carries a small thumbnail per chapter, easily
      // a dozen-plus, all within ONE card). A shared wrapper of many cards
      // has far more than that — this threshold sits well below "a whole
      // results list" and well above "one card's internal thumbnails".
      if (deepQueryAll(el, 'img').length > 20) continue;
      container = el;
      break;
    }
    if (!container) continue;
    // A sub-component of an already-claimed card (e.g. its chapter-list
    // wrapper) can independently satisfy the same checks and look like a
    // second, distinct card — reject anything overlapping (ancestor OR
    // descendant of) a container we've already accepted.
    if (accepted.some((prev) => prev === container || prev.contains(container) || container.contains(prev))) {
      continue;
    }
    accepted.push(container);

    const img = deepQuery(container, 'img');
    out.push({
      text: clean(container.innerText || container.textContent).slice(0, 600),
      lines: cardLines(container, clean).slice(0, 20),
      href: link.href,
      img: imgSrc(img),
    });
    if (out.length >= max) break;
  }
  return out;
}

async function scrapeCards(page, opts = {}) {
  const max = opts.max || 30;
  // Reuse extractCards' exact source in the page context (via an expression
  // string) so the same code is exercised in tests (jsdom, passing `document`
  // explicitly) and in the real browser (implicit global `document`). Its
  // helpers must be inlined too — only the passed function's own source
  // crosses into the page, not the rest of this module.
  const src = `(function(){ ${deepQueryAll.toString()} ${deepQuery.toString()} ${parentOrHost.toString()} ${cardLines.toString()} ${imgSrc.toString()} return (${extractCards.toString()})(document, ${max}); })()`;
  return page.evaluate(src);
}

module.exports = { scrapeCards, extractCards, imgSrc, deepQueryAll, deepQuery, parentOrHost };
