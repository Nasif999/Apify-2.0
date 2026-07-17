// scrape.js — pull raw candidate result cards from a live page (Playwright).
//
// Deliberately generic: it collects card-like blocks (an element carrying an
// image, a link, and a meaningful chunk of text) rather than site-specific
// selectors. The messy job of turning these into clean fields (name/price/
// rating) is left to the DeepSeek structuring stage.
async function scrapeCards(page, opts = {}) {
  const max = opts.max || 30;
  return page.evaluate((max) => {
    const SELECTOR = [
      'article',
      '[role="article"]',
      '[data-testid*="card" i]',
      '[data-testid*="property" i]',
      '[class*="card" i]',
      '[class*="result" i]',
      '[class*="property" i]',
      'li',
    ].join(',');

    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const seen = new Set();
    const out = [];

    for (const el of document.querySelectorAll(SELECTOR)) {
      const img = el.querySelector('img');
      const link = el.querySelector('a[href]');
      if (!img || !link) continue;

      const text = clean(el.innerText);
      // Real result cards carry a name + price/rating: enough text, and at least
      // one digit. Filters out nav <li>s and image-only tiles.
      if (text.length < 25 || text.length > 1500) continue;
      if (!/\d/.test(text)) continue;

      const href = link.href;
      if (!href || seen.has(href)) continue;
      seen.add(href);

      out.push({
        text: text.slice(0, 600),
        href,
        img: img.currentSrc || img.src || '',
      });
      if (out.length >= max) break;
    }
    return out;
  }, max);
}

module.exports = { scrapeCards };
