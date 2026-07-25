const test = require('node:test');
const assert = require('node:assert');
const {
  buildReplayUrl,
  isUrlDriven,
  auxiliarySteps,
  stripResolvedIdParams,
  resolveStepForReplay,
  needsSearchSubmitFallback,
} = require('../extension/lib/replay');
const bookingFilters = require('../runner/fixtures/booking-filters.json');

const BOOKING_FINAL =
  'https://www.booking.com/searchresults.en-gb.html?aid=304142&ss=Cox%27s+Bazar%2C+Bangladesh&checkin=2026-07-19&checkout=2026-08-18&group_adults=5&age=14&age=12&age=17';

test('buildReplayUrl swaps given params and keeps the rest', () => {
  const out = buildReplayUrl(BOOKING_FINAL, { ss: 'Dhaka, Bangladesh', checkin: '2026-09-01' });
  const p = new URL(out).searchParams;
  assert.strictEqual(p.get('ss'), 'Dhaka, Bangladesh');
  assert.strictEqual(p.get('checkin'), '2026-09-01');
  assert.strictEqual(p.get('checkout'), '2026-08-18'); // untouched
  assert.strictEqual(p.get('aid'), '304142'); // untouched tracking param
});

test('buildReplayUrl adds a param that was not originally present', () => {
  const out = buildReplayUrl('https://a.com/s?x=1', { y: '2' });
  const p = new URL(out).searchParams;
  assert.strictEqual(p.get('x'), '1');
  assert.strictEqual(p.get('y'), '2');
});

test('buildReplayUrl expands an array value into repeated params', () => {
  const out = buildReplayUrl(BOOKING_FINAL, { age: ['5', '7'] });
  const ages = new URL(out).searchParams.getAll('age');
  assert.deepStrictEqual(ages, ['5', '7']);
});

test('buildReplayUrl leaves the url unchanged when no new params', () => {
  const out = buildReplayUrl('https://a.com/s?x=1&y=2', {});
  const p = new URL(out).searchParams;
  assert.strictEqual(p.get('x'), '1');
  assert.strictEqual(p.get('y'), '2');
});

test('buildReplayUrl drops a param whose value is null (unticked filter)', () => {
  // A filter checkbox unticked in the form sends null for that key; the param
  // must vanish from the replay URL entirely (not become key=null), so the
  // site applies no such filter. Ticked = its real value is sent normally.
  const out = buildReplayUrl(BOOKING_FINAL, { group_adults: null });
  const p = new URL(out).searchParams;
  assert.strictEqual(p.has('group_adults'), false);
  assert.strictEqual(p.get('ss'), "Cox's Bazar, Bangladesh"); // others untouched
});

test('buildReplayUrl drops a param whose value is undefined', () => {
  const out = buildReplayUrl('https://a.com/s?x=1&y=2', { y: undefined });
  const p = new URL(out).searchParams;
  assert.strictEqual(p.has('y'), false);
  assert.strictEqual(p.get('x'), '1');
});

test('isUrlDriven: true when a search adds state params to the URL', () => {
  const rec = {
    steps: [
      { url: 'https://www.booking.com/index.html?aid=304142&label=x' },
      { url: 'https://www.booking.com/searchresults.html?aid=304142&label=x&ss=Dhaka&checkin=2026-09-01' },
    ],
  };
  assert.strictEqual(isUrlDriven(rec), true);
});

test('isUrlDriven: true for a single new query param (YouTube search)', () => {
  const rec = {
    steps: [
      { url: 'https://www.youtube.com/' },
      { url: 'https://www.youtube.com/results?search_query=lofi' },
    ],
  };
  assert.strictEqual(isUrlDriven(rec), true);
});

test('isUrlDriven: false when the URL never gains or changes params', () => {
  const rec = {
    steps: [
      { url: 'https://app.example.com/dashboard' },
      { url: 'https://app.example.com/dashboard' },
    ],
  };
  assert.strictEqual(isUrlDriven(rec), false);
});

