const test = require('node:test');
const assert = require('node:assert');
const { makeDom } = require('./_setup');
const { captureContext } = require('../extension/lib/context');

function el(html) {
  return makeDom(html).body.firstElementChild;
}

test('captures the element identity basics', () => {
  const ctx = captureContext(el('<input type="search" id="q" name="query" placeholder="Search IMDb">'));
  assert.strictEqual(ctx.tag, 'input');
  assert.strictEqual(ctx.attrs.type, 'search');
  assert.strictEqual(ctx.attrs.id, 'q');
  assert.strictEqual(ctx.attrs.name, 'query');
  assert.strictEqual(ctx.attrs.placeholder, 'Search IMDb');
});

test('captures data-* attributes (sites often encode meaning there)', () => {
  const ctx = captureContext(el('<button data-testid="adults-increment" data-count="2">+</button>'));
  assert.strictEqual(ctx.attrs['data-testid'], 'adults-increment');
  assert.strictEqual(ctx.attrs['data-count'], '2');
});

test('captures nearby text so an unlabeled control can still be identified', () => {
  // this is the blank-stepper case: the +/- button itself says nothing, but
  // "Adults" sits next to it in the same row. Capturing that at record time is
  // what lets a later (AI) naming pass identify the field at all -- the
  // information is simply gone if we do not capture it here.
  const dom = makeDom(
    '<div class="row"><span>Adults</span><div class="counter"><button class="dec">-</button><span>2</span><button class="inc">+</button></div></div>'
  );
  const ctx = captureContext(dom.querySelector('button.inc'));
  assert.ok(ctx.nearbyText.includes('Adults'), `expected nearby text to mention Adults, got: ${ctx.nearbyText}`);
});

test('captures the ancestor chain as tag/class breadcrumbs', () => {
  const dom = makeDom('<form class="search-form"><div class="field"><input id="q"></div></form>');
  const ctx = captureContext(dom.querySelector('#q'));
  const chain = ctx.ancestors.join(' ');
  assert.match(chain, /form/);
  assert.match(chain, /search-form/);
  assert.match(chain, /field/);
});

test('captures a select\'s option list (the values are the real meaning)', () => {
  const dom = makeDom('<select id="age"><option>2</option><option>3</option><option>4</option></select>');
  const ctx = captureContext(dom.querySelector('#age'));
  assert.deepStrictEqual(ctx.options, ['2', '3', '4']);
});

test('omits the options list for non-select elements', () => {
  const ctx = captureContext(el('<button>Go</button>'));
  assert.strictEqual(ctx.options, undefined);
});

test('nearbyText is bounded so a huge container cannot bloat the recording', () => {
  const dom = makeDom(`<div class="row"><span>${'x'.repeat(2000)}</span><button class="inc">+</button></div>`);
  const ctx = captureContext(dom.querySelector('button.inc'));
  assert.ok(ctx.nearbyText.length <= 300, `nearbyText too long: ${ctx.nearbyText.length}`);
});

test('never throws on a bare detached element', () => {
  const dom = makeDom('<div></div>');
  const orphan = dom.createElement('button');
  assert.doesNotThrow(() => captureContext(orphan));
});
