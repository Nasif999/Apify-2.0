// formspec.js — derive the editable form for an automation from its recording.
//
// URL-driven recordings: the form fields are the query params the recording added
// or changed (the state the user set), keyed by param name — the same keys the
// URL-replay path overrides.
// Step-driven recordings: the fields are the recorded input steps, keyed by step
// id — the same keys the step-replay path overrides.
const { isUrlDriven, paramMap, STEP_FIELD_TYPES, auxiliarySteps } = require('../extension/lib/replay');

// Cross-site tracking/session param names (ad-network click ids, affiliate
// ids, marketing labels, session tokens) — never state the user wants to
// edit per-run, so they never become form fields regardless of the recording.
// Matching by "did it change during the recording" is NOT reliable: it only
// works when the recording happens to start on a blank pre-search page. A
// recording that starts after the search already ran (no earlier step shows
// the "before" state) makes every real field -- destination, dates, guest
// counts -- look just as "unchanged" as actual tracking noise, and they'd be
// wrongly dropped. A denylist of known-noise names survives regardless of
// when the recording started.
const TRACKING_PARAM = /^(utm_[a-z_]+|gclid|fbclid|msclkid|dclid|_ga|gad_source|mc_eid|ref|referrer|aid|sid|session(_?id)?|label|token|nonce|csrf)$/i;

function stepFields(steps) {
  return steps
    .filter((s) => STEP_FIELD_TYPES.includes(s.fieldType))
    .map((s) => ({
      key: String(s.id),
      name: s.label && s.label.trim() ? s.label.trim() : s.fieldType,
      type: s.fieldType,
      value: s.value,
      source: 'step',
      // Carried through for the AI naming pass (and later self-healing
      // replay): for an icon-only control this is the only thing that
      // identifies it. See extension/lib/context.js.
      context: s.context,
    }));
}

// isTracking is injectable so a caller (server/store.js) can plug in an
// AI-derived classification instead of the regex denylist, without this
// function itself touching the network — keeps it sync, pure, and testable.
function deriveFormSpec(recording, { isTracking = (key) => TRACKING_PARAM.test(key) } = {}) {
  const steps = (recording && recording.steps) || [];

  if (isUrlDriven(recording)) {
    const lastUrl = steps[steps.length - 1].url;
    const last = paramMap(lastUrl);
    const fields = [];
    for (const key of Object.keys(last)) {
      if (!isTracking(key)) {
        fields.push({ key, name: key, type: 'url', value: last[key], source: 'url' });
      }
    }
    // The main search is URL-driven, but a common pattern layers post-search
    // refinement (filter checkboxes, sort dropdowns) on top that the URL
    // never encodes — those steps would otherwise vanish from the form
    // entirely just because the recording happens to be URL-driven overall.
    // auxiliarySteps is the single source of truth shared with the replay
    // engine (replay-runner.js) — it MUST decide the same set here and at
    // replay time, or the runner ends up trying to click steps that were
    // never meant to be replayed against this page.
    fields.push(...stepFields(auxiliarySteps(recording)));
    return { mode: 'url', fields };
  }

  return { mode: 'step', fields: stepFields(steps) };
}

module.exports = { deriveFormSpec };
