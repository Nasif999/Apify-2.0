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
const { callDeepSeekFix, loadEnv } = require('../runner/structure');
const { applyFieldEdits, detectFilters, runFieldCommand } = require('../runner/fieldEdits');
const { scanForMissedFields } = require('../runner/domscanRunner');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => res.redirect('/index.html'));

// A run must never hang the request forever — if the headless browser wedges
// (page never settles, a wait condition never resolves), the client needs an
// answer instead of an infinite spinner. 120s measured too tight for a normal
// AI-assisted run: Playwright/navigation is ~20s, but real scraped card text
// (full amenity lists, descriptions) makes the DeepSeek structuring call
// itself take much longer than small test payloads suggested — a real run
// completed at 113s, barely inside the old ceiling. 180s leaves headroom
// without approaching a true hang.
const RUN_TIMEOUT_MS = 180000;
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

// In-memory run progress, keyed by automation id (one run at a time per
// automation is already enforced above via runningAutomations, so the
// automation id alone is a safe key — no separate progress token needed).
// Deliberately not persisted: it's a live status readout for the run
// currently in flight, not part of the run's permanent record.
const runProgress = new Map();

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
  // AI on by default — it's what lets extraction generalize to sites we never
  // tuned for (structuring + the whole-page rescue in replay-runner). Callers
  // can still opt out with { ai: false } for a free heuristic-only run.
  const useAi = !(req.body && req.body.ai === false);
  const price = quoteRate(a.recording, { outputCount }).price;
  runProgress.set(a.id, { stage: 'starting', pct: 0, at: Date.now() });

  try {
    const result = await withTimeout(
      replay(a.recording, values, {
        scrape: true,
        ai: useAi,
        maxCards: outputCount,
        envDir: path.join(__dirname, '..'),
        includeRaw: true,
        notes: a.extractionNotes || [],
        onProgress: (stage, pct) => runProgress.set(a.id, { stage, pct, at: Date.now() }),
      }),
      RUN_TIMEOUT_MS,
      'Run'
    );
    runProgress.set(a.id, { stage: 'done', pct: 100, at: Date.now() });
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
      summary: result.summary || null,
      dismissedPopups: result.dismissedPopups || 0,
      warning: check.suspicious ? check.reason : null,
      rawCards: result.rawCards || null,
    });
    res.json({
      runId: run.id,
      price,
      currency: 'BDT',
      mode: result.mode,
      resultCount: run.resultCount,
      results: run.results,
      summary: run.summary,
      warning: run.warning,
      outputUrl: `/run.html?id=${a.id}&runId=${run.id}`,
    });
  } catch (e) {
    runProgress.set(a.id, { stage: 'failed', pct: 0, at: Date.now() });
    res.status(500).json({ error: 'Run failed', detail: e.message });
  } finally {
    runningAutomations.delete(a.id);
  }
});

// Real-time progress for the run currently in flight on this automation
// (polled by automation.html while a run's POST /run request is pending —
// that request itself blocks until the whole run finishes, so this is the
// only way the client sees what stage it's actually reached). Owner-auth,
// same as /run: this is operational detail about the automation, not public.
app.get('/api/automations/:id/progress', (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!requireApiKey(req, res, a)) return;
  res.json(runProgress.get(a.id) || { stage: 'idle', pct: 0 });
});

// Output URL for a past run.
app.get('/api/automations/:id/runs/:runId', (req, res) => {
  const run = store.getRun(req.params.id, req.params.runId);
  if (!run) return res.status(404).json({ error: 'Not found' });
  res.json(run);
});

// --- Self-service extraction fixes (see structure.js: buildFixPrompt, notesPrefix) ---

function requireApiKey(req, res, a) {
  const key = req.get('X-Api-Key') || bearer(req.get('Authorization'));
  if (!key || key !== a.apiKey) {
    res.status(401).json({ error: 'Missing or invalid API key' });
    return false;
  }
  return true;
}

// Preview a corrected extraction for one run without persisting anything —
// the user reviews it before the fix becomes permanent (report-confirm below).
app.post('/api/automations/:id/runs/:runId/report', async (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!requireApiKey(req, res, a)) return;

  const run = store.getRun(a.id, req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (!run.rawCards) {
    return res.status(400).json({ error: 'This run has no raw data captured. Re-run the automation, then report.' });
  }

  const complaint = (req.body && req.body.complaint) || '';
  if (!complaint.trim()) return res.status(400).json({ error: 'complaint is required' });

  loadEnv(path.join(__dirname, '..'));
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return res.status(400).json({ error: 'DEEPSEEK_API_KEY is not configured on this server.' });

  try {
    const results = await callDeepSeekFix(run.rawCards, complaint, run.results, a.extractionNotes || [], key, {
      envDir: path.join(__dirname, '..'),
    });
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: 'Fix failed', detail: e.message });
  }
});

