// structure.js — turn raw scraped cards into normalized result rows.
//
// Primary path: DeepSeek (OpenAI-compatible chat API) structures the messy card
// text into { name, price, rating, image, url }. Fallback path: a deterministic
// heuristic parser, used when no DEEPSEEK_API_KEY is present or the call fails —
// so a run always returns *something* usable.
const fs = require('fs');
const path = require('path');
const { normalizeResults } = require('./normalize');

// Minimal .env loader (no dependency): KEY=value lines, quotes stripped.
function loadEnv(dir) {
  try {
    const text = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* no .env — fine */
  }
}

// Deterministic fallback: pull name/price/rating from a card's text with regexes.
function heuristicParse(cards) {
  const PRICE = /(৳|BDT|USD|US\$|\$|€|£)\s?[\d,]+(?:\.\d+)?/i;
  const RATING = /Scored\s+(\d+(?:\.\d+)?)|\b(\d(?:\.\d)?)\s*\/\s*10\b/i;
  return (cards || []).map((c) => {
    const text = c.text || '';
    const name = text
      .split(/Opens in new window|Show on map|Scored|\d+\s+reviews/i)[0]
      .trim()
      .slice(0, 120);
    const priceM = text.match(PRICE);
    const ratingM = text.match(RATING);
    return {
      name,
      price: priceM ? priceM[0] : null,
      rating: ratingM ? ratingM[1] || ratingM[2] : null,
      image: c.img || null,
      url: c.href || null,
    };
  });
}

function extractJsonArray(content) {
  // Model may wrap JSON in prose or ```json fences; grab the first [...] block.
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : content;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callDeepSeek(cards, apiKey, opts = {}) {
  const prompt =
    'From the following list of scraped result cards, extract each real result as ' +
    'an object with keys: name, price, rating, image, url. Use the card\'s href for ' +
    'url and img for image. Return ONLY a JSON array, no prose.\n\n' +
    JSON.stringify(cards, null, 2);

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: opts.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You extract structured data and reply with JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek HTTP ${resp.status}`);
  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message.content;
  const arr = extractJsonArray(content || '');
  if (!arr) throw new Error('DeepSeek returned no parseable JSON array');
  return arr;
}

// Structure raw cards → normalized rows. Returns { results, engine }.
async function structureResults(cards, opts = {}) {
  loadEnv(opts.envDir || process.cwd());
  const key = process.env.DEEPSEEK_API_KEY;
  let items;
  let engine;
  // Heuristic is the default (free, no API). DeepSeek is opt-in via opts.ai and
  // only used when a key is present; it falls back to heuristic on failure.
  if (opts.ai && key) {
    try {
      items = await callDeepSeek(cards, key, opts);
      engine = 'deepseek';
    } catch (e) {
      items = heuristicParse(cards);
      engine = `heuristic (deepseek failed: ${e.message})`;
    }
  } else {
    items = heuristicParse(cards);
    engine = opts.ai ? 'heuristic (no DEEPSEEK_API_KEY)' : 'heuristic';
  }
  return { results: normalizeResults(items), engine };
}

module.exports = { structureResults, heuristicParse, extractJsonArray, loadEnv };
