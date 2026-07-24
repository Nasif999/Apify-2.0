// pageExtract.js — the generalization path: extract results from ANY page.
//
// scrape.js's card detector assumes each result is a link wrapping an image
// plus digit-bearing text. That fits shopping/video/hotel listings but not
// text-only lists, tables, thumbnail-less job/news/wiki results, or search
// engines — so a new site whose results don't take that shape yields nothing
// (or one over-climbed blob). This module makes NO structural assumption:
// it serializes the whole rendered page to clean, link/image-preserving
// markdown (in reading order), then lets the LLM pick out the repeated result
// items. That's how it generalizes across sites we never tuned for.
//
// Used as a RESCUE, not a replacement: replay-runner only falls back to it
// when the proven card path underdelivers (see shouldRescue), so tuned sites
// keep their fast, free path and incur no extra cost.
const { chatJSON, extractJsonArray, notesPrefix } = require('./structure');
const { normalizeResults } = require('./normalize');
const { assessResults } = require('./verify');
const { imgSrc } = require('./scrape');

// Walk the rendered DOM into compact markdown: links as [text](href), images
// as ![](src), headings prefixed with #, everything else as plain text in
// reading order. Drops scripts/styles/SVG and page chrome (nav/header/footer/
// aside) so the results dominate the limited character budget. Self-contained
// (defines its own `clean`, uses only the passed-in imgSrc) so its source can
// be `.toString()`-injected into page.evaluate for the real browser, while
// staying unit-testable against jsdom here.
function serializePage(root, opts) {
  opts = opts || {};
  const maxChars = opts.maxChars || 40000;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'TEMPLATE']);
  const out = [];
  let len = 0;
  const push = (s) => {
    if (!s) return len < maxChars;
    out.push(s);
    len += s.length + 1;
    return len < maxChars;
  };
  const walk = (node) => {
    if (len >= maxChars) return false;
    if (node.nodeType === 1) {
      const tag = node.tagName;
      if (SKIP.has(tag)) return true;
      const style = (node.getAttribute && node.getAttribute('style')) || '';
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true;
      if (node.hasAttribute && node.hasAttribute('hidden')) return true;

      if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        const text = clean(node.textContent);
        const img = node.querySelector && node.querySelector('img');
        const src = img ? imgSrc(img) : '';
        if (text || src) push(`[${text}](${href})${src ? ` ![](${src})` : ''}`);
        return len < maxChars; // already captured; don't re-descend
      }
      if (tag === 'IMG') {
        const src = imgSrc(node);
        if (src) push(`![](${src})`);
        return len < maxChars;
      }
      if (/^H[1-6]$/.test(tag)) {
        push(`\n# ${clean(node.textContent)}`);
        return len < maxChars;
      }
      for (const child of node.childNodes) {
        if (!walk(child)) return false;
      }
      return len < maxChars;
    }
    if (node.nodeType === 3) return push(clean(node.textContent));
    return len < maxChars;
  };

  const start = (root.querySelector && root.querySelector('main')) || root.body || root;
  walk(start);
  return out.join('\n').slice(0, maxChars);
}

function buildPageExtractPrompt(pageText, opts = {}) {
  const { values, notes } = opts;
  const queryContext =
    values && Object.keys(values).length ? `The user is searching for: ${JSON.stringify(values)}.\n\n` : '';
  return (
    notesPrefix(notes) +
    queryContext +
    'Below is the readable content of a web page (a search-results or listing page), in markdown. ' +
    'Extract the actual result/listing items — the repeated set of things the page presents ' +
    '(products, hotels, videos, jobs, articles, places, etc.) — as a JSON array of objects with keys: ' +
    'name, subtitle, price, rating, image, url, and metrics (an object of any other useful facts). ' +
    'Use each item\'s markdown link target for url and image target for image. Ignore navigation, ads, ' +
    'headers, footers, cookie banners, and unrelated links. Return ONLY a JSON array, no prose.\n\n' +
    pageText
  );
}

// Should the whole-page rescue run? Only when the proven card path came up
// short: nothing found, a single (often over-climbed) blob, every row really
// the same element (assessResults' duplicate detection), or a count that falls
// well below what was requested (the site's results didn't fit the card
// shape, so most were missed). A healthy full page never triggers it, so
// tuned sites pay nothing extra. The half-of-requested threshold tolerates a
// normal short last page (e.g. 20 of 30) while catching real misses (2 of 8).
function shouldRescue(results, requested) {
  const n = results ? results.length : 0;
  if (n <= 1) return true;
  if (assessResults(results).suspicious) return true;
  if (requested && n < requested * 0.5) return true;
  return false;
}

// Live wrapper (not unit-tested; verified against real pages) — serialize the
// current page in the browser context, then LLM-extract from it.
async function extractFromPage(page, opts = {}) {
  const maxChars = opts.maxChars || 40000;
  const src = `(function(){ ${imgSrc.toString()} return (${serializePage.toString()})(document, { maxChars: ${maxChars} }); })()`;
  const pageText = await page.evaluate(src);
  const content = await chatJSON(
    'You extract structured listing data from a web page and reply with JSON only.',
    buildPageExtractPrompt(pageText, opts),
    opts.apiKey,
    opts
  );
  const arr = extractJsonArray(content);
  if (!arr) throw new Error('page-extract returned no parseable JSON array');
  return { results: normalizeResults(arr), engine: 'deepseek-pagewalk' };
}

module.exports = { serializePage, buildPageExtractPrompt, shouldRescue, extractFromPage };
