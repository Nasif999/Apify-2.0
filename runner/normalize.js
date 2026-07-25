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

// Per-item type, decided by the extractor (AI or heuristic), not the whole
// run: 'card' (default) is a comparable linkable item and requires a url,
// exactly as before. 'text' is a fact/row with no natural per-item link (a
// data table row, an informational fact) — only a name is required, and it
// dedupes by name instead of url. Deciding this per item (rather than
// forcing one shape on the entire run) is what lets a page that mixes real
// linkable results with a url-less fact (or vice versa) keep both instead of
// one shape silently eating the other. Any item that doesn't say 'text'
// stays 'card' — the default is unchanged from before per-item types existed.
function normalizeResults(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const type = item.type === 'text' ? 'text' : 'card';
    const name = str(item.name);
    const url = str(item.url);
    if (!name) continue;
    if (type === 'card' && !url) continue;
    const dedupeKey = url || name;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      name,
      subtitle: str(item.subtitle),
      price: str(item.price),
      rating: num(item.rating),
      metrics: item.metrics && typeof item.metrics === 'object' ? item.metrics : {},
      image: str(item.image),
      url,
      type,
    });
  }
  // When some card rows are bare-duration fragments and others aren't, drop
  // just the fragments. If none are (or all are, within the card subset),
  // leave the set untouched — never wipe out a page's entire result set.
  // Scoped to card rows only — text rows never carry a video duration, and
  // shouldn't be counted toward "are all of them fragments".
  const cardRows = out.filter((r) => r.type === 'card');
  const fragments = cardRows.filter(isBareDurationFragment);
  if (fragments.length && fragments.length < cardRows.length) return out.filter((r) => !fragments.includes(r));
  return out;
}

// A synthesized write-up for informational content — a headline, a short
// prose answer, and organized key facts, closer to a Wikipedia intro/infobox
// or an assistant's answer than a stack of scraped rows. Optional: a
// comparable listing (hotels, videos) has no single "answer" to write, so the
// extractor leaves this null and only items apply. Returns null unless at
// least one of headline/text/facts has real content, so a page with nothing
// worth summarizing doesn't get an empty summary block rendered for it.
function normalizeSummary(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const headline = str(raw.headline);
  const text = str(raw.text);
  const factsRaw = raw.facts && typeof raw.facts === 'object' ? raw.facts : {};
  const facts = {};
  for (const [k, v] of Object.entries(factsRaw)) {
    const val = str(v);
    if (val) facts[k] = val;
  }
  if (!headline && !text && Object.keys(facts).length === 0) return null;
  return { headline, text, facts };
}

module.exports = { normalizeResults, normalizeSummary };
