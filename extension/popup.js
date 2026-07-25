// popup.js — start/stop recording and export the captured recording as JSON.
// Reads/writes the same chrome.storage.local keys the content script uses.
const KEY_ACTIVE = 'apify_active';
const KEY_REC = 'apify_recording';
// Single place to point the extension at whichever Apify instance is live —
// swap this when moving off localhost (tunnel URL, then real domain).
const APIFY_BASE_URL = 'https://srv1311307.hstgr.cloud';

const $ = (id) => document.getElementById(id);

function get(keys) {
  return new Promise((res) => chrome.storage.local.get(keys, res));
}
function set(obj) {
  return new Promise((res) => chrome.storage.local.set(obj, res));
}

function render(rec, active) {
  $('dot').classList.toggle('on', active);
  $('status').textContent = active ? 'recording…' : 'idle';
  $('start').disabled = active;
  $('stop').disabled = !active;

  const out = rec && rec.actions && rec.actions.length
    ? ApifyRecorder.serialize(rec)
    : { steps: [], variables: [], sites: [], urlParams: {} };

  $('stepCount').textContent = out.steps.length;
  $('varCount').textContent = out.variables.length;
  $('siteCount').textContent = out.sites.length;
  $('paramCount').textContent = Object.keys(out.urlParams || {}).length;

  const vars = $('vars');
  vars.innerHTML = '';
  for (const v of out.variables) {
    const row = document.createElement('div');
    row.className = 'var';
    const val = typeof v.value === 'boolean' ? (v.value ? '✓' : '✗') : (v.value || '');
    row.innerHTML =
      `<span class="tag${v.nested ? ' nested' : ''}">${v.fieldType}</span>` +
      `<span class="vname"></span><span class="vval"></span>`;
    row.querySelector('.vname').textContent = v.name;
    row.querySelector('.vval').textContent = val;
    vars.appendChild(row);
  }
}

async function refresh() {
  const data = await get([KEY_ACTIVE, KEY_REC]);
  render(data[KEY_REC], !!data[KEY_ACTIVE]);
}

async function currentRecording() {
  const data = await get([KEY_REC]);
  return data[KEY_REC];
}

$('start').addEventListener('click', async () => {
  await set({ [KEY_REC]: ApifyRecorder.newRecording(Date.now()), [KEY_ACTIVE]: true });
  refresh();
});

$('stop').addEventListener('click', async () => {
  await set({ [KEY_ACTIVE]: false });
  const rec = await currentRecording();
  if (rec && rec.actions && rec.actions.length) {
    await set({ apify_pending_recording: ApifyRecorder.serialize(rec) });
    chrome.tabs.create({ url: `${APIFY_BASE_URL}/dashboard.html` });
  }
  refresh();
});

$('copy').addEventListener('click', async () => {
  const rec = await currentRecording();
  if (!rec) return;
  const json = JSON.stringify(ApifyRecorder.serialize(rec), null, 2);
  await navigator.clipboard.writeText(json);
  $('status').textContent = 'copied ✓';
  setTimeout(refresh, 1200);
});

$('export').addEventListener('click', async () => {
  const rec = await currentRecording();
  if (!rec) return;
  const json = JSON.stringify(ApifyRecorder.serialize(rec), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apify-recording-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Live-update the popup while it's open and recording.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[KEY_REC] || changes[KEY_ACTIVE])) refresh();
});

refresh();
