// store.js — a tiny JSON-file store for automations and their runs.
// MVP-simple (no DB dependency); upgrade to SQLite/Postgres when the marketplace
// and real money land.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { deriveFormSpec } = require('./formspec');
const { quoteRate } = require('./pricing');

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

function createAutomation({ name, recording }) {
  const list = load();
  const automation = {
    id: crypto.randomUUID(),
    apiKey: 'ak_' + crypto.randomBytes(24).toString('hex'),
    name: (name && name.trim()) || 'Untitled automation',
    createdAt: Date.now(),
    recording,
    formspec: deriveFormSpec(recording),
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

module.exports = {
  createAutomation,
  getAutomation,
  findByApiKey,
  listAutomations,
  addRun,
  getRun,
  maskKey,
};
