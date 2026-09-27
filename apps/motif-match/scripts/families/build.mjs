#!/usr/bin/env node
// Merge the family ontology, the computed assignment and the written entries into
//   resources/motif-families.json      (full: used by the site generator)
//   resources/motif-families.app.json  (trimmed: bundled into the Match app)
// and report on anything missing or off-spec, so a half-written atlas is obvious.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDnaMotifs, trimmed } from '../lib/motifs.mjs';

const HERE = resolve(import.meta.dirname);
const RES = resolve(HERE, '../../../../resources');
const ENTRIES = resolve(RES, 'families');
const assign = JSON.parse(readFileSync(resolve(RES, 'motif-family-assignment.json'), 'utf8'));

const nodes = loadDnaMotifs();
const pwmById = new Map(nodes.map((n) => [n.id, n.pwm]));
const round = (pwm) => pwm.map((row) => row.map((v) => Math.round(v * 1000) / 1000));

const byFam = new Map();
for (const [id, e] of Object.entries(assign.motifs)) (byFam.get(e.f) || byFam.set(e.f, []).get(e.f)).push({ id, ...e });

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
// A consensus is only usable as a chip if it is actually a short IUPAC string; some
// families genuinely have no single consensus and the writer explains that in prose.
const isConsensusString = (s) => /^[ACGTUMRWSYKVHDBNacgtu()0-9,\/ -]{3,34}$/.test(String(s || '').trim()) && /[ACGTacgt]/.test(String(s || ''));
const HEADINGS = ['## The factors', '## The motif', '## Where it acts', '## Biology and disease', '## Reading a hit'];
const problems = [];
const families = [];

for (const f of assign.families) {
    const entryPath = resolve(ENTRIES, `${f.key}.json`);
    let e = {};
    if (existsSync(entryPath)) {
        try { e = JSON.parse(readFileSync(entryPath, 'utf8')); }
        catch (err) { problems.push(`${f.key}: entry does not parse (${err.message})`); }
    } else problems.push(`${f.key}: no entry written yet`);

    if (e.long) {
        const sw = words(e.short), lw = words(e.long);
        if (sw < 80 || sw > 170) problems.push(`${f.key}: short is ${sw} words (want 90-150)`);
        if (lw < 480 || lw > 1100) problems.push(`${f.key}: long is ${lw} words (want 550-900)`);
        let at = -1;
        for (const h of HEADINGS) {
            const i = e.long.indexOf(h);
            if (i < 0) problems.push(`${f.key}: long is missing the "${h}" section`);
            else if (i < at) problems.push(`${f.key}: sections out of order at "${h}"`);
            else at = i;
        }
        const refs = e.refs || [];
        if (refs.length < 5) problems.push(`${f.key}: only ${refs.length} references`);
        for (const r of refs) {
            if (!r.cite) problems.push(`${f.key}: a reference has no citation text`);
            if (r.pmid && !/^\d{6,8}$/.test(String(r.pmid))) problems.push(`${f.key}: implausible PMID ${r.pmid}`);
        }
        if (e.caveats && words(e.caveats) < 35) problems.push(`${f.key}: caveats is only ${words(e.caveats)} words`);
    }

    const members = (byFam.get(f.key) || []).map((m) => ({
        id: m.id, source: /^M\d+_/.test(m.id) ? 'CIS-BP' : undefined, // filled below
        consensus: undefined,
    }));
    families.push({
        key: f.key, name: f.name, class: f.class, def: f.def,
        n: f.n, bySource: f.bySource, symbols: f.symbols,
        representative: f.representative, dataConsensus: f.dataConsensus,
        cohesion: f.cohesion, suspects: f.suspects, resembles: f.resembles,
        aka: e.aka || [], consensus: e.consensus || '',
        consensusChip: isConsensusString(e.consensus) ? e.consensus.trim() : '',
        short: e.short || '',
        long: e.long || '', caveats: e.caveats || '', refs: e.refs || [],
        repPwm: pwmById.has(f.representative) ? round(trimmed(pwmById.get(f.representative))) : null,
        members,
    });
}

// member detail comes from the briefing data the writers saw, so the page and the
// entry cannot drift apart
const SCRATCH = resolve(HERE, '.cache/family-data');
for (const f of families) {
    const p = resolve(SCRATCH, `${f.key}.json`);
    if (!existsSync(p)) { f.members = []; continue; }
    const d = JSON.parse(readFileSync(p, 'utf8'));
    f.members = d.motifs.map((m) => ({
        id: m.id, source: m.source, consensus: m.consensus, bits: m.bits,
        prov: m.prov && Object.keys(m.prov).length ? m.prov : undefined,
        suspect: m.suspect, altFamily: m.altFamily, resembles: m.resembles,
        genericLabel: m.genericLabel,
    }));
}

const full = { generated: new Date().toISOString().slice(0, 10), sources: assign.generated, families };
writeFileSync(resolve(RES, 'motif-families.json'), JSON.stringify(full));

// The app only needs enough to fill a hover card and link out.
const app = {};
for (const f of families) app[f.key] = {
    name: f.name, class: f.class, n: f.n,
    // A written entry that gives no consensus is saying the family has none; showing
    // the medoid's consensus in its place would invent a claim the writer refused.
    cons: isConsensusString(f.consensus) ? f.consensus.trim() : (f.long ? '' : (f.dataConsensus || '')),
    nocons: f.long && !isConsensusString(f.consensus) ? 1 : undefined,
    aka: (f.aka || []).slice(0, 3),
    short: f.short || '',
};
writeFileSync(resolve(RES, 'motif-families.app.json'), JSON.stringify(app));

const done = families.filter((f) => f.long).length;
console.log(`motif-families.json: ${families.length} families, ${done} with a written entry (${(JSON.stringify(full).length / 1e6).toFixed(2)} MB)`);
console.log(`motif-families.app.json: ${(JSON.stringify(app).length / 1e3).toFixed(0)} kB`);
if (problems.length) {
    const missing = problems.filter((p) => /no entry written yet/.test(p));
    console.log(`\n${problems.length} issue(s); ${missing.length} families still unwritten:`);
    for (const p of problems.filter((p) => !/no entry written yet/.test(p))) console.log(`  ${p}`);
    if (missing.length) console.log(`  unwritten: ${missing.map((p) => p.split(':')[0]).join(' ')}`);
} else console.log('no issues');
