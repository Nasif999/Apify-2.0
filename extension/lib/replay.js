// replay.js — pure helpers for the replay engine.
//   buildReplayUrl — substitute new values into a recorded URL's query params.
//   isUrlDriven    — decide whether a recording can be replayed by navigating a
//                    parameterized URL (vs. needing step-by-step replay).
//
// Pure and dual-usable (browser + node tests). No Playwright here.
(function (global) {
  // Rebuild `finalUrl` with `newParams` overriding matching query params and
  // adding any that are new. Untouched params (tracking ids, etc.) are preserved.
  // Array values expand into repeated params (e.g. age=5&age=7).
  function buildReplayUrl(finalUrl, newParams) {
    const u = new URL(finalUrl);
    for (const [key, value] of Object.entries(newParams || {})) {
      u.searchParams.delete(key);
      if (Array.isArray(value)) {
        for (const item of value) u.searchParams.append(key, item);
      } else {
        u.searchParams.set(key, value);
      }
    }
    return u.toString();
  }

  function paramMap(url) {
    const m = {};
    try {
      for (const [k, v] of new URL(url).searchParams) {
        m[k] = k in m ? [].concat(m[k], v) : v;
      }
    } catch {
      return {};
    }
    return m;
  }

  // A recording is URL-driven when its final page URL gained or changed query
  // params relative to its first URL — i.e. the actions pushed state into the URL,
  // so re-navigating a parameterized URL reproduces the run. Otherwise replay
  // must execute the steps.
  function isUrlDriven(recording) {
    const steps = (recording && recording.steps) || [];
    if (steps.length < 2) return false;
    const first = paramMap(steps[0].url);
    const last = paramMap(steps[steps.length - 1].url);
    for (const key of Object.keys(last)) {
      if (!(key in first)) return true;
      if (String(last[key]) !== String(first[key])) return true;
    }
    return false;
  }

  // Field types whose value comes from a DOM control the recorder saw —
  // shared between formspec (deriving the form) and the runner (replaying
  // auxiliary steps on a URL-driven page, e.g. post-search filter checkboxes
  // that the URL never encodes).
  const STEP_FIELD_TYPES = ['text', 'dropdown', 'calendar', 'tickmark', 'stepper'];

  // A step's recorded url can lag its own effect: sites like booking.com bake
  // each filter click into the url (e.g. `nflt=...`) via an async re-render,
  // so the click is captured a tick before its own filter lands in the url.
  // Comparing full url strings against the truly-last step therefore drops
  // every filter but the last. Comparing by pathname instead identifies "same
  // page" regardless of that query-string drift, while still excluding steps
  // from an earlier page (e.g. the pre-search index page).
  function pathOf(url) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  // The single source of truth for "which recorded steps are post-search
  // auxiliary fields" (filter checkboxes, sort dropdowns the URL never
  // encodes) — used by BOTH formspec.js (the form the user edits) and
  // replay-runner.js (what actually gets replayed). These two MUST agree:
  // a step this function excludes must never be clicked at replay time, or
  // the runner tries to interact with elements from an earlier page (e.g. a
  // pre-search occupancy stepper) that don't exist on the page a URL-replay
  // navigates straight to — each one then hangs on its full locator timeout,
  // and enough of them stack up to blow the whole run's time budget.
  function auxiliarySteps(recording) {
    const steps = (recording && recording.steps) || [];
    if (!steps.length) return [];
    const lastPath = pathOf(steps[steps.length - 1].url);
    return steps.filter((s) => STEP_FIELD_TYPES.includes(s.fieldType) && pathOf(s.url) === lastPath);
  }

  // Many sites resolve a searched entity (destination, item, place) through
  // an opaque internal id/type param pair (e.g. booking.com's dest_id/
  // dest_type) alongside a human-readable text param (ss) that's purely
  // cosmetic. Overriding just the text param does nothing — the site still
  // searches whatever the stale id points at. Verified live: booking.com
  // kept showing "Hotels in Kuala Lumpur" with ss=Bangkok but the old
  // dest_id/dest_type still present; dropping dest_id/dest_type entirely and
  // keeping only ss correctly resolved to "Hotels in Bangkok" — the site
  // free-text-resolves the destination when no stale id is there to pin it.
  // `_id`/`_type` is a common convention for these resolved-entity companions
  // across booking/travel/marketplace sites generally, not one specific
  // site's param names — a genuine underscore-prefixed suffix, so `aid` or
  // `paid` (no underscore before "id") are untouched.
  const RESOLVED_ID_PARAM = /_(id|type)$/i;
  function stripResolvedIdParams(url) {
    const u = new URL(url);
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      if (RESOLVED_ID_PARAM.test(key)) {
        u.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? u.toString() : url;
  }

  // Some sites show a query-INDEPENDENT suggestion menu (trending/recent
  // searches) on an empty box, replaced entirely by genuinely different,
  // query-matched result items once you type anything — verified live on
  // IMDb: 8 "trending" items before typing, 0 after, replaced by different
  // testids. A suggestion picked while the box was empty is therefore tied to
  // whatever happened to be trending that moment, not to any query — it has
  // no valid equivalent once a new value is typed, and its selector can never
  // match again for any search term. Falling back to Enter-to-submit uses the
  // one action nearly every text search box supports, sidestepping the need
  // to guess which (if any) new suggestion corresponds to the old one.
  function resolveStepForReplay(steps, step, newValues) {
    if (step.forTextId == null) return step;
    const textStep = steps.find((s) => s.id === step.forTextId);
    if (!textStep) return step;
    const recordedEmpty = !textStep.value || !String(textStep.value).trim();
    const idKey = String(textStep.id);
    const effectiveValue = idKey in newValues ? newValues[idKey] : textStep.value;
    const effectiveNonEmpty = effectiveValue && String(effectiveValue).trim();
    if (recordedEmpty && effectiveNonEmpty) {
      return { type: 'submit', fieldType: 'submit', selector: textStep.selector, value: '' };
    }
    return step;
  }

  const api = {
    buildReplayUrl,
    isUrlDriven,
    paramMap,
    STEP_FIELD_TYPES,
    pathOf,
    auxiliarySteps,
    stripResolvedIdParams,
    resolveStepForReplay,
  };
  if (global) global.ApifyReplay = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
