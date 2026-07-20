// handoff.js — relays a just-finished recording into the dashboard tab.
// Runs only on the dashboard origin (see manifest.json matches). Regular page
// JS can't read chrome.storage.local directly, so this bridges it via
// postMessage, then clears the pending key so a reload doesn't re-fire it.
(() => {
  const KEY_PENDING = 'apify_pending_recording';
  chrome.storage.local.get([KEY_PENDING], (data) => {
    const recording = data[KEY_PENDING];
    if (!recording) return;
    window.postMessage({ source: 'apify-extension', type: 'pending-recording', recording }, '*');
    chrome.storage.local.remove(KEY_PENDING);
  });
})();