test('isUrlDriven: false for an empty recording', () => {
  assert.strictEqual(isUrlDriven({ steps: [] }), false);
});

test('auxiliarySteps: only returns step-type fields recorded on the same page as the final url', () => {
  // regression: this is the shared single source of truth for "which steps
  // are post-search auxiliary fields" -- formspec.js (the form the user
  // edits) and replay-runner.js (what actually gets replayed) must agree, or
  // the runner ends up trying to click pre-search index-page widgets
  // (occupancy stepper, age dropdown) that don't exist on the results page
  // reached via direct URL navigation -- each one hangs on a 30s locator
  // timeout, and enough of them stack up to blow the whole run's time budget.
  const steps = auxiliarySteps(bookingFilters);
  const ids = steps.map((s) => s.id);
  assert.deepStrictEqual(ids, [16, 17, 18]);
});

test('auxiliarySteps: excludes non-STEP_FIELD_TYPES steps even on the final page', () => {
  const rec = {
    steps: [
      { id: 1, url: 'https://a.com/s?x=1&y=2', fieldType: 'tickmark' },
      { id: 2, url: 'https://a.com/s?x=1&y=2', fieldType: 'unknown' },
    ],
  };
  const ids = auxiliarySteps(rec).map((s) => s.id);
  assert.deepStrictEqual(ids, [1]);
});

test('auxiliarySteps: empty recording returns no steps', () => {
  assert.deepStrictEqual(auxiliarySteps({ steps: [] }), []);
});

test('resolveStepForReplay: substitutes Enter-submit when the linked text field was recorded EMPTY and replay gives it a new value', () => {
  // regression: this is the bug actually observed live on IMDb. The user
  // clicked the search box (recorded value "") and picked a TRENDING
  // suggestion -- IMDb shows trending/default items only on an empty box;
  // typing anything replaces them with genuinely different result items
  // (confirmed live: 8 trending items -> 0 after typing, different testids
  // appear). The recorded click therefore has no valid equivalent once the
  // box holds real text -- it can never match anything again, for any query.
  // Falling back to Enter-to-submit is the one action every text search box
  // supports, verified live to land on IMDb's real /find?q=... results page.
  const steps = [
    { id: 1, fieldType: 'text', selector: '#suggestion-search', value: '' },
    { id: 2, fieldType: 'unknown', selector: '[data-testid="search-result--trending"]', forTextId: 1, value: 'the hawk' },
  ];
  const resolved = resolveStepForReplay(steps, steps[1], { 1: 'The Batman' });
  assert.strictEqual(resolved.type, 'submit');
  assert.strictEqual(resolved.selector, '#suggestion-search');
});

test('resolveStepForReplay: trusts the original click when the linked text field was recorded with real typed text', () => {
  // the normal, correct case (e.g. gozayaan's destination autocomplete: type
  // "Cox's" then pick "Cox's Bazar, Bangladesh") -- a genuinely query-driven
  // pick, not a default/trending one. Must not be touched.
  const steps = [
    { id: 1, fieldType: 'text', selector: '#dest', value: 'Cox' },
    { id: 2, fieldType: 'unknown', selector: '.suggestion', forTextId: 1, value: "Cox's Bazar, Bangladesh" },
  ];
  const resolved = resolveStepForReplay(steps, steps[1], { 1: 'Dhaka' });
  assert.strictEqual(resolved, steps[1]);
});

test('resolveStepForReplay: does not intervene when the replay value is unchanged (still empty)', () => {
  const steps = [
    { id: 1, fieldType: 'text', selector: '#q', value: '' },
    { id: 2, fieldType: 'unknown', selector: '.trend', forTextId: 1, value: 'x' },
  ];
  const resolved = resolveStepForReplay(steps, steps[1], {});
  assert.strictEqual(resolved, steps[1]);
});

