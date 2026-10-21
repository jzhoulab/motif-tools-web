#!/usr/bin/env node
// Turn the working ledger from a fact-checking pass into the published audit record:
// every problem found, what kind it was, and what was done about it. Process notes
// and items struck as false positives are kept, so the record shows the check itself
// being checked.
//   node export.mjs <ledger.json> <out.json> "<pass label>"
import { readFileSync, writeFileSync } from 'node:fs';
const [, , src, out, label] = process.argv;
const l = JSON.parse(readFileSync(src, 'utf8'));
const items = l.items.map((i) => ({
    key: i.key,
    // items recorded as already handled were all corrections of an error
    found: i.found || (i.kind === 'done' ? 'error' : i.kind),
    outcome: i.kind === 'fixed' ? 'corrected' : i.kind === 'done' ? 'corrected' : i.kind === 'kept' ? 'flag rejected'
        : i.kind === 'false-positive' ? 'flag rejected' : i.kind === 'note' ? 'disclosed' : 'open',
    what: i.what.replace(/\s+/g, ' ').trim(),
    action: i.action || undefined,
}));
const count = (f) => items.filter(f).length;
const summary = {
    pass: label,
    flagged: count((i) => i.outcome !== 'disclosed'),
    corrected: count((i) => i.outcome === 'corrected'),
    rejected: count((i) => i.outcome === 'flag rejected'),
    open: count((i) => i.outcome === 'open'),
    byKind: Object.fromEntries(['error', 'overstated', 'loose', 'unverified'].map((k) => [k, count((i) => i.found === k)])),
    entries: new Set(items.filter((i) => i.outcome === 'corrected').flatMap((i) => i.key.split('+'))).size,
};
writeFileSync(out, JSON.stringify({ summary, items }, null, 1));
console.log(JSON.stringify(summary));
