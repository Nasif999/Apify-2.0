// popups.js — dismiss overlays that block a page (cookie/consent banners,
// newsletter/sign-in modals, interstitials) during replay.
//
// Site-agnostic: it looks for visible dialog/overlay containers and clicks a
// dismiss-like control inside (close / no thanks / reject / got it). For consent
// banners it prefers reject/decline (privacy-preserving) over accept.
async function dismissPopups(page, opts = {}) {
  const passes = opts.passes || 3;
  let total = 0;
  for (let i = 0; i < passes; i++) {
    const closed = await page.evaluate(() => {
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
      };
      const labelOf = (el) =>
        ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).replace(/\s+/g, ' ').trim();

      // Prefer decline/close over accept; accept only as a last resort to unblock.
      const DISMISS = /\b(close|dismiss|no thanks|not now|maybe later|reject|decline|refuse|skip)\b|^(×|✕|✖|x)$/i;
      const ACCEPT = /\b(accept|agree|got it|ok|continue|allow all)\b/i;

      const CONTAINERS =
        '[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="popup" i],[class*="overlay" i],[id*="cookie" i],[class*="cookie" i],[class*="consent" i],[id*="consent" i]';

      let closed = 0;
      const containers = [...document.querySelectorAll(CONTAINERS)].filter(isVisible);
      for (const c of containers) {
        const btns = [...c.querySelectorAll('button,[role="button"],a')].filter(isVisible);
        if (!btns.length) continue;
        const target =
          btns.find((b) => DISMISS.test(labelOf(b))) || btns.find((b) => ACCEPT.test(labelOf(b)));
        if (target) {
          target.click();
          closed++;
        }
      }

      // Fallback: a standalone close/dismiss control not inside a matched container.
      if (!closed) {
        const x = [...document.querySelectorAll('[aria-label*="close" i],[aria-label*="dismiss" i]')]
          .filter(isVisible)[0];
        if (x) {
          x.click();
          closed++;
        }
      }
      return closed;
    });
    total += closed;
    if (!closed) break;
    await page.waitForTimeout(400);
  }
  return total;
}

module.exports = { dismissPopups };
