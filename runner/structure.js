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

// Recognize a single card "line" (one leaf element's text) as a known metric.
// These patterns are generic content shapes (a view count, a duration
// timestamp, a relative date, a price, a star rating) that show up across very
// different sites — a video site, a hotel search, a shop listing — not
// anything specific to one of them.
function classifyLine(line) {
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(line)) return { key: 'duration', value: line };
  if (/^\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.test(line)) {
    return { key: 'publishedAgo', value: line };
  }
  let m = line.match(/^([\d.,]+\s*[KMB]?\+?)\s*views?$/i);
  if (m) return { key: 'views', value: m[1].trim() };
  m = line.match(/^([\d.,]+\s*[KMB]?\+?)\s*watching$/i);
  if (m) return { key: 'watching', value: m[1].trim() };
  m = line.match(/^([\d.,]+\s*[KMB]?\+?)\s*subscribers?$/i);
  if (m) return { key: 'subscribers', value: m[1].trim() };
  m = line.match(/^([\d,]+)\s*reviews?$/i);
  if (m) return { key: 'reviews', value: m[1] };
  // Anchored to the whole line (with an optional short "/mo" suffix) — a
  // price badge is its own short line, not a stray "$" anywhere inside a long
  // description sentence (e.g. a sponsor plug that happens to mention money).
  m = line.match(/^\s*(৳|BDT|USD|US\$|\$|€|£)\s?[\d,]+(?:\.\d+)?(\s*\/\s*\w+)?\s*$/i);
  if (m) return { key: 'price', value: line.trim() };
  if (/★|stars?\b|Scored\b|\/\s*\d+\s*$/i.test(line)) {
    m = line.match(/Scored\s+(\d+(?:\.\d+)?)/i) || line.match(/★\s*(\d(?:\.\d)?)/) || line.match(/^(\d(?:\.\d)?)/);
    if (m) return { key: 'rating', value: m[1] };
  }
  // A bare status word/phrase, not a title — the same handful show up across
  // video and streaming sites regardless of which one it is (a mix/radio
  // card, a livestream, an upcoming premiere).
  if (/^(now playing|live now|live|premiere|premiering now|on air)$/i.test(line)) {
    return { key: 'status', value: line };
  }
  return null;
}

// Split a card's lines into recognized metrics + leftover free-text lines.
// The first leftover line is the title, the second (if any) is a subtitle
// (channel name, location, seller — whatever the site puts right under the
// title, generically).
function parseLines(lines) {
  const metrics = {};
  const rest = [];
  for (const line of lines) {
    const hit = classifyLine(line);
    if (hit && !(hit.key in metrics)) metrics[hit.key] = hit.value;
    else if (!hit) rest.push(line);
  }
  return {
    name: rest[0] ? rest[0].slice(0, 120) : null,
    subtitle: rest[1] ? rest[1].slice(0, 120) : null,
    metrics,
  };
}

