// server.js — the Apify platform (Phase 3 MVP).
// Serves the dashboard + automation pages and the REST API. Automations are
// created by pasting a recording JSON; each gets an API key, a derived form, and
// a per-run quoted price. Runs execute via the Phase 2 replay engine.
const express = require('express');
const path = require('path');
const store = require('./store');
const { quoteRate } = require('./pricing');
const { replay } = require('../runner/replay-runner');
const { assessResults } = require('../runner/verify');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => res.redirect('/dashboard.html'));

// A run must never hang the request forever — if the headless browser wedges
// (page never settles, a wait condition never resolves), the client needs an
// answer instead of an infinite spinner.
const RUN_TIMEOUT_MS = 120000;
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Two overlapping runs of the same automation contend for the same headless
// browser resources and slow each other down (this is what actually caused
// runs to blow past the timeout in testing) — reject a second concurrent run
// outright instead of letting both degrade.
const runningAutomations = new Set();

// --- Automations (dashboard-facing; single-user MVP, unauthenticated) ---

app.post('/api/automations', async (req, res) => {
  const { name, recording, scanForMissedFields } = req.body || {};
  if (!recording || !Array.isArray(recording.steps)) {
    return res.status(400).json({ error: 'Body must include a recording with a steps array.' });
  }
  const a = await store.createAutomation({ name, recording, scanForMissedFields });
  res.status(201).json(publicAutomation(a, { revealKey: true }));
});

app.get('/api/automations', (req, res) => {
  res.json(store.listAutomations());
});

app.get('/api/automations/:id', (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  // MVP is single-user, so the owner's automation page may hold the real key to
  // drive the authenticated run endpoint. A later auth phase locks this down.
  res.json(publicAutomation(a, { revealKey: true }));
});

// Live price quote for a given output count, used by the automation page so
// the shown price updates as the user changes "Number of results" — before
// they've actually spent anything on a run.
app.get('/api/automations/:id/quote', (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const outputCount = Number(req.query.outputCount || 10);
  res.json(quoteRate(a.recording, { outputCount }));
});

app.delete('/api/automations/:id', (req, res) => {
  const removed = store.deleteAutomation(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// --- Run (programmatic entry point; requires the automation's API key) ---

app.post('/api/automations/:id/run', async (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });

  const key = req.get('X-Api-Key') || bearer(req.get('Authorization'));
  if (!key || key !== a.apiKey) {
    return res.status(401).json({ error: 'Missing or invalid API key' });
  }

  if (runningAutomations.has(a.id)) {
    return res.status(409).json({ error: 'A run is already in progress for this automation. Wait for it to finish.' });
  }
  runningAutomations.add(a.id);

  const values = (req.body && req.body.values) || {};
  const outputCount = Number((req.body && req.body.outputCount) || 10);
  const useAi = !!(req.body && req.body.ai);
  const price = quoteRate(a.recording, { outputCount }).price;

  try {
    const result = await withTimeout(
      replay(a.recording, values, {
        scrape: true,
        ai: useAi,
        maxCards: outputCount,
        envDir: path.join(__dirname, '..'),
      }),
      RUN_TIMEOUT_MS,
      'Run'
    );
    // Sanity-check before this reaches the customer: a "successful" run that
    // actually scraped the same element repeatedly must not look identical to
    // a genuine success — flag it rather than deliver it silently.
    const check = assessResults(result.results);

    const run = store.addRun(a.id, {
      values,
      outputCount,
      price,
      mode: result.mode,
      engine: result.engine || null,
      finalUrl: result.finalUrl,
      resultCount: (result.results || []).length,
      results: result.results || [],
      dismissedPopups: result.dismissedPopups || 0,
      warning: check.suspicious ? check.reason : null,
    });
    res.json({
      runId: run.id,
      price,
      currency: 'BDT',
      mode: result.mode,
      resultCount: run.resultCount,
      results: run.results,
      warning: run.warning,
      outputUrl: `/run.html?id=${a.id}&runId=${run.id}`,
    });
  } catch (e) {
    res.status(500).json({ error: 'Run failed', detail: e.message });
  } finally {
    runningAutomations.delete(a.id);
  }
});

// Output URL for a past run.
app.get('/api/automations/:id/runs/:runId', (req, res) => {
  const run = store.getRun(req.params.id, req.params.runId);
  if (!run) return res.status(404).json({ error: 'Not found' });
  res.json(run);
});

function bearer(auth) {
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Shape an automation for the client. The raw API key is revealed only right
// after creation; afterwards it is masked.
function publicAutomation(a, opts = {}) {
  return {
    id: a.id,
    name: a.name,
    createdAt: a.createdAt,
    price: a.price,
    formspec: a.formspec,
    formspecEngine: a.formspecEngine,
    scanWarnings: a.scanWarnings,
    apiKey: opts.revealKey ? a.apiKey : undefined,
    apiKeyMasked: store.maskKey(a.apiKey),
    runs: (a.runs || []).map((r) => ({
      id: r.id,
      at: r.at,
      resultCount: r.resultCount,
      price: r.price,
      mode: r.mode,
    })),
  };
}

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Apify platform on http://localhost:${PORT}`));
}

module.exports = app;
