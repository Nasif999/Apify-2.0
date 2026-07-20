// normalize.js — coerce structured results (from the LLM) into a fixed schema
// and drop junk. Pure; testable without a network call.
//
// Schema per row: { name, subtitle, price, rating, metrics, image, url }
//   name    — required, non-empty string
//   url     — required, non-empty string (unique; first occurrence wins)
//   subtitle— string or null (channel/seller/location — whatever sits under the title)
//   price   — string or null
//   rating  — number or null (parsed from the first number in the value)
//   metrics — object of any other recognized facts (views, subscribers, duration, ...)
//   image   — string or null
function str(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
}

function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// A "bare duration fragment" is the specific junk pattern this guards
// against: video pages commonly mix real search results with chapter/segment
// fragments of one of those videos (same clip, different timestamps) whose
// ONLY carried fact is a duration — nothing else. That's a precise, narrow
// signal, not "lacks a rating": plenty of genuinely distinct, real results
// (a hotel listing with no reviews yet) have no rating/price/metrics at all
// and never had a duration to begin with — duration doesn't even apply
// outside video-like content. Excluding on "not substantive" alone (rather
// than "IS a duration-only fragment") wrongly discarded those real listings
// — this must not fire just because a row happens to be thin on data.
function isBareDurationFragment(r) {
  const m = r.metrics || {};
  const hasDuration = !!m.duration;
  const hasOtherSignal = r.price != null || r.rating != null || !!(m.views || m.subscribers || m.reviews || m.watching);
  return hasDuration && !hasOtherSignal;
}

function normalizeResults(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const name = str(item.name);
    const url = str(item.url);
    if (!name || !url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      name,
      subtitle: str(item.subtitle),
      price: str(item.price),
      rating: num(item.rating),
      metrics: item.metrics && typeof item.metrics === 'object' ? item.metrics : {},
      image: str(item.image),
      url,
    });
  }
  // When some rows are bare-duration fragments and others aren't, drop just
  // the fragments. If none are (or all are), leave the set untouched — never
  // wipe out a page's entire result set.
  const fragments = out.filter(isBareDurationFragment);
  if (fragments.length && fragments.length < out.length) return out.filter((r) => !isBareDurationFragment(r));
  return out;
}

module.exports = { normalizeResults };