// Deterministic fallback: pull structured fields from a card's lines (or, if a
// card carries no lines, its flattened text) with regexes.
function heuristicParse(cards) {
  const PRICE = /(৳|BDT|USD|US\$|\$|€|£)\s?[\d,]+(?:\.\d+)?/i;
  const RATING = /Scored\s+(\d+(?:\.\d+)?)|\b(\d(?:\.\d)?)\s*\/\s*10\b/i;
  return (cards || []).map((c) => {
    if (Array.isArray(c.lines) && c.lines.length) {
      const { name, subtitle, metrics } = parseLines(c.lines);
      const text = c.text || '';
      return {
        name: name || text.slice(0, 120),
        subtitle,
        price: metrics.price || null,
        rating: metrics.rating || null,
        metrics,
        image: c.img || null,
        url: c.href || null,
      };
    }
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

// Shared DeepSeek chat-completion call — every caller in this codebase wants
// the same request shape and just varies the system/user prompt. Returns the
// raw text content; each caller parses it however it needs (JSON array here,
// a filtered key list in paramClassify.js).
async function chatJSON(systemPrompt, userPrompt, apiKey, opts = {}) {
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: opts.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.choices && data.choices[0] && data.choices[0].message.content) || '';
}

// Classify whether scraped cards came from a comparable LISTING (hotels,
// flights, products, videos -- items meant to be compared side by side) or
// INFORMATIONAL content (a bio, encyclopedia entry, news article, cast/crew
// page -- one topic's facts, not a set of comparable items). A listing site
// forced through a name/price/rating schema works fine; an informational
// page forced through the same schema produces the "random results" the
// user saw on IMDb (a chart/actor-page/editorial-list treated as if it were
// one of ten comparable hotels). Additive-only: any failure here (no key,
// network error, unparseable/ambiguous reply) falls back to 'listing' --
// exactly today's existing behavior -- so this can only change output for
// pages confidently identified as informational, never regress a listing site.
function buildKindPrompt(sample) {
  const { domain, cards = [] } = sample || {};
  const excerpt = cards
    .slice(0, 5)
    .map((c, i) => `${i + 1}. ${(c.text || (c.lines || []).join(' | ') || '').slice(0, 200)}`)
    .join('\n');
  return (
    `These are excerpts from result items scraped from a search on ${domain || 'a website'}.\n\n` +
    `${excerpt}\n\n` +
    'Reply with exactly one word: LISTING or INFORMATIONAL.\n' +
    'LISTING: items meant to be compared side by side (hotels, flights, products, videos, jobs).\n' +
    'INFORMATIONAL: editorial/reference content about a single topic (a biography, an encyclopedia ' +
    'entry, a news article, a cast/crew page, a ranking/chart write-up) where the useful output is ' +
    'facts about that topic, not a set of comparable items.'
  );
}

function parseKind(content) {
  const upper = String(content || '').toUpperCase();
  return upper.includes('INFORMATIONAL') ? 'informational' : 'listing';
}

async function classifySiteKind(sample, apiKey, opts = {}) {
  try {
    const content = await chatJSON(
      'You classify the kind of scraped web content and reply with one word only.',
      buildKindPrompt(sample),
      apiKey,
      opts
    );
    return parseKind(content);
  } catch {
    return 'listing';
  }
}

// Extraction for INFORMATIONAL pages: same output schema as callDeepSeek
// (name/subtitle/price/rating/image/url/metrics) so downstream code never
// needs to special-case the two kinds -- only WHAT gets extracted differs.
// Folding in the user's search values (whatever they typed/picked to run
// this automation) lets the AI target the facts relevant to that search,
// instead of guessing from the cards alone.
// A per-automation list of user-confirmed corrections (see buildFixPrompt) --
// plain free-text notes, not a DSL, so they can express anything a report
// covers ("price is in .rate not .price", "always include amenities") without
// us having to model every possible fix shape up front.
function notesPrefix(notes) {
  return notes && notes.length
    ? `Known corrections for this site (apply them):\n${notes.map((n) => `- ${n}`).join('\n')}\n\n`
    : '';
}

function buildInformationalPrompt(cards, values, notes) {
  const queryContext =
    values && Object.keys(values).length ? `The user searched for: ${JSON.stringify(values)}.\n\n` : '';
  return (
    notesPrefix(notes) +
    queryContext +
    'The following are scraped fragments from an INFORMATIONAL page (not a shopping/listing results ' +
    'page) -- e.g. a biography, encyclopedia entry, news article, or cast/crew page. Extract the facts ' +
    'most relevant to what the user searched for, as a JSON array of objects with keys: name (the ' +
    'specific person/entity/fact), subtitle (a short detail answering the search), price (null unless a ' +
    'real price applies), rating (null unless a real rating applies), image, url, and metrics (any other ' +
    'relevant facts as key/value pairs). Return ONLY a JSON array, no prose.\n\n' +
    JSON.stringify(cards, null, 2)
  );
}

async function callDeepSeekInformational(cards, values, apiKey, opts = {}) {
  const content = await chatJSON(
    'You extract information relevant to a search query and reply with JSON only.',
    buildInformationalPrompt(cards, values, opts.notes),
    apiKey,
    opts
  );
  const arr = extractJsonArray(content);
  if (!arr) throw new Error('DeepSeek returned no parseable JSON array');
  return arr;
}

async function callDeepSeek(cards, apiKey, opts = {}) {
  const prompt =
    notesPrefix(opts.notes) +
    'From the following list of scraped result cards, extract each real result as ' +
    'an object with keys: name, subtitle, price, rating, image, url, and metrics ' +
    '(an object of any other notable numeric facts you find, e.g. views, ' +
    'subscribers, duration, reviews, publishedAgo — only include keys that ' +
    'actually apply to this kind of result). Use the card\'s href for url and ' +
    'img for image. Return ONLY a JSON array, no prose.\n\n' +
    JSON.stringify(cards, null, 2);

  const content = await chatJSON('You extract structured data and reply with JSON only.', prompt, apiKey, opts);
  const arr = extractJsonArray(content);
  if (!arr) throw new Error('DeepSeek returned no parseable JSON array');
  return arr;
}

// Self-service fix loop: a user reports a problem with a completed run's
// output ("no price shown", "missing amenities"). Re-extracts from that run's
// raw cards with the complaint (and, if given, the earlier bad result) as
// extra context. Once the user confirms the corrected output looks right, the
// complaint is saved as a note (see notesPrefix) so every future run on that
// automation gets it applied automatically -- fixing a new site gets faster
// each time instead of requiring a developer to notice and patch it.
function buildFixPrompt(cards, complaint, priorResults, notes) {
  const priorBlock =
    priorResults && priorResults.length
      ? `Previous extraction (what the user says is wrong): ${JSON.stringify(priorResults, null, 2)}\n\n`
      : '';
  return (
    notesPrefix(notes) +
    `A user reported an issue with data extracted from this site: "${complaint}"\n\n` +
    priorBlock +
    'Re-extract the following scraped cards as a JSON array of objects with keys: name, subtitle, ' +
    'price, rating, image, url, and metrics (any other relevant facts as key/value pairs). Fix the ' +
    'reported issue. Return ONLY a JSON array, no prose.\n\n' +
    JSON.stringify(cards, null, 2)
  );
}

async function callDeepSeekFix(cards, complaint, priorResults, notes, apiKey, opts = {}) {
  const content = await chatJSON(
    'You fix data-extraction issues reported by a user and reply with JSON only.',
    buildFixPrompt(cards, complaint, priorResults, notes),
    apiKey,
    opts
  );
  const arr = extractJsonArray(content);
  if (!arr) throw new Error('DeepSeek returned no parseable JSON array');
  return normalizeResults(arr);
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
      const kind = await classifySiteKind({ domain: opts.domain, cards }, key, opts);
      if (kind === 'informational') {
        items = await callDeepSeekInformational(cards, opts.values, key, opts);
        engine = 'deepseek-informational';
      } else {
        items = await callDeepSeek(cards, key, opts);
        engine = 'deepseek';
      }
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

module.exports = {
  structureResults,
  heuristicParse,
  extractJsonArray,
  loadEnv,
  classifyLine,
  parseLines,
  chatJSON,
  classifySiteKind,
  buildKindPrompt,
  parseKind,
  buildInformationalPrompt,
  callDeepSeekInformational,
  notesPrefix,
  buildFixPrompt,
  callDeepSeekFix,
};
