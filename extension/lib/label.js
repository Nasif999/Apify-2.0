// label.js — derive a human-readable name for whatever the user interacted with.
// Extracted out of content.js so the DOM heuristics are pure and unit-testable
// (matches selector.js/classify.js — dual-usable, no chrome.* dependency).
(function (global) {
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
          const ref = el.ownerDocument.getElementById(id);
          return ref ? ref.textContent : '';
        })
        .join(' ')
    );
  }

  // Text from this element's own direct text-node children only, ignoring
  // any nested elements. A calendar-day cell often nests an unrelated badge
  // (e.g. booking.com's lowest-price badge inside the day cell) — reading
  // full textContent/innerText mixes that badge text into the day number.
  // Own-text isolates just what the element itself (not its children) says.
  function ownText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.textContent;
    }
    return clean(text);
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
      const escId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      const lbl = el.ownerDocument.querySelector(`label[for="${escId}"]`);
      if (lbl) return clean(lbl.textContent).slice(0, MAX_LABEL);
    }
    const wrap = el.closest && el.closest('label');
    if (wrap) return clean(wrap.textContent).slice(0, MAX_LABEL);

    const title = clean(el.getAttribute('title'));
    if (title) return title;

    // A <select>'s textContent/innerText is every <option>'s text joined
    // (e.g. "2 3 4 5 6 7 8 9 10 11" for a passenger-count dropdown) — never a
    // meaningful name. That generic fallback must be skipped entirely for
    // <select> elements; falling through to '' (the caller then shows the
    // honest fieldType word) beats a garbled fake-looking label.
    const isSelect = el.tagName === 'SELECT';
    // A bare "+"/"-" is real text but a useless label on its own (it says
    // "this is a plus button", not what it's counting) — treat it the same
    // as no text at all, so the counter-row climb below still fires. Same
    // symbol set classify.js's isStepper already recognizes.
    const isBareSymbol = (s) => /^[+\-−–]$/.test(s);

    if (!isSelect) {
      // Prefer the element's own text over its full (descendant-inclusive)
      // text — avoids swallowing a nested badge/annotation that isn't part
      // of the label.
      const own = ownText(el);
      if (own && !isBareSymbol(own)) return own.slice(0, MAX_LABEL);

      // Visible text of the element itself (innerText respects visibility
      // when available; textContent is the jsdom/test fallback).
      const text = clean(el.innerText || el.textContent);
      if (text && !isBareSymbol(text)) return text.slice(0, MAX_LABEL);

      // Icon-only stepper button (no useful text/aria-label anywhere on itself):
      // real adults/children/rooms counters are almost always a labeled row
      // wrapping the +/- widget, the label text a SIBLING of the counter —
      // not inside it. Climb from the button's immediate counter-group
      // parent to that row and read the row's own text, skipping over the
      // counter's own buttons/digits entirely. Only fires when the row
      // genuinely has its own text; otherwise falls through rather than
      // inventing a label.
      const row = el.parentElement && el.parentElement.parentElement;
      if (row) {
        const rowLabel = ownText(row);
        if (rowLabel) return rowLabel.slice(0, MAX_LABEL);
      }
    }

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

  const api = { getLabel, ownText, clean };
  if (global) global.ApifyLabel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
