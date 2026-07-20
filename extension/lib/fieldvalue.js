// fieldvalue.js — capture the value of whatever field a recorded interaction
// touched. Extracted out of content.js so this is pure and unit-testable
// (matches selector.js/classify.js/label.js — dual-usable, no chrome.*
// dependency).
(function (global, labelMod) {
  const { ownText, clean } = labelMod;

  // A suggestion/option label is short; a container's textContent is huge. Cap
  // the value captured from an unknown click so we grab "New Delhi, India" (an
  // autocomplete pick) without dumping an entire panel's text.
  const MAX_CLICK_VALUE = 80;

  function captureFieldValue(el, fieldType) {
    if (fieldType === 'tickmark') return !!el.checked;
    if (fieldType === 'dropdown' && el.tagName === 'SELECT') {
      const opt = el.selectedOptions && el.selectedOptions[0];
      return opt ? opt.textContent.trim() : el.value;
    }
    if (fieldType === 'text' || fieldType === 'calendar') {
      if (el.isContentEditable) return clean(el.textContent);
      if (el.value != null) return el.value;
      // A custom (non-native) date cell's visible text is often just the bare
      // day number ("15") — the month/year live only in an accessibility
      // attribute most date-picker widgets already carry for screen readers.
      // Prefer that full date over the ambiguous digit.
      if (fieldType === 'calendar') {
        const full =
          el.getAttribute('aria-label') ||
          el.getAttribute('data-date') ||
          el.getAttribute('datetime') ||
          el.getAttribute('data-day');
        if (full) return full;
      }
      // Own text only, cleaned — a calendar cell often nests an unrelated
      // badge (a "lowest price" marker) whose text must not bleed into the
      // date value, and raw textContent's whitespace/newlines must not
      // bleed into the value either.
      const own = ownText(el);
      if (own) return own;
      return clean(el.textContent);
    }
    if (fieldType === 'unknown') {
      const t = clean(el.textContent);
      return t.length && t.length <= MAX_CLICK_VALUE ? t : '';
    }
    return ''; // stepper and anything else: no meaningful value
  }

  const api = { captureFieldValue };
  if (global) global.ApifyFieldValue = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(
  typeof window !== 'undefined' ? window : globalThis,
  typeof window !== 'undefined' ? window.ApifyLabel : require('./label')
);
