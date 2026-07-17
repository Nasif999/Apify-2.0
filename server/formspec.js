// formspec.js — derive the editable form for an automation from its recording.
//
// URL-driven recordings: the form fields are the query params the recording added
// or changed (the state the user set), keyed by param name — the same keys the
// URL-replay path overrides.
// Step-driven recordings: the fields are the recorded input steps, keyed by step
// id — the same keys the step-replay path overrides.
const { isUrlDriven, paramMap } = require('../extension/lib/replay');

const STEP_FIELD_TYPES = ['text', 'dropdown', 'calendar', 'tickmark', 'stepper'];

function deriveFormSpec(recording) {
  const steps = (recording && recording.steps) || [];

  if (isUrlDriven(recording)) {
    const first = paramMap(steps[0].url);
    const last = paramMap(steps[steps.length - 1].url);
    const fields = [];
    for (const key of Object.keys(last)) {
      const isNew = !(key in first);
      const changed = isNew || String(last[key]) !== String(first[key]);
      if (changed) {
        fields.push({ key, name: key, type: 'url', value: last[key] });
      }
    }
    return { mode: 'url', fields };
  }

  const fields = steps
    .filter((s) => STEP_FIELD_TYPES.includes(s.fieldType))
    .map((s) => ({
      key: String(s.id),
      name: s.label && s.label.trim() ? s.label.trim() : s.fieldType,
      type: s.fieldType,
      value: s.value,
    }));
  return { mode: 'step', fields };
}

module.exports = { deriveFormSpec };
