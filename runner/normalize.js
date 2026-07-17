// normalize.js — coerce structured results (from the LLM) into a fixed schema
// and drop junk. Pure; testable without a network call.
//
// Schema per row: { name, price, rating, image, url }
//   name  — required, non-empty string
//   url   — required, non-empty string (unique; first occurrence wins)
//   price — string or null
//   rating— number or null (parsed from the first number in the value)
//   image — string or null
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
      price: str(item.price),
      rating: num(item.rating),
      image: str(item.image),
      url,
    });
  }
  return out;
}

module.exports = { normalizeResults };
