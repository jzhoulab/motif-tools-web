#!/usr/bin/env node
// Cache each motif's nearest relatives (by the same NCC the map uses) so the family
// diagnostics and the "does this label match this motif?" check are cheap to re-run.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDnaMotifs, similarityMatrix, consensus, trimmed, infoContent } from '../lib/motifs.mjs';

// Cached next to the scripts (gitignored): ~20 s to rebuild from the databases.
const CACHE = resolve(import.meta.dirname, '.cache');
mkdirSync(CACHE, { recursive: true });
const OUT = process.argv[2] || resolve(CACHE, 'neighbors.json');
const K = 30;
const nodes = loadDnaMotifs();
console.log(`loaded ${nodes.length} DNA motifs`);
const S = similarityMatrix(nodes.map((n) => n.pwm), console.log);
const out = nodes.map((n, i) => {
    const row = S[i];
    const order = [];
    for (let j = 0; j < nodes.length; j++) if (j !== i) order.push(j);
    order.sort((a, b) => row[b] - row[a]);
    const top = order.slice(0, K);
    const t = trimmed(n.pwm);
    return {
        i, id: n.id, name: n.name, source: n.source,
        len: n.pwm[0].length, bits: Math.round(infoContent(n.pwm) * 10) / 10,
        cons: consensus(t),
        nbr: top.map((j) => [j, Math.round(row[j] * 1000) / 1000]),
    };
});
writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT} (${(JSON.stringify(out).length / 1e6).toFixed(2)} MB)`);
