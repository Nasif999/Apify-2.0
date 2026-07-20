// content.js — capture DOM interactions and append them to the recording.
//
// The recording lives in chrome.storage.local so it survives page navigations
// (a single automation can span multiple sites). Each page load rehydrates the
// current recording, appends to it, and writes it back (debounced).
//
// Relies on globals from lib/*.js (loaded before this file by the manifest):
//   ApifySelector.generateSelector, ApifyClassify.classifyField,
//   ApifyLabel.getLabel, ApifyFieldValue.captureFieldValue,
//   ApifyContext.captureContext, ApifyRecorder.newRecording/addAction/serialize
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

  const getLabel = ApifyLabel.getLabel;

  // Input types that are not free-text entry. Date types are sourced from the
  // classifier so the list has a single definition (no drift).
  const NON_TEXT_INPUT = [
    'button', 'submit', 'reset', 'image', 'file', 'hidden',
    'checkbox', 'radio', 'time', 'color', 'range',
  ].concat(ApifyClassify.DATE_TYPES);

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
  const captureFieldValue = ApifyFieldValue.captureFieldValue;

  function record(el, type, fieldType) {
    const selector = ApifySelector.generateSelector(el);
    if (!selector) return;
    const action = {
      type,
      fieldType,
      selector,
      value: captureFieldValue(el, fieldType),
      label: getLabel(el),
      // Rich snapshot of the element and its surroundings. The page is gone by
      // the time anything interprets this recording, so identifying detail not
      // captured here is unrecoverable — see lib/context.js.
      context: ApifyContext.captureContext(el),
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

  // For an event that originated inside an (open) shadow root, `e.target` is
  // retargeted to the shadow HOST element by the DOM spec — not the actual
  // element the user interacted with. Any site built with web components
  // (common: date pickers, custom selects, design-system components) would
  // otherwise get recorded against the wrong, useless element. composedPath()
  // gives the true originating node regardless of shadow boundaries.
  function realTarget(e) {
    if (typeof e.composedPath === 'function') {
      const path = e.composedPath();
      if (path.length) return path[0];
    }
    return e.target;
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

  function isNativeDateInput(el) {
    return el.tagName === 'INPUT' && ApifyClassify.DATE_TYPES.includes((el.getAttribute('type') || '').toLowerCase());
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

  // Record a click on a resolved element. Returns true if something was recorded.
  function recordClick(el) {
    const fieldType = ApifyClassify.classifyField(el);
    // dropdown/tickmark commit through the change handler; a click on them
    // carries no value of its own.
    if (fieldType === 'dropdown' || fieldType === 'tickmark') return false;
    if (isRedundantWithChange(el)) return false;

    // A click into a text box is itself a real interaction with a real field.
    // Waiting for an input event misses the very common pattern of focusing a
    // search box and picking a suggestion from the dropdown WITHOUT typing
    // (IMDb, and any site that shows recent/top results on focus) — the box
    // would never be recorded, leaving the automation with nothing to edit.
    // Recording it here also seeds lastTextId, so the suggestion click that
    // follows gets its normal autocomplete linkage. If the user does go on to
    // type, recorder.js's coalesce merges this into that same single field.
    if (fieldType === 'text') {
      record(el, 'click', 'text');
      return true;
    }

    if (fieldType === 'stepper') {
      record(el, 'click', 'stepper');
    } else if (fieldType === 'calendar' && !isNativeDateInput(el)) {
      // Custom date-picker field/cell (a div/button that opens or is in a calendar).
      record(el, 'click', 'calendar');
    } else if (isInteractive(el)) {
      // Any other clickable control on any site (custom date cells, cards, etc.).
      record(el, 'click', 'unknown');
    } else {
      return false;
    }
    return true;
  }

  // Some custom widgets (date pickers, menus) commit on pointerdown and cancel the
  // click, so a click listener never fires. We defer the pointerdown briefly: if a
  // real click follows (normal button) onClick cancels it and records once; if no
  // click arrives (a click-suppressing widget) the deferred record fires.
  let pendingPointerTimer = null;
  const POINTER_DEFER_MS = 350;

  function cancelPendingPointer() {
    if (pendingPointerTimer) {
      clearTimeout(pendingPointerTimer);
      pendingPointerTimer = null;
    }
  }

  function onPointerDown(e) {
    if (!active) return;
    const el = resolveControl(realTarget(e));
    if (!el) return;
    const fieldType = ApifyClassify.classifyField(el);
    // Only defer for click-like controls that a click handler would record anyway.
    if (fieldType !== 'stepper' && fieldType !== 'calendar' && !isInteractive(el)) return;
    cancelPendingPointer();
    pendingPointerTimer = setTimeout(() => {
      pendingPointerTimer = null;
      recordClick(el);
    }, POINTER_DEFER_MS);
  }

  function onClick(e) {
    if (!active) return;
    // A real click fired — cancel any deferred pointerdown so we record only once.
    cancelPendingPointer();
    const el = resolveControl(realTarget(e));
    if (!el) return;
    recordClick(el);
  }

  // Enter-to-submit is common (search boxes) and fires no click/change — capture
  // it explicitly so replay knows to press Enter instead of silently stopping.
  function onKeyDown(e) {
    if (!active) return;
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = realTarget(e);
    if (!el || el.tagName !== 'INPUT' || !isTextEntry(el)) return;
    record(el, 'submit', 'submit');
  }

  function onInput(e) {
    if (!active) return;
    const el = realTarget(e);
    // Record any free-text entry as text, even if the element also classifies as
    // a dropdown (autocomplete comboboxes) — we want the typed value.
    if (isTextEntry(el)) record(el, 'input', 'text');
  }

  function onChange(e) {
    if (!active) return;
    const el = realTarget(e);
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
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function detach() {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('keydown', onKeyDown, true);
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
