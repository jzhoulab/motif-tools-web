#!/usr/bin/env node
// Integrity checks for the motif family atlas. Run by `npm test`; exits non-zero on
// anything that would ship a broken page or an unlabelled motif.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDnaMotifs } from '../lib/motifs.mjs';

const HERE = resolve(import.meta.dirname);
const RES = resolve(HERE, '../../../../resources');
const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); };

const ontology = JSON.parse(readFileSync(resolve(HERE, 'ontology.json'), 'utf8'));
const keys = new Set(ontology.map((f) => f.key));
check(keys.size === ontology.length, 'ontology.json has duplicate keys');
for (const f of ontology) check(f.key && f.name && f.class && f.def, `ontology entry ${f.key} is missing a field`);

const assign = JSON.parse(readFileSync(resolve(RES, 'motif-family-assignment.json'), 'utf8'));
const motifs = loadDnaMotifs();
let missing = 0;
for (const m of motifs) {
    const e = assign.motifs[m.id];
    if (!e) { missing++; continue; }
    check(keys.has(e.f), `${m.id}: family ${e.f} is not in the ontology`);
}
check(missing === 0, `${missing} motifs have no family assignment (rerun npm run families:assign)`);
check(assign.families.every((f) => keys.has(f.key)), 'assignment references a family outside the ontology');

const network = JSON.parse(readFileSync(resolve(RES, 'motif-network.json'), 'utf8'));
check(network.nodes.length === motifs.length, `motif-network.json has ${network.nodes.length} nodes for ${motifs.length} motifs`);
check(Array.isArray(network.families) && typeof network.families[0] === 'object',
    'motif-network.json families should be objects {key,name,short,class} - rerun npm run build:network');
const netKeys = new Set(network.families.map((f) => f.key));
for (const k of netKeys) check(keys.has(k), `network family ${k} is not in the ontology`);
for (const n of network.nodes) check(n.f != null && n.f >= 0, `${n.id} has no family index in the map`);

const HEADINGS = ['## The factors', '## The motif', '## Where it acts', '## Biology and disease', '## Reading a hit'];
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const dir = resolve(RES, 'families');
const written = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
for (const file of written) {
    const key = file.replace(/\.json$/, '');
    check(keys.has(key), `resources/families/${file} does not match any family key`);
    let e;
    try { e = JSON.parse(readFileSync(resolve(dir, file), 'utf8')); }
    catch (err) { fail.push(`resources/families/${file}: ${err.message}`); continue; }
    check(words(e.short) >= 60, `${key}: short is too brief (${words(e.short)} words)`);
    check(words(e.long) >= 400, `${key}: long is too brief (${words(e.long)} words)`);
    for (const h of HEADINGS) check(String(e.long || '').includes(h), `${key}: long is missing "${h}"`);
    check((e.refs || []).length >= 4, `${key}: fewer than 4 references`);
    for (const r of e.refs || []) {
        check(!!r.cite, `${key}: a reference has no citation text`);
        check(!r.pmid || /^\d{6,8}$/.test(String(r.pmid)), `${key}: implausible PMID ${r.pmid}`);
    }
}

const app = JSON.parse(readFileSync(resolve(RES, 'motif-families.app.json'), 'utf8'));
for (const k of netKeys) check(app[k], `motif-families.app.json is missing ${k} (rerun npm run families:build)`);

const n = assign.families.length;
if (fail.length) {
    console.error(`motif family atlas: ${fail.length} problem(s)`);
    for (const f of fail.slice(0, 40)) console.error(`  ${f}`);
    process.exit(1);
}
console.log(`motif family atlas OK: ${motifs.length} motifs, ${n} families, ${written.length} written entries`);
