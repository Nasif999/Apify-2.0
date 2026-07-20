// verify.js — a sanity-check gate on structured results, run right before they
// reach a customer. Catches the failure modes that don't look like an error
// (the run "succeeds" and returns something) but are actually a broken
// scrape: every row is really the same element, or extraction produced
// near-nothing usable. Pure; no site-specific knowledge.
function assessResults(results) {
  const rows = results || [];
  if (rows.length <= 1) return { suspicious: false, reason: null };

  const names = rows.map((r) => (r.name || '').trim().toLowerCase());
  const urls = rows.map((r) => r.url);
  const uniqueNames = new Set(names);
  const uniqueUrls = new Set(urls);

  if (uniqueNames.size === 1) {
    return { suspicious: true, reason: 'Every result has the same name — likely scraping the same element repeatedly.' };
  }
  if (uniqueUrls.size === 1) {
    return { suspicious: true, reason: 'Every result points to the same URL — likely scraping the same element repeatedly.' };
  }
  return { suspicious: false, reason: null };
}

module.exports = { assessResults };
