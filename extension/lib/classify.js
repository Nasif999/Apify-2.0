// classify.js — classify a DOM element into an Apify field type.
// Returns one of: 'text' | 'dropdown' | 'calendar' | 'tickmark' | 'stepper' | 'unknown'.
//
// Precedence matters: a checkbox is an <input>, so tickmark/calendar/dropdown
// checks run before the generic text check.
//
// Note: 'nested' (a field within a field) is NOT an intrinsic property of one
// element — it is a relationship captured by the recorder (a sub-field revealed
// after interacting with a parent, typically a stepper). classifyField only
// reports the intrinsic control type; the recorder links parents to children.
//
// Dual-usable: attaches to window (content script) and exports for node tests.
(function (global) {
  const DATE_TYPES = ['date', 'datetime-local', 'month', 'week'];
  const DATE_HINT = /(datepicker|calendar|check-?in|check-?out|departure|return|\bdate\b)/i;
  const STEPPER_HINT = /(increase|decrease|increment|decrement|plus|minus|\badd\b|\bremove\b|\bmore\b|\bfewer\b)/i;

  function typeOf(el) {
    return (el.getAttribute('type') || '').toLowerCase();
  }

  function isTickmark(el) {
    const tag = el.tagName.toLowerCase();
    const type = typeOf(el);
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'checkbox' || role === 'radio' || role === 'switch') return true;
    if (el.hasAttribute('aria-checked')) return true;
    return false;
  }

  function isCalendar(el) {
    const tag = el.tagName.toLowerCase();
    // A native <select> is a dropdown regardless of any date words in its label.
    if (tag === 'select') return false;
    if (tag === 'input' && DATE_TYPES.includes(typeOf(el))) return true;
    const hintSources = [
      el.className && typeof el.className === 'string' ? el.className : '',
      el.id || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('placeholder') || '',
    ].join(' ');
    return DATE_HINT.test(hintSources);
  }

  function isDropdown(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'combobox' || role === 'listbox') return true;
    if ((el.getAttribute('aria-haspopup') || '').toLowerCase() === 'listbox') return true;
    return false;
  }

  function isStepper(el) {
    const label = (el.getAttribute('aria-label') || '').trim();
    if (label && STEPPER_HINT.test(label)) return true;
    const text = (el.textContent || '').trim();
    if (text === '+' || text === '-' || text === '−' || text === '–') return true;

    // Structural: an icon-only button in a counter group (two buttons flanking a
    // number). Catches booking-style +/- steppers that carry no text or label.
    const btn = el.closest && el.closest('button, [role="button"]');
    if (btn && btn.parentElement) {
      const buttons = btn.parentElement.querySelectorAll('button, [role="button"]');
      if (buttons.length >= 2 && /\d/.test(btn.parentElement.textContent || '')) {
        return true;
      }
    }
    return false;
  }

  function isText(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
    if (tag === 'input') {
      const type = typeOf(el);
      // buttons/submits/hidden are not text fields
      const nonText = ['button', 'submit', 'reset', 'image', 'file', 'hidden'];
      return !nonText.includes(type);
    }
    return false;
  }

  function classifyField(el) {
    if (!el || el.nodeType !== 1) return 'unknown';
    if (isTickmark(el)) return 'tickmark';
    if (isCalendar(el)) return 'calendar';
    if (isDropdown(el)) return 'dropdown';
    if (isStepper(el)) return 'stepper';
    if (isText(el)) return 'text';
    return 'unknown';
  }

  const api = { classifyField };
  if (global) global.ApifyClassify = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
