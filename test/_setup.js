// Shared test helper: build a jsdom document and return a builder for elements.
const { JSDOM } = require('jsdom');

function makeDom(bodyHtml = '') {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
  return dom.window.document;
}

module.exports = { makeDom };