test('resolveStepForReplay: passes through unchanged when the step has no forTextId', () => {
  const steps = [{ id: 1, fieldType: 'unknown', selector: '.btn', value: 'Search' }];
  assert.strictEqual(resolveStepForReplay(steps, steps[0], {}), steps[0]);
});

test('resolveStepForReplay: passes through unchanged when forTextId points to a step that no longer exists', () => {
  const steps = [{ id: 2, fieldType: 'unknown', selector: '.trend', forTextId: 99, value: 'x' }];
  assert.strictEqual(resolveStepForReplay(steps, steps[0], { 1: 'The Batman' }), steps[0]);
});

test('stripResolvedIdParams: removes dest_id/dest_type companion params', () => {
  // regression: this is the bug actually observed live. booking.com resolves
  // the destination via the opaque dest_id/dest_type params -- ss is purely
  // cosmetic display text. So overriding ss alone (e.g. "Bangkok, Thailand" ->
  // a different city) does nothing: dest_id still points at the originally
  // recorded city and the site silently keeps searching that one. Verified
  // live: navigating with ss=Bangkok but the old dest_id/dest_type still
  // showed "Hotels in Kuala Lumpur"; dropping dest_id/dest_type entirely and
  // keeping only ss correctly resolved to "Hotels in Bangkok".
  const url = 'https://www.booking.com/searchresults.html?ss=Bangkok%2C+Thailand&dest_id=-2403010&dest_type=city&checkin=2026-07-20';
  const out = stripResolvedIdParams(url);
  const p = new URL(out).searchParams;
  assert.strictEqual(p.get('dest_id'), null);
  assert.strictEqual(p.get('dest_type'), null);
  assert.strictEqual(p.get('ss'), 'Bangkok, Thailand');
  assert.strictEqual(p.get('checkin'), '2026-07-20');
});

test('stripResolvedIdParams: leaves params that merely contain "id"/"type" without the underscore-prefixed suffix', () => {
  // "aid" (an affiliate id) and "paid" must not be caught by an overly broad
  // match -- only a genuine `..._id`/`..._type` suffix is a resolved-entity
  // companion param.
  const url = 'https://a.com/s?aid=304142&paid=true&x=1';
  const out = stripResolvedIdParams(url);
  const p = new URL(out).searchParams;
  assert.strictEqual(p.get('aid'), '304142');
  assert.strictEqual(p.get('paid'), 'true');
  assert.strictEqual(p.get('x'), '1');
});

test('stripResolvedIdParams: is a no-op when there are no _id/_type params', () => {
  const url = 'https://a.com/s?ss=Dhaka&checkin=2026-07-20';
  assert.strictEqual(stripResolvedIdParams(url), url);
});

test('needsSearchSubmitFallback: true for a recording that is a single bare text-fill step', () => {
  // regression: AmarStock's recording. The typeahead dropdown selection that
  // actually navigates was never captured -- just the fill into #search-input
  // -- so replay stalls on the starting page and scrapes only page chrome.
  const steps = [{ id: 1, fieldType: 'text', selector: '#search-input', value: 'ACI' }];
  assert.strictEqual(needsSearchSubmitFallback(steps), true);
});

test('needsSearchSubmitFallback: false when a follow-up step was recorded (normal case)', () => {
  const steps = [
    { id: 1, fieldType: 'text', selector: '#dest', value: 'Cox' },
    { id: 2, fieldType: 'unknown', selector: '.suggestion', forTextId: 1, value: "Cox's Bazar, Bangladesh" },
  ];
  assert.strictEqual(needsSearchSubmitFallback(steps), false);
});

test('needsSearchSubmitFallback: false for a lone step that is not a text field', () => {
  const steps = [{ id: 1, fieldType: 'tickmark', selector: '#agree', value: true }];
  assert.strictEqual(needsSearchSubmitFallback(steps), false);
});

test('needsSearchSubmitFallback: false for an empty recording', () => {
  assert.strictEqual(needsSearchSubmitFallback([]), false);
});
