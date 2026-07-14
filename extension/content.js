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

  function persist() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      chrome.storage.local.set({ [KEY_REC]: rec });
    }, 250);
  }

  function getLabel(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    if (el.labels && el.labels.length) return el.labels[0].textContent.trim();
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return lbl.textContent.trim();
    }
    const wrap = el.closest && el.closest('label');
    if (wrap) return wrap.textContent.trim();
    const ph = el.getAttribute('placeholder');
    if (ph) return ph.trim();
    const name = el.getAttribute('name');
    if (name) return name.trim();
    const title = el.getAttribute('title');
    if (title) return title.trim();
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

  // Only real field types carry a captured value; clicks on buttons/links do not
  // (prevents dumping entire panel textContent as a "value").
  const VALUE_FIELD_TYPES = ['text', 'dropdown', 'tickmark', 'calendar'];

  function valueOf(el, fieldType) {
    if (!VALUE_FIELD_TYPES.includes(fieldType)) return '';
    if (fieldType === 'tickmark') return !!el.checked;
    if (fieldType === 'dropdown' && el.tagName === 'SELECT') {
      const opt = el.selectedOptions && el.selectedOptions[0];
      return opt ? opt.textContent.trim() : el.value;
    }
    if (el.isContentEditable) return el.textContent;
    return el.value != null ? el.value : el.textContent;
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

    const stored = ApifyRecorder.addAction(rec, action, now);
    seenSelectors.add(selector);
    if (fieldType === 'stepper') {
      pendingStepperId = stored.id;
      pendingStepperAt = now;
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

  const INTERACTIVE_ROLES = ['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'option'];

  // A genuinely clickable control worth recording as an action — as opposed to a
  // plain container (a div/section with a data-testid) that a click merely bubbled
  // through. Steppers are handled separately and always recorded.
  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea') {
      return true;
    }
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (INTERACTIVE_ROLES.includes(role)) return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function onClick(e) {
    if (!active) return;
    const el = resolveControl(e.target);
    if (!el) return;
    const fieldType = ApifyClassify.classifyField(el);
    // Fields that fire input/change are captured by those handlers. Record clicks
    // only for steppers and for genuinely interactive controls (buttons/links);
    // skip clicks that merely bubbled through a non-interactive container.
    if (fieldType === 'stepper') {
      record(el, 'click', 'stepper');
    } else if (fieldType === 'unknown' && isInteractive(el)) {
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
    const fieldType = ApifyClassify.classifyField(el);
    if (fieldType === 'dropdown' || fieldType === 'tickmark' || fieldType === 'calendar') {
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
