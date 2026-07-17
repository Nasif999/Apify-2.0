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

  const api = { buildReplayUrl, isUrlDriven, paramMap };
  if (global) global.ApifyReplay = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
