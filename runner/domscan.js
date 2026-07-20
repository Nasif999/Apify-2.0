// domscan.js — find interactive elements on a recorded page that the
// recording missed, so a heuristic-only capture (a click that fired too
// early, a filter the user didn't happen to touch) doesn't silently leave
// gaps in the automation's form.
//
// Pure core (findInteractiveCandidates, diffCandidates): walks the DOM with
// the same classify.js/label.js heuristics the recorder itself uses, so
// "interactive" here means exactly what the extension would have captured
// had the user clicked it. jsdom-testable, no chrome.*/Playwright dependency.
// Dual-usable like extension/lib/*.js (attaches to window + module.exports)
// so Playwright can load this exact file into a real page via addScriptTag
// and run the SAME tested logic there, instead of re-deriving it in a
// separate page.evaluate string. Network/browser-launch glue lives in
// server/domscan-runner.js, following scrape.js/structure.js's split of
// "pure and tested" vs "Playwright glue, verified live".
(function (global, classifyMod, labelMod) {
  const { classifyField } = classifyMod;
  const { getLabel } = labelMod;

  const INTERACTIVE_TAGS = ['input', 'select', 'textarea', 'button'];
  const INTERACTIVE_ROLES = ['checkbox', 'radio', 'switch', 'combobox', 'listbox'];

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.includes(tag)) return true;
    const role = el.getAttribute('role');
    return role ? INTERACTIVE_ROLES.includes(role) : false;
  }

  // Walks the whole document, classifying every element that looks like
  // something a user could interact with. Elements classify.js can't place
  // (fieldType 'unknown', e.g. a plain <button>Search</button> with no
  // checkbox/select/date semantics) are excluded — a scan flagging every
  // button on the page would be noise, not signal.
  function findInteractiveCandidates(doc) {
    const candidates = [];
    const all = doc.querySelectorAll('*');
    for (const el of all) {
      if (!isInteractive(el)) continue;
      const fieldType = classifyField(el);
      if (fieldType === 'unknown') continue;
      candidates.push({ label: getLabel(el), fieldType, el });
    }
    return candidates;
  }

  // Excludes any candidate the recording already captured. Matched via
  // el.matches(selector) rather than string equality: a recorded selector is
  // often attribute-based (input[name="fc=2"]) and will never equal what
  // generateSelector would produce fresh for the same element, so string
  // comparison would wrongly flag every already-recorded field as "missed".
  function diffCandidates(candidates, recordedSelectors) {
    return candidates.filter((c) => {
      return !recordedSelectors.some((sel) => {
        try {
          return c.el.matches(sel);
        } catch {
          return false;
        }
      });
    });
  }

  const api = { findInteractiveCandidates, diffCandidates };
  if (global) global.ApifyDomscan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(
  typeof window !== 'undefined' ? window : globalThis,
  typeof window !== 'undefined' ? window.ApifyClassify : require('../extension/lib/classify'),
  typeof window !== 'undefined' ? window.ApifyLabel : require('../extension/lib/label')
);
