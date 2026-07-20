// store.js — a tiny JSON-file store for automations and their runs.
// MVP-simple (no DB dependency); upgrade to SQLite/Postgres when the marketplace
// and real money land.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { deriveFormSpec } = require('./formspec');
const { quoteRate } = require('./pricing');
const { classifyTrackingParams } = require('../runner/paramClassify');
const { suggestFieldNames, applyNamingSuggestions } = require('../runner/fieldNaming');
const { suggestCompoundSplits, applyCompoundSplit } = require('../runner/compoundFields');
const { scanForMissedFields } = require('../runner/domscanRunner');
const { isUrlDriven, paramMap } = require('../extension/lib/replay');

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'automations.json');
const MAX_RUNS = 25; // keep recent run history bounded

function ensure() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]');
}
function load() {
  ensure();
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}
function save(list) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function maskKey(k) {
  return k ? `${k.slice(0, 6)}…${k.slice(-4)}` : '';
}

// AI classifies which url params are tracking noise vs real search state —
// generalizes better than the fixed regex denylist in formspec.js, which only
// knows names someone already thought to add. Only relevant for url-driven
// recordings; falls back to the regex denylist (deriveFormSpec's default) on
// any AI failure or absent API key, so creation is never blocked or worsened.
// A url-driven recording only reaches this AI branch because isUrlDriven
// already established at least one param genuinely changed during the
// recording — that's what "url-driven" means. If the AI's classification
// would exclude every single one of those params, that's incoherent with
// having gotten here at all: a confidently-wrong AI answer (e.g. it couldn't
// match any param to a garbled/ambiguous step label and defaulted to
// excluding everything), not a genuinely field-free search. A failed AI
// *call* already falls back to the heuristic (classifyTrackingParams
// returns null on error) — this catches the more dangerous case of an AI
// call that succeeds but returns a nonsensical answer, which nothing else
// guards against.
function isSuspiciousClassification(trackingKeys, paramKeys) {
  return paramKeys.length > 0 && paramKeys.every((k) => trackingKeys.has(k));
}

async function buildFormSpec(recording) {
  const steps = (recording && recording.steps) || [];
  const site = (recording.sites && recording.sites[0]) || '';
  const stepLabels = steps.map((s) => s.label).filter((l) => l && l.trim());

  let formspec;
  let engine;
  if (isUrlDriven(recording) && steps.length) {
    const lastUrl = steps[steps.length - 1].url;
    const params = paramMap(lastUrl);
    const trackingKeys = await classifyTrackingParams(params, site, stepLabels);
    if (trackingKeys && !isSuspiciousClassification(trackingKeys, Object.keys(params))) {
      formspec = deriveFormSpec(recording, { isTracking: (k) => trackingKeys.has(k) });
      engine = 'ai';
    }
  }
  if (!formspec) {
    formspec = deriveFormSpec(recording);
    engine = 'heuristic';
  }

  // Additive compound-split overlay: a url param packing several values into
  // one delimited string (e.g. gozayaan's trips=DAC,CXB,date,...) becomes
  // per-position labeled sub-inputs. Rejoin is client-side position-swap;
  // parseCompoundSplit already rejected any split whose label count wouldn't
  // round-trip, so a bad/absent split just leaves the raw field whole.
  const splits = await suggestCompoundSplits(formspec.fields, site, stepLabels);
  formspec = { ...formspec, fields: applyCompoundSplit(formspec.fields, splits) };

  // Additive naming overlay: unlike the tracking classifier above (which
  // EXCLUDES fields, and once wrongly excluded everything), a bad or missing
  // suggestion here just leaves that field's current name unchanged —
  // structurally unable to lose data, so no sanity guard is needed.
  const suggestions = await suggestFieldNames(formspec.fields, site, stepLabels);
  formspec = { ...formspec, fields: applyNamingSuggestions(formspec.fields, suggestions) };

  return { formspec, engine };
}

// Opt-in QA step (checkbox on the dashboard create form): a real headless
// load of the recorded page, flagging interactive elements the recording
// missed. Flag-only — never adds fields itself, never blocks creation. Any
// failure (bad url, navigation timeout, blocked by the site) degrades to "no
// warnings" rather than failing the whole automation-creation request.
async function scanWarningsFor(recording, wanted) {
  if (!wanted) return null;
  try {
    const { warnings } = await scanForMissedFields(recording);
    return warnings;
  } catch {
    return null;
  }
}

async function createAutomation({ name, recording, scanForMissedFields: wantScan }) {
  const list = load();
  const { formspec, engine } = await buildFormSpec(recording);
  const scanWarnings = await scanWarningsFor(recording, wantScan);
  const automation = {
    id: crypto.randomUUID(),
    apiKey: 'ak_' + crypto.randomBytes(24).toString('hex'),
    name: (name && name.trim()) || 'Untitled automation',
    createdAt: Date.now(),
    recording,
    formspec,
    formspecEngine: engine,
    scanWarnings,
    price: quoteRate(recording).price,
    runs: [],
  };
  list.push(automation);
  save(list);
  return automation;
}

function getAutomation(id) {
  return load().find((a) => a.id === id) || null;
}

function findByApiKey(key) {
  return load().find((a) => a.apiKey === key) || null;
}

function listAutomations() {
  return load().map((a) => ({
    id: a.id,
    name: a.name,
    createdAt: a.createdAt,
    price: a.price,
    fieldCount: a.formspec ? a.formspec.fields.length : 0,
    mode: a.formspec ? a.formspec.mode : null,
    apiKeyMasked: maskKey(a.apiKey),
    runCount: a.runs ? a.runs.length : 0,
  }));
}

function addRun(automationId, run) {
  const list = load();
  const a = list.find((x) => x.id === automationId);
  if (!a) return null;
  const stored = Object.assign({ id: crypto.randomUUID(), at: Date.now() }, run);
  a.runs = [stored, ...(a.runs || [])].slice(0, MAX_RUNS);
  save(list);
  return stored;
}

function getRun(automationId, runId) {
  const a = getAutomation(automationId);
  if (!a) return null;
  return (a.runs || []).find((r) => r.id === runId) || null;
}

function deleteAutomation(id) {
  const list = load();
  const next = list.filter((a) => a.id !== id);
  const removed = next.length !== list.length;
  if (removed) save(next);
  return removed;
}

module.exports = {
  createAutomation,
  getAutomation,
  findByApiKey,
  listAutomations,
  addRun,
  getRun,
  deleteAutomation,
  maskKey,
  isSuspiciousClassification,
};
