// pricing.js — deterministic per-run quoted rate (BDT).
//
// Estimates real infra cost per run from the recording's complexity (browser
// compute scales with step count) plus the result-scraping cost (scales with the
// chosen output count), then applies a markup and rounds to a clean number.
// This is the platform's quoted rate — collected in full on every run; the
// marketplace resale split is layered on top of it later (see ADR 0001).
const BASE_COMPUTE = 1.5; // browser spin-up
const PER_STEP = 0.4; // per recorded action
const PER_RESULT = 0.2; // per scraped+structured result
const MARKUP = 4;
const FLOOR = 10;
const ROUND_TO = 5;

function quoteRate(recording, opts = {}) {
  const steps = ((recording && recording.steps) || []).length;
  const outputCount = opts.outputCount || 10;
  const cost = BASE_COMPUTE + PER_STEP * steps + PER_RESULT * outputCount;
  const price = Math.max(FLOOR, Math.ceil((cost * MARKUP) / ROUND_TO) * ROUND_TO);
  return {
    price,
    cost: Number(cost.toFixed(2)),
    steps,
    outputCount,
    currency: 'BDT',
  };
}

module.exports = { quoteRate };
