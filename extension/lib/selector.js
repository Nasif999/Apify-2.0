// selector.js — generate a stable CSS selector for a DOM element.
// Fallback chain (most stable first):
//   1. stable id            -> #id
//   2. test-hook attribute  -> [data-testid="..."]
//   3. name attribute       -> tag[name="..."]
//   4. aria-label           -> tag[aria-label="..."]
//   5. stable class combo   -> tag.a.b
//   6. nth-of-type anchored to the nearest stable ancestor
//
// Dual-usable: attaches to window (as a content script) and exports for node tests.
(function (global) {
  const TEST_HOOK_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];

  // Auto-generated ids (ember1234, radix :r1:, 4+ digit runs) are unstable across renders.
  function isStableId(id) {
    if (!id) return false;
    if (id.includes(':')) return false;
    if (/\d{4,}/.test(id)) return false;
    return true;
  }

  // PoC heuristic: any class containing a digit is treated as hashed/unstable
  // (css-1a2b3c, jsx-1832). Loses legit digit classes (col-6) but the nth-of-type
  // fallback still produces a working selector, so this is safe if imperfect.
  function isStableClass(cls) {
    if (!cls) return false;
    return !/\d/.test(cls);
  }

  function tagOf(el) {
    return el.tagName.toLowerCase();
  }

  function testHookOf(el) {
    for (const attr of TEST_HOOK_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) return `[${attr}="${v}"]`;
    }
    return null;
  }

  // A selector that reliably re-finds this element on its own, or null.
  function stableAnchor(el) {
    if (isStableId(el.id)) return `#${el.id}`;
    return testHookOf(el);
  }

  function nthOfType(el) {
    const tag = el.tagName;
    let n = 1;
    let sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === tag) n++;
      sib = sib.previousElementSibling;
    }
    return n;
  }

  function generateSelector(el) {
    if (!el || el.nodeType !== 1) return null;

    // 1. stable id
    if (isStableId(el.id)) return `#${el.id}`;

    // 2. test-hook attribute
    const hook = testHookOf(el);
    if (hook) return hook;

    const tag = tagOf(el);

    // 3. name attribute
    const name = el.getAttribute('name');
    if (name) return `${tag}[name="${name}"]`;

    // 4. aria-label
    const aria = el.getAttribute('aria-label');
    if (aria) return `${tag}[aria-label="${aria}"]`;

    // 5. stable class combo
    const classes = Array.from(el.classList).filter(isStableClass);
    if (classes.length) return `${tag}.${classes.join('.')}`;

    // 6. nth-of-type anchored to the nearest stable ancestor
    let ancestor = el.parentElement;
    let directParent = true;
    while (ancestor) {
      const anchor = stableAnchor(ancestor);
      if (anchor) {
        const combinator = directParent ? ' > ' : ' ';
        return `${anchor}${combinator}${tag}:nth-of-type(${nthOfType(el)})`;
      }
      ancestor = ancestor.parentElement;
      directParent = false;
    }

    // No stable ancestor: bare nth-of-type (rare; last resort).
    return `${tag}:nth-of-type(${nthOfType(el)})`;
  }

  const api = { generateSelector };
  if (global) global.ApifySelector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
