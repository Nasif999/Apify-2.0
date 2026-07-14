// content.js — capture DOM interactions and append them to the recording.
//
// The recording lives in chrome.storage.local so it survives page navigations
// (a single automation can span multiple sites). Each page load rehydrates the
// current recording, appends to it, and writes it back (debounced).
//
// Relies on globals from lib/*.js (loaded before this file by the manifest):
//   ApifySelector.generateSelector, ApifyClassify.classifyField,
//   ApifyRecorder.newRecording/addAction/serialize
(function () {
  const KEY_ACTIVE = 'apify_active';
  const KEY_REC = 'apify_recording';

  let active = false;
  let rec = null;
  let writeTimer = null;

  // Per-page ephemeral state for nested-field detection.
  const seenSelectors = new Set();
  let pendingStepperId = null;
  let pendingStepperAt = 0;
  const NESTED_WINDOW_MS = 15000;

  // Autocomplete pairing: remember the last text typed so a suggestion click that
  // follows it can be linked back (type "Dhaka" -> pick "Dhaka, Bangladesh").
  let lastTextId = null;
  let lastTextAt = 0;
  let lastTextSelector = '';
  const AUTOCOMPLETE_WINDOW_MS = 15000;

  function persist() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      chrome.storage.local.set({ [KEY_REC]: rec });
    }, 250);
  }

  const MAX_LABEL = 100;

  function clean(s) {
    return s ? s.replace(/\s+/g, ' ').trim() : '';
  }

  // Resolve the text referenced by aria-labelledby (space-separated id list).
  function labelledByText(el) {
    const ids = el.getAttribute('aria-labelledby');
    if (!ids) return '';
    return clean(
      ids
        .split(/\s+/)
        .map((id) => {
          const ref = document.getElementById(id);
          return ref ? ref.textContent : '';
        })
        .join(' ')
    );
  }

  // A human-readable name for whatever was clicked, tried in order of reliability.
  // Ends with the element's own visible text so every click gets a name even when
  // there is no aria-label/label (e.g. an autocomplete suggestion like
  // "Dhaka, Bangladesh" or a "Search" button).
  function getLabel(el) {
    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;

    const byId = labelledByText(el);
    if (byId) return byId.slice(0, MAX_LABEL);

    if (el.labels && el.labels.length) return clean(el.labels[0].textContent).slice(0, MAX_LABEL);
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return clean(lbl.textContent).slice(0, MAX_LABEL);
    }
    const wrap = el.closest && el.closest('label');
    if (wrap) return clean(wrap.textContent).slice(0, MAX_LABEL);

    const title = clean(el.getAttribute('title'));
    if (title) return title;

    // Visible text of the element itself (innerText respects visibility when
    // available; textContent is the jsdom/test fallback).
    const text = clean(el.innerText || el.textContent);
    if (text) return text.slice(0, MAX_LABEL);

    // Icon-only control: fall back to an inner image's alt text.
    const img = el.querySelector && el.querySelector('img[alt]');
    if (img) {
      const alt = clean(img.getAttribute('alt'));
      if (alt) return alt;
    }

    const ph = clean(el.getAttribute('placeholder'));
    if (ph) return ph;
    const name = clean(el.getAttribute('name'));
    if (name) return name;
    return '';
  }

  // Input types that are not free-text entry.
  const NON_TEXT_INPUT = [
    'button', 'submit', 'reset', 'image', 'file', 'hidden',
    'checkbox', 'radio', 'date', 'datetime-local', 'month', 'week', 'time', 'color', 'range',
  ];

  // True for elements the user types free text into — including autocomplete
  // comboboxes (an <input type="text"> that also carries role="combobox").
  function isTextEntry(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (el.isContentEditable) return true;
    if (tag === 'input') {
      return !NON_TEXT_INPUT.includes((el.getAttribute('type') || '').toLowerCase());
    }
    return false;
  }

  // Field types whose value comes from a form control.
  const VALUE_FIELD_TYPES = ['text', 'dropdown', 'tickmark', 'calendar'];
  // A suggestion/option label is short; a container's textContent is huge. Cap the
  // value captured from an unknown click so we grab "New Delhi, India" (an
  // autocomplete pick) without dumping an entire panel's text.
  const MAX_CLICK_VALUE = 80;

  function valueOf(el, fieldType) {
    if (fieldType === 'tickmark') return !!el.checked;
    if (fieldType === 'dropdown' && el.tagName === 'SELECT') {
      const opt = el.selectedOptions && el.selectedOptions[0];
      return opt ? opt.textContent.trim() : el.value;
    }
    if (fieldType === 'text' || fieldType === 'calendar') {
      if (el.isContentEditable) return el.textContent;
      return el.value != null ? el.value : el.textContent;
    }
    if (fieldType === 'unknown') {
      const t = (el.textContent || '').trim();
      return t.length && t.length <= MAX_CLICK_VALUE ? t : '';
    }
    return ''; // stepper and anything else: no meaningful value
  }

  function record(el, type, fieldType) {
    const selector = ApifySelector.generateSelector(el);
    if (!selector) return;
    const action = {
      type,
      fieldType,
      selector,
      value: valueOf(el, fieldType),
      label: getLabel(el),
      url: location.href,
    };

    // Nested detection: a real FIELD (not a button/action) touched shortly after
    // a stepper click, whose selector wasn't seen before that click, is a revealed
    // sub-field. Restricting to field types avoids linking unrelated buttons
    // (e.g. the Search submit) that merely happen to be clicked within the window.
    const now = Date.now();
    const isNewField = !seenSelectors.has(selector);
    if (
      pendingStepperId != null &&
      isNewField &&
      now - pendingStepperAt < NESTED_WINDOW_MS &&
      VALUE_FIELD_TYPES.includes(fieldType)
    ) {
      action.revealedBy = pendingStepperId;
      pendingStepperId = null;
    }

    // Autocomplete pairing: a suggestion click (an unknown click carrying short
    // text) shortly after typing into a different field is the pick for that text.
    // Both steps are kept; the click links back via forTextId so replay can type
    // the text and then select the matching suggestion.
    if (
      fieldType === 'unknown' &&
      action.value &&
      lastTextId != null &&
      now - lastTextAt < AUTOCOMPLETE_WINDOW_MS &&
      selector !== lastTextSelector
    ) {
      action.autocomplete = true;
      action.forTextId = lastTextId;
      lastTextId = null;
    }

    const stored = ApifyRecorder.addAction(rec, action, now);
    seenSelectors.add(selector);
    if (fieldType === 'stepper') {
      pendingStepperId = stored.id;
      pendingStepperAt = now;
    }
    if (fieldType === 'text') {
      lastTextId = stored.id;
      lastTextAt = now;
      lastTextSelector = selector;
    }
    persist();
  }

  function resolveControl(target) {
    if (!target || target.nodeType !== 1) return null;
    return (
      target.closest(
        'input, select, textarea, button, a, [role], [contenteditable="true"]'
      ) || target
    );
  }

  const INTERACTIVE_TAGS = ['button', 'a', 'input', 'select', 'textarea', 'summary', 'label', 'option'];
  // Broad set of ARIA roles a user can act on — includes grid/menu/tree cells that
  // custom widgets (e.g. calendar date cells) use.
  const INTERACTIVE_ROLES = [
    'button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'checkbox', 'radio', 'switch', 'gridcell', 'treeitem', 'row', 'cell',
  ];

  // Universal clickability test — works on any site without a per-site tag list.
  // The decisive signal is the browser's own computed cursor: a custom <div> that
  // the site made clickable (a date field, a date cell) renders cursor:pointer.
  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.includes(tag)) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (INTERACTIVE_ROLES.includes(role)) return true;
    if (el.isContentEditable) return true;
    if (el.hasAttribute('onclick')) return true;
    const ti = el.getAttribute('tabindex');
    if (ti != null && ti !== '-1') return true;
    try {
      if (window.getComputedStyle(el).cursor === 'pointer') return true;
    } catch (_) {}
    return false;
  }

  const DATE_INPUT_TYPES = ['date', 'datetime-local', 'month', 'week'];

  function isNativeDateInput(el) {
    return el.tagName === 'INPUT' && DATE_INPUT_TYPES.includes((el.getAttribute('type') || '').toLowerCase());
  }

  // Suppress a click that is redundant with a form change from the same gesture
  // (e.g. clicking a checkbox's label fires both a change on the input and a click
  // on the wrapping label). A standalone click that opens a widget — a date field,
  // a date cell — has no accompanying change and is always kept.
  let lastChangeEl = null;
  let lastChangeAt = 0;
  const CHANGE_ECHO_MS = 600;

  function isRedundantWithChange(el) {
    if (!lastChangeEl) return false;
    if (Date.now() - lastChangeAt > CHANGE_ECHO_MS) return false;
    return el === lastChangeEl || el.contains(lastChangeEl) || lastChangeEl.contains(el);
  }

  function onClick(e) {
    if (!active) return;
    const el = resolveControl(e.target);
    if (!el) return;
    const fieldType = ApifyClassify.classifyField(el);

    // dropdown/tickmark/text are captured by the input/change handlers; skip their
    // clicks to avoid duplicates.
    if (fieldType === 'dropdown' || fieldType === 'tickmark' || fieldType === 'text') return;
    if (isRedundantWithChange(el)) return;

    if (fieldType === 'stepper') {
      record(el, 'click', 'stepper');
    } else if (fieldType === 'calendar' && !isNativeDateInput(el)) {
      // Custom date-picker field/cell (a div/button that opens or is in a calendar).
      record(el, 'click', 'calendar');
    } else if (isInteractive(el)) {
      // Any other clickable control on any site (custom date cells, cards, etc.).
      record(el, 'click', 'unknown');
    }
  }

  function onInput(e) {
    if (!active) return;
    const el = e.target;
    // Record any free-text entry as text, even if the element also classifies as
    // a dropdown (autocomplete comboboxes) — we want the typed value.
    if (isTextEntry(el)) record(el, 'input', 'text');
  }

  function onChange(e) {
    if (!active) return;
    const el = e.target;
    // A free-text/combobox input (e.g. YouTube search, role="combobox") is owned
    // by the input handler as text; don't also record its change as a dropdown.
    if (isTextEntry(el)) return;
    const fieldType = ApifyClassify.classifyField(el);
    if (fieldType === 'dropdown' || fieldType === 'tickmark' || fieldType === 'calendar') {
      // Remember this change so the click echo (label/wrapper) can be suppressed.
      lastChangeEl = el;
      lastChangeAt = Date.now();
      record(el, 'change', fieldType);
    }
  }

  function attach() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
  }

  function detach() {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onChange, true);
  }

  // Rehydrate state on every page load so recording continues across navigations.
  chrome.storage.local.get([KEY_ACTIVE, KEY_REC], (data) => {
    active = !!data[KEY_ACTIVE];
    rec = data[KEY_REC] || ApifyRecorder.newRecording(Date.now());
    if (active) attach();
  });

  // React to start/stop toggled from the popup while this page is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[KEY_ACTIVE]) {
      const nowActive = !!changes[KEY_ACTIVE].newValue;
      if (nowActive && !active) {
        active = true;
        attach();
      } else if (!nowActive && active) {
        active = false;
        detach();
      }
    }
    // Popup reset the recording (fresh start): adopt it.
    if (changes[KEY_REC] && changes[KEY_REC].newValue) {
      const incoming = changes[KEY_REC].newValue;
      if (incoming.actions && incoming.actions.length === 0) {
        rec = incoming;
        seenSelectors.clear();
        pendingStepperId = null;
      }
    }
  });
})();
