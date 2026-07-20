// context.js — capture a rich snapshot of an element at record time.
//
// WHY THIS EXISTS: everything downstream (field naming, classification, and
// later self-healing replay) can only reason about what the recorder saved.
// Reducing an interaction to selector+label+value at capture time throws away
// the very information needed to understand an unlabeled control — and it is
// unrecoverable afterwards, because the page is long gone. Repeatedly, sites
// broke not because the interpretation was wrong but because the identifying
// detail was never captured (an icon-only +/- button whose meaning lives in
// the "Adults" text beside it; a select whose meaning lives in its options).
//
// So: capture generously and cheaply here, filter later. Bounded in size so a
// recording cannot balloon on a page with huge containers.
//
// Dual-usable like the other lib/*.js modules (browser + node tests).
(function (global) {
  const MAX_NEARBY_TEXT = 300;
  const MAX_ANCESTORS = 5;
  const MAX_OPTIONS = 30;
  const MAX_ATTR_VALUE = 200;

  function clean(s) {
    return s ? String(s).replace(/\s+/g, ' ').trim() : '';
  }

  // Every attribute the element carries. Sites encode meaning in wildly
  // different places (aria-*, data-testid, name, title, custom framework
  // attributes) — enumerate rather than guess which ones matter.
  function attrsOf(el) {
    const out = {};
    const list = el.attributes || [];
    for (const a of list) {
      out[a.name] = clean(a.value).slice(0, MAX_ATTR_VALUE);
    }
    return out;
  }

  // Text visible around the element but not inside it — the label for an
  // icon-only control almost always lives here (a sibling, or the row that
  // wraps the whole widget) rather than on the control itself.
  function nearbyTextOf(el) {
    const parts = [];
    let node = el;
    for (let depth = 0; depth < 3 && node && node.parentElement; depth++) {
      node = node.parentElement;
      const text = clean(node.textContent);
      if (text) {
        parts.push(text);
        if (text.length >= MAX_NEARBY_TEXT) break;
      }
    }
    // The nearest enclosing text that actually adds something wins; joining
    // keeps the immediate neighbourhood first.
    return clean(parts.join(' | ')).slice(0, MAX_NEARBY_TEXT);
  }

  // Ancestor breadcrumbs (tag + classes) — structural hints like "this input
  // is inside form.search-form" that survive when the element itself is bare.
  function ancestorsOf(el) {
    const out = [];
    let node = el.parentElement;
    while (node && out.length < MAX_ANCESTORS) {
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      const cls = clean(node.getAttribute && node.getAttribute('class'));
      out.push(cls ? `${tag}.${cls.split(' ').join('.')}` : tag);
      node = node.parentElement;
    }
    return out;
  }

  function captureContext(el) {
    if (!el || el.nodeType !== 1) return null;
    const ctx = {
      tag: el.tagName ? el.tagName.toLowerCase() : '',
      attrs: attrsOf(el),
      nearbyText: nearbyTextOf(el),
      ancestors: ancestorsOf(el),
    };
    if (ctx.tag === 'select' && el.options) {
      ctx.options = Array.from(el.options)
        .slice(0, MAX_OPTIONS)
        .map((o) => clean(o.textContent));
    }
    return ctx;
  }

  const api = { captureContext };
  if (global) global.ApifyContext = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
