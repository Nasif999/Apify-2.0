const test = require('node:test');
const assert = require('node:assert');
const { deriveFormSpec } = require('../server/formspec');

const booking = require('../runner/fixtures/booking-coxsbazar.json');
const selenium = require('../runner/fixtures/selenium-webform.json');
const gozayaan = require('../runner/fixtures/gozayaan-flight-search.json');
const bookingFilters = require('../runner/fixtures/booking-filters.json');
const bookingMidflow = require('../runner/fixtures/booking-midflow.json');

test('URL-driven recording -> url-mode form of the params the search added', () => {
  const spec = deriveFormSpec(booking);
  assert.strictEqual(spec.mode, 'url');
  const keys = spec.fields.map((f) => f.key);
  // state params the user set are present
  for (const k of ['ss', 'checkin', 'checkout', 'group_children', 'age', 'nflt']) {
    assert.ok(keys.includes(k), `expected form field for ${k}`);
  }
  // tracking params present in the first URL are excluded
  assert.ok(!keys.includes('aid'), 'aid (tracking) should not be a form field');
  assert.ok(!keys.includes('sid'), 'sid (tracking) should not be a form field');
});

test('URL-driven field carries the recorded value', () => {
  const spec = deriveFormSpec(booking);
  const checkin = spec.fields.find((f) => f.key === 'checkin');
  assert.strictEqual(checkin.value, '2026-07-19');
});

test('URL-driven recording ALSO surfaces post-search DOM filters (hybrid)', () => {
  // GoZayaan-style: the main search (from/to/dates/passengers) is URL-driven,
  // but filter checkboxes applied after the results load are client-side only
  // and never touch the URL. They must not vanish from the form just because
  // the recording is classified URL-driven overall.
  const spec = deriveFormSpec(gozayaan);
  assert.strictEqual(spec.mode, 'url');
  const byKey = Object.fromEntries(spec.fields.map((f) => [f.key, f]));
  assert.ok(byKey.trips, 'expected the url-sourced trips field');
  assert.strictEqual(byKey.trips.source, 'url');
  assert.ok(byKey['31'], 'expected the Thai Airways filter checkbox as a field');
  assert.strictEqual(byKey['31'].type, 'tickmark');
  assert.strictEqual(byKey['31'].source, 'step');
  assert.ok(byKey['32'], 'expected the "2 Stops or more" filter checkbox as a field');
  // Pre-search widget interactions (a passenger-count stepper/dropdown used
  // while building the URL-encoded search) must NOT also appear — their
  // effect is already the `adult`/`child`/etc. url fields above, and
  // surfacing them again would just be duplicate, meaningless blank fields.
  assert.ok(!byKey['19'], 'pre-search stepper should not be a separate field');
  assert.ok(!byKey['25'], 'pre-search dropdown should not be a separate field');
});

test('URL-driven recording where the SITE bakes filters into the url asynchronously still surfaces them (booking.com)', () => {
  // booking.com writes each filter checkbox into `nflt=...` in the URL, but
  // the click event is captured before that re-render lands. So step 16's
  // recorded url has no nflt yet, step 17's has only the first filter, etc.
  // None of them byte-match the truly-final url (step 20's) — an exact
  // string comparison against lastUrl silently drops every filter checkbox.
  const spec = deriveFormSpec(bookingFilters);
  assert.strictEqual(spec.mode, 'url');
  const byKey = Object.fromEntries(spec.fields.map((f) => [f.key, f]));
  assert.ok(byKey.checkin, 'expected the url-sourced checkin field');
  assert.ok(byKey['16'], 'expected the Swimming pool filter checkbox as a field');
  assert.strictEqual(byKey['16'].type, 'tickmark');
  assert.strictEqual(byKey['16'].source, 'step');
  assert.ok(byKey['17'], 'expected the Free cancellation filter checkbox as a field');
  assert.ok(byKey['18'], 'expected the Breakfast included filter checkbox as a field');
  // pre-search occupancy steppers/dropdowns on the index page must not leak in
  assert.ok(!byKey['2'], 'pre-search stepper should not be a separate field');
  assert.ok(!byKey['8'], 'pre-search dropdown should not be a separate field');
});

