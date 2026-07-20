const test = require('node:test');
const assert = require('node:assert');
const { isSuspiciousClassification } = require('../server/store');

test('isSuspiciousClassification: true when the AI flags every single url param as tracking', () => {
  // regression: this is the bug actually observed live. The AI classified
  // ALL of adult/child/child_age/infant/cabin_class/trips as tracking noise,
  // wiping every real search field from the form and leaving only the
  // filter checkbox. A url-driven recording only reaches this branch
  // because isUrlDriven already established at least one param genuinely
  // changed -- excluding 100% of them is incoherent with that, a
  // confidently-wrong AI answer rather than a genuinely field-free search.
  const trackingKeys = new Set(['adult', 'child', 'child_age', 'infant', 'cabin_class', 'trips']);
  const paramKeys = ['adult', 'child', 'child_age', 'infant', 'cabin_class', 'trips'];
  assert.strictEqual(isSuspiciousClassification(trackingKeys, paramKeys), true);
});

test('isSuspiciousClassification: false when at least one real param survives', () => {
  const trackingKeys = new Set(['aid', 'sid']);
  const paramKeys = ['aid', 'sid', 'ss', 'checkin'];
  assert.strictEqual(isSuspiciousClassification(trackingKeys, paramKeys), false);
});

test('isSuspiciousClassification: false when there are no url params at all (nothing to exclude)', () => {
  assert.strictEqual(isSuspiciousClassification(new Set(), []), false);
});

test('isSuspiciousClassification: false when the tracking set is empty', () => {
  assert.strictEqual(isSuspiciousClassification(new Set(), ['ss', 'checkin']), false);
});
