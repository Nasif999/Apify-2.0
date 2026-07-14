// recorder.js — the recording state model.
// Holds the raw action log and serializes it into a clean, inspectable recording:
// coalesced steps, distinct sites (multi-site support), and extracted variable fields.
//
// A recording is a plain object so it survives structured-clone across the
// content-script / popup message boundary. Functions operate on it explicitly.
//
// Dual-usable: attaches to window (content script) and exports for node tests.
(function (global) {
  const FIELD_TYPES = ['text', 'dropdown', 'calendar', 'tickmark', 'stepper'];

  function newRecording(now) {
    return { startedAt: now, actions: [], _nextId: 1 };
  }

  function domainOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  function addAction(rec, action, now) {
    const stored = Object.assign({}, action, {
      id: rec._nextId++,
      timestamp: now,
      domain: domainOf(action.url),
    });
    rec.actions.push(stored);
    return stored;
  }

  // Collapse runs of text-input events on the same selector into their final value.
  function coalesce(actions) {
    const out = [];
    for (const a of actions) {
      const prev = out[out.length - 1];
      if (
        a.type === 'input' &&
        prev &&
        prev.type === 'input' &&
        prev.selector === a.selector
      ) {
        prev.value = a.value; // keep first id/timestamp, update to final value
        continue;
      }
      out.push(Object.assign({}, a));
    }
    return out;
  }

  function distinctSites(steps) {
    const seen = [];
    for (const s of steps) {
      if (s.domain && !seen.includes(s.domain)) seen.push(s.domain);
    }
    return seen;
  }

  function markNested(steps) {
    const revealedParents = new Set(
      steps.filter((s) => s.revealedBy != null).map((s) => s.revealedBy)
    );
    for (const s of steps) {
      if (revealedParents.has(s.id)) s.hasNested = true;
      if (s.revealedBy != null) {
        s.nested = true;
        s.parentId = s.revealedBy;
      }
    }
  }

  function extractVariables(steps) {
    const vars = [];
    const counts = {};
    for (const s of steps) {
      if (!FIELD_TYPES.includes(s.fieldType)) continue;
      counts[s.fieldType] = (counts[s.fieldType] || 0) + 1;
      const name = s.label && s.label.trim()
        ? s.label.trim()
        : `${s.fieldType}_${counts[s.fieldType]}`;
      vars.push({
        name,
        fieldType: s.fieldType,
        selector: s.selector,
        value: s.value != null ? s.value : null,
        site: s.domain,
        nested: !!s.nested,
      });
    }
    return vars;
  }

  function serialize(rec) {
    const steps = coalesce(rec.actions);
    markNested(steps);
    return {
      startedAt: rec.startedAt,
      sites: distinctSites(steps),
      steps,
      variables: extractVariables(steps),
    };
  }

  const api = { newRecording, addAction, serialize };
  if (global) global.ApifyRecorder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
