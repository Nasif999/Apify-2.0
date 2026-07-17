#!/usr/bin/env node
// cli.js — run a recording with new values and print the result.
//
// Usage:
//   node runner/cli.js <recording.json> [--headed] [--shot <path>] [--set key=value]...
//
// --set for URL-driven recordings uses query-param names (ss, checkin, ...);
// for step-driven recordings it uses step selectors. Repeat --set for multiples.
const fs = require('fs');
const { replay } = require('./replay-runner');

function parseArgs(argv) {
  const args = { file: null, headed: false, shot: null, set: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headed') args.headed = true;
    else if (a === '--shot') args.shot = argv[++i];
    else if (a === '--wait') args.wait = argv[++i];
    else if (a === '--scrape') args.scrape = true;
    else if (a === '--set') {
      const kv = argv[++i] || '';
      const eq = kv.indexOf('=');
      if (eq > 0) {
        const key = kv.slice(0, eq);
        const val = kv.slice(eq + 1);
        // Repeated --set of the same key builds an array.
        if (key in args.set) args.set[key] = [].concat(args.set[key], val);
        else args.set[key] = val;
      }
    } else if (!args.file) args.file = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('Usage: node runner/cli.js <recording.json> [--headed] [--shot <path>] [--set key=value]...');
    process.exit(1);
  }
  const recording = JSON.parse(fs.readFileSync(args.file, 'utf8'));
  const result = await replay(recording, args.set, {
    headless: !args.headed,
    screenshotPath: args.shot,
    waitForSelector: args.wait,
    scrape: args.scrape,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('Replay failed:', e.message);
  process.exit(1);
});
