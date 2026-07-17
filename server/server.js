// server.js — the Apify platform (Phase 3 MVP).
// Serves the dashboard + automation pages and the REST API. Automations are
// created by pasting a recording JSON; each gets an API key, a derived form, and
// a per-run quoted price. Runs execute via the Phase 2 replay engine.
const express = require('express');
const path = require('path');
const store = require('./store');
const { quoteRate } = require('./pricing');
const { replay } = require('../runner/replay-runner');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => res.redirect('/dashboard.html'));

// --- Automations (dashboard-facing; single-user MVP, unauthenticated) ---

app.post('/api/automations', (req, res) => {
  const { name, recording } = req.body || {};
  if (!recording || !Array.isArray(recording.steps)) {
    return res.status(400).json({ error: 'Body must include a recording with a steps array.' });
  }
  const a = store.createAutomation({ name, recording });
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

// --- Run (programmatic entry point; requires the automation's API key) ---

app.post('/api/automations/:id/run', async (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });

  const key = req.get('X-Api-Key') || bearer(req.get('Authorization'));
  if (!key || key !== a.apiKey) {
    return res.status(401).json({ error: 'Missing or invalid API key' });
  }

  const values = (req.body && req.body.values) || {};
  const outputCount = Number((req.body && req.body.outputCount) || 10);
  const useAi = !!(req.body && req.body.ai);
  const price = quoteRate(a.recording, { outputCount }).price;

  try {
    const result = await replay(a.recording, values, {
      scrape: true,
      ai: useAi,
      maxCards: outputCount,
      envDir: path.join(__dirname, '..'),
    });
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
    });
    res.json({
      runId: run.id,
      price,
      currency: 'BDT',
      mode: result.mode,
      resultCount: run.resultCount,
      results: run.results,
      outputUrl: `/api/automations/${a.id}/runs/${run.id}`,
    });
  } catch (e) {
    res.status(500).json({ error: 'Run failed', detail: e.message });
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
