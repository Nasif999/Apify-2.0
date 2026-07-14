# Apify v2 — Phase 1 Plan: Extension Recorder + Field Detection PoC

**Goal:** Prove the browser extension can record a real browser task and correctly classify field types (calendar / dropdown / tickmark / nested), exporting an inspectable recording JSON. No replay engine, no platform yet.

**Stack:** Chrome MV3 extension, vanilla JS. Pure logic in `lib/` (dual-usable as content scripts + node test modules). Tests: `node:test` + `jsdom`. TDD on pure logic; manual integration test in Chrome on YouTube.

## Field types to classify
- **text** — text input / search / contenteditable
- **dropdown** — `<select>`, or ARIA combobox/listbox
- **calendar** — date input, or date-picker widgets (role/aria/class heuristics)
- **tickmark** — checkbox, radio, switch/toggle
- **nested** — a field that appears only after interacting with a parent (e.g. stepper → child-age dropdown)

## Components / files
- `extension/manifest.json` — MV3 manifest, content scripts + popup
- `extension/popup.html` / `popup.js` — start/stop recording UI, export/copy recording
- `extension/content.js` — thin: listens to DOM events, delegates to lib, holds recording, responds to popup messages
- `extension/lib/selector.js` — `generateSelector(el)`: stable id → data-* → name/aria-label → class combo → nth-of-type fallback
- `extension/lib/classify.js` — `classifyField(el)`: returns one of the field types above
- `extension/lib/recorder.js` — recording state model: add action, serialize to JSON
- `test/selector.test.js`, `test/classify.test.js`, `test/recorder.test.js`

## Tasks (TDD each: red → green → commit)
1. Project scaffold: package.json, jsdom, node:test wiring, git init
2. `selector.js` — generateSelector with fallback chain (pure, TDD)
3. `classify.js` — classifyField for all 5 types (pure, TDD)
4. `recorder.js` — recording model + JSON serialize (pure, TDD)
5. `manifest.json` + `content.js` — wire capture, message handling
6. `popup.html`/`popup.js` — start/stop, export recording JSON
7. Manual integration test on YouTube in Chrome; iterate on misclassifications
8. Code review pass (code-review skill)

## Out of scope (later phases)
Replay engine, Playwright, DeepSeek AI resolution, popup auto-close, multi-site piping, dashboard, pricing, marketplace, payments, admin, auth.