test('URL-driven recording that starts AFTER the search already ran still surfaces the search fields', () => {
  // regression: this recording's very first step is already on the results
  // page (the user started recording after running the search). ss/checkin/
  // checkout/group_adults/etc are therefore identical between step 0 and the
  // final step -- "changed since step 0" wrongly treats them the same as
  // tracking noise (aid/sid) and drops them, when they are exactly the
  // fields the user needs to edit per-run.
  const spec = deriveFormSpec(bookingMidflow);
  assert.strictEqual(spec.mode, 'url');
  const keys = spec.fields.map((f) => f.key);
  for (const k of ['ss', 'checkin', 'checkout', 'group_adults', 'group_children', 'no_rooms', 'dest_id', 'age']) {
    assert.ok(keys.includes(k), `expected form field for ${k}`);
  }
  // well-known cross-site tracking/session params are still excluded
  assert.ok(!keys.includes('aid'), 'aid (tracking) should not be a form field');
  assert.ok(!keys.includes('sid'), 'sid (tracking) should not be a form field');
  assert.ok(!keys.includes('label'), 'label (marketing click id) should not be a form field');
  // the post-search filter checkboxes still come through as step fields
  const byKey = Object.fromEntries(spec.fields.map((f) => [f.key, f]));
  assert.ok(byKey['1'], 'expected the Free cancellation filter checkbox as a field');
  assert.strictEqual(byKey['1'].type, 'tickmark');
});

test('an injected isTracking predicate overrides the default regex denylist', () => {
  // AI classification plugs in here: deriveFormSpec stays sync/pure/testable,
  // an async caller (server/store.js) can compute a smarter tracking-key set
  // up front and hand it in, without deriveFormSpec itself touching the network.
  const alwaysTracking = () => true;
  const spec = deriveFormSpec(bookingMidflow, { isTracking: alwaysTracking });
  const urlFields = spec.fields.filter((f) => f.source === 'url');
  assert.strictEqual(urlFields.length, 0, 'every url param should be excluded when isTracking always returns true');

  const neverTracking = () => false;
  const spec2 = deriveFormSpec(bookingMidflow, { isTracking: neverTracking });
  const keys2 = spec2.fields.filter((f) => f.source === 'url').map((f) => f.key);
  assert.ok(keys2.includes('aid'), 'aid should now be included since isTracking always returns false');
});

test('step fields carry the recorded context through to the form spec', () => {
  // the naming/self-healing layers can only use context that survives this
  // far -- dropping it here would silently undo the whole point of capturing
  // it at record time.
  const ctx = { tag: 'button', attrs: { 'data-testid': 'adults-inc' }, nearbyText: 'Adults | 2', ancestors: ['div.counter'] };
  const rec = {
    steps: [
      { id: 1, url: 'https://a.com/s', fieldType: 'text', label: 'Q', value: 'x' },
      { id: 2, url: 'https://a.com/s', fieldType: 'stepper', label: '', value: '', context: ctx },
    ],
  };
  const spec = deriveFormSpec(rec);
  const stepper = spec.fields.find((f) => f.key === '2');
  assert.deepStrictEqual(stepper.context, ctx);
});

test('step-driven recording -> step-mode form keyed by step id', () => {
  const spec = deriveFormSpec(selenium);
  assert.strictEqual(spec.mode, 'step');
  const keys = spec.fields.map((f) => f.key);
  assert.deepStrictEqual(keys, ['1', '2', '3']); // the 3 input steps, not the submit click
  assert.strictEqual(spec.fields[0].type, 'text');
  assert.strictEqual(spec.fields[1].type, 'dropdown');
  assert.strictEqual(spec.fields[2].type, 'tickmark');
});