// Confirms a reported fix actually looked right — saves the complaint as a
// standing note so every future run of this automation applies it too.
app.post('/api/automations/:id/report-confirm', (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!requireApiKey(req, res, a)) return;

  const complaint = (req.body && req.body.complaint) || '';
  if (!complaint.trim()) return res.status(400).json({ error: 'complaint is required' });

  const notes = store.addExtractionNote(a.id, complaint.trim());
  res.json({ ok: true, notes });
});

// --- Field editor (curate the derived form: hide junk, mark filters, rename) ---

// The fields the user currently sees (edits applied), for AI passes and responses.
function editedFields(a) {
  return applyFieldEdits(a.formspec, a.fieldEdits).fields;
}
// Hidden fields, by original name, so the UI can offer to restore them.
function hiddenFieldList(a) {
  const edits = a.fieldEdits || {};
  return (a.formspec.fields || [])
    .filter((f) => edits[f.key] && edits[f.key].hidden)
    .map((f) => ({ key: f.key, name: (edits[f.key] && edits[f.key].name) || f.name }));
}
function siteAndLabels(recording) {
  const site = (recording.sites && recording.sites[0]) || '';
  const stepLabels = (recording.steps || []).map((s) => s.label).filter((l) => l && l.trim());
  return { site, stepLabels };
}
function editedResponse(a) {
  return { formspec: applyFieldEdits(a.formspec, a.fieldEdits), hiddenFields: hiddenFieldList(a) };
}
function deepseekKeyOr(res) {
  loadEnv(path.join(__dirname, '..'));
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) res.status(400).json({ error: 'DEEPSEEK_API_KEY is not configured on this server.' });
  return key;
}

// Set/clear one field override (✕ remove, restore, manual make-filter, rename).
app.patch('/api/automations/:id/fields', (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!requireApiKey(req, res, a)) return;
  const { key, edit } = req.body || {};
  if (!key || typeof edit !== 'object' || edit === null) {
    return res.status(400).json({ error: 'Body must include a field key and an edit object.' });
  }
  // { edit: {} } is the explicit "reset this field" signal.
  const updated = Object.keys(edit).length ? store.setFieldEdit(a.id, key, edit) : store.clearFieldEdit(a.id, key);
  res.json(editedResponse(updated));
});

// AI: which fields are on/off filters -> mark each as a checkbox field.
app.post('/api/automations/:id/fields/detect-filters', async (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!requireApiKey(req, res, a)) return;
  const key = deepseekKeyOr(res);
  if (!key) return;
  const { site, stepLabels } = siteAndLabels(a.recording);
  try {
    const filterKeys = await detectFilters(editedFields(a), site, stepLabels, key, { envDir: path.join(__dirname, '..') });
    let updated = a;
    for (const k of filterKeys) updated = store.setFieldEdit(a.id, k, { filter: true });
    res.json({ ...editedResponse(updated), detected: filterKeys.length });
  } catch (e) {
    res.status(500).json({ error: 'Detect failed', detail: e.message });
  }
});

// AI: one plain-English instruction -> a single field change (or a refusal).
app.post('/api/automations/:id/fields/command', async (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!requireApiKey(req, res, a)) return;
  const instruction = (req.body && req.body.instruction) || '';
  if (!instruction.trim()) return res.status(400).json({ error: 'instruction is required' });
  const key = deepseekKeyOr(res);
  if (!key) return;
  try {
    const cmd = await runFieldCommand(editedFields(a), instruction, key, { envDir: path.join(__dirname, '..') });
    if (cmd.action === 'none') return res.json({ applied: false, message: cmd.message });
    const edit =
      cmd.action === 'remove' ? { hidden: true } : cmd.action === 'make_filter' ? { filter: true } : { name: cmd.newName };
    const updated = store.setFieldEdit(a.id, cmd.key, edit);
    res.json({ applied: true, message: cmd.message, ...editedResponse(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Command failed', detail: e.message });
  }
});

// On-demand headless re-scan for interactive elements the recording missed.
app.post('/api/automations/:id/fields/scan', async (req, res) => {
  const a = store.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!requireApiKey(req, res, a)) return;
  try {
    const { warnings } = await scanForMissedFields(a.recording);
    res.json({ warnings: warnings || [] });
  } catch (e) {
    res.status(500).json({ error: 'Scan failed', detail: e.message });
  }
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
    // Serve the edited view of the form (hidden/filter/renamed fields applied);
    // the canonical a.formspec stays untouched so every edit is reversible.
    formspec: applyFieldEdits(a.formspec, a.fieldEdits),
    hiddenFields: hiddenFieldList(a),
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
