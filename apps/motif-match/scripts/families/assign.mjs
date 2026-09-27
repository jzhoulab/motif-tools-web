#!/usr/bin/env node
// Assign every DNA motif to a curated family, then check the assignment against the
// data: a motif's label is a claim about which factor binds it, and the claim can be
// wrong (indirect binding in ChIP, a motif transferred from a distant orthologue, an
// archetype named after only its commonest member). We therefore also report, for
// each motif, whether its nearest relatives agree with its own label.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDnaMotifs, symbolsOf, provenanceOf, consensus, trimmed, infoContent, encode, rc, norm, ncc } from '../lib/motifs.mjs';
import { normalize } from './aliases.mjs';

const HERE = resolve(import.meta.dirname);
const SCRATCH = resolve(HERE, '.cache');   // neighbour cache + per-family briefing files
mkdirSync(SCRATCH, { recursive: true });
const ontology = JSON.parse(readFileSync(resolve(HERE, 'ontology.json'), 'utf8'));
const byKey = new Map(ontology.map((f) => [f.key, f]));

// symbol -> family key, merged from the curated assignment tables
const symMap = new Map();
const tables = [];
for (const f of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
    const p = resolve(HERE, `assign-${f}.json`);
    if (!existsSync(p)) { console.warn(`! missing ${p}`); continue; }
    const d = JSON.parse(readFileSync(p, 'utf8'));
    tables.push(f);
    for (const [s, k] of Object.entries(d.assignments)) {
        if (!byKey.has(k)) { console.warn(`! ${f}: ${s} -> unknown key ${k}`); continue; }
        symMap.set(normalize(s), k);
    }
}
console.log(`assignment tables: ${tables.join(', ')} -> ${symMap.size} symbols`);

const nodes = loadDnaMotifs();
const nbrs = JSON.parse(readFileSync(resolve(SCRATCH, 'neighbors.json'), 'utf8'));
if (nbrs.length !== nodes.length) throw new Error('neighbour cache is stale - rerun neighbors.mjs');

// A motif can name several factors (JASPAR dimers, Vierstra archetypes). Take the
// first symbol that resolves; record the rest so the page can show the full claim.
const unresolved = new Map();
const motifs = nodes.map((n, i) => {
    const syms = symbolsOf(n).map(normalize);
    let key = null;
    for (const s of syms) if (symMap.has(s)) { key = symMap.get(s); break; }
    if (!key) for (const s of syms) unresolved.set(s, (unresolved.get(s) || 0) + 1);
    const t = trimmed(n.pwm);
    return {
        i, id: n.id, source: n.source, syms, family: key || 'CG_OTHER',
        resolved: !!key, cons: consensus(t), len: n.pwm[0].length,
        bits: Math.round(infoContent(n.pwm) * 10) / 10,
        prov: provenanceOf(n),
    };
});
console.log(`resolved ${motifs.filter((m) => m.resolved).length}/${motifs.length} motifs`);

// ---- fill in generically labelled motifs from the data --------------------------
// 266 Vierstra archetypes are labelled only "ZNF", and a few only "ZBTB"/"ZSCAN"/"ZFP".
// The label carries no information beyond the structural class, so where the motif's
// closest relatives across the other databases agree on a family, inherit theirs and
// record that this came from motif similarity rather than from the label.
const GENERIC = new Set(['ZNF', 'ZFP', 'ZBTB', 'ZSCAN', 'ZKSCAN', 'ZBT', 'ZSC']);
const nbrCache = JSON.parse(readFileSync(resolve(SCRATCH, 'neighbors.json'), 'utf8'));
let inferred = 0;
{
    const base = motifs.map((m) => m.family);
    for (const m of motifs) {
        if (!m.syms.length || !m.syms.every((s) => GENERIC.has(s))) continue;
        const votes = new Map();
        for (const [j, s] of nbrCache[m.i].nbr.slice(0, 4)) {
            if (s < 0.85) break;
            const f = base[j];
            if (!f || GENERIC.has((motifs[j].syms[0] || '')) || f === 'ZNF_OTHER' || f === 'KRAB_ZNF') continue;
            votes.set(f, (votes.get(f) || 0) + 1);
        }
        const top = [...votes].sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] >= 2) { m.family = top[0]; m.familyFromData = true; inferred++; }
        else { m.family = 'ZNF_UNNAMED'; m.genericLabel = true; }
    }
}
console.log(`family inferred from motif similarity for ${inferred} generically labelled motifs`);
if (unresolved.size) {
    console.log(`unresolved symbols (${unresolved.size}):`,
        [...unresolved].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([s, c]) => `${s}(${c})`).join(' '));
}

// ---- label-consistency check -------------------------------------------------
const famOf = motifs.map((m) => m.family);
const K = 10, SAME_WEAK = 0.7, OTHER_STRONG = 0.85;
// Families that are buckets rather than one motif: membership says almost nothing about
// what the matrix should look like, so a mismatch there is not evidence of a bad label.
const GRAB = new Set(['KRAB_ZNF', 'ZNF_OTHER', 'ZNF_UNNAMED', 'ZSCAN', 'ZBTB_OTHER',
    'CG_OTHER', 'CHROMATIN', 'ZNF_SCAN_OTHER', 'BHLH_OTHER', 'BZIP_OTHER', 'HMG_OTHER',
    'NR_OTHER', 'ZFP_TE', 'RBP_INFERRED']);
for (const m of motifs) {
    const nb = nbrs[m.i].nbr.slice(0, K);
    let bestSame = -1, bestOther = -1, bestOtherFam = null, agree = 0, seen = 0;
    for (const [j, s] of nb) {
        if (s < 0.6) continue;
        seen++;
        if (famOf[j] === m.family) { agree++; if (s > bestSame) bestSame = s; }
        else if (s > bestOther) { bestOther = s; bestOtherFam = famOf[j]; }
    }
    // nearest same-family motif anywhere in the top 30, not just the top 10
    for (const [j, s] of nbrs[m.i].nbr) if (famOf[j] === m.family && s > bestSame) bestSame = s;
    m.agree = seen ? Math.round((agree / seen) * 100) / 100 : null;
    m.bestSame = bestSame >= 0 ? bestSame : null;
    m.bestOther = bestOther >= 0 ? bestOther : null;
    m.altFamily = bestOtherFam;
    const strongElsewhere = m.bestOther != null && m.bestOther >= OTHER_STRONG &&
        bestOtherFam && !GRAB.has(bestOtherFam);
    if (GRAB.has(m.family)) {
        // Informative rather than suspicious: "this uncharacterised motif is essentially
        // the X motif" is exactly what a reader of a KZFP entry wants to know.
        m.resembles = strongElsewhere ? bestOtherFam : undefined;
        m.suspect = false;
    } else {
        // Flag only when the motif looks clearly more like another family than its own.
        m.suspect = !!(strongElsewhere && (m.bestSame == null || m.bestSame < SAME_WEAK));
    }
}

// ---- per-family aggregation --------------------------------------------------
const families = ontology.map((f) => ({ ...f }));
const famIdx = new Map(families.map((f, i) => [f.key, i]));
for (const f of families) { f.members = []; f.sources = {}; }
for (const m of motifs) {
    const f = families[famIdx.get(m.family)];
    f.members.push(m.i);
    f.sources[m.source] = (f.sources[m.source] || 0) + 1;
}
// Medoid: the member most similar to the rest of the family - the motif worth showing.
// The neighbour cache only holds each motif's top 30, which is far too short for a family
// of 200, so score the sample with real NCC instead of treating absences as zero.
const encAll = nodes.map((n) => encode(n.pwm));
const rcAll = encAll.map(rc);
const normAll = encAll.map(norm);
const simOf = (a, b) => ncc(encAll[a], normAll[a], encAll[b], rcAll[b], normAll[b]);
for (const f of families) {
    const ms = f.members;
    f.n = ms.length;
    if (!ms.length) continue;
    let best = ms[0], bestScore = -1;
    const sample = ms.length > 80 ? ms.filter((_, k) => k % Math.ceil(ms.length / 80) === 0) : ms;
    for (const a of sample) {
        let s = 0;
        for (const b of sample) if (a !== b) s += simOf(a, b);
        const avg = sample.length > 1 ? s / (sample.length - 1) : 0;
        if (avg > bestScore) { bestScore = avg; best = a; }
    }
    f.representative = motifs[best].id;
    f.repIndex = best;
    f.dataConsensus = motifs[best].cons;
    f.cohesion = Math.round(bestScore * 100) / 100;
    f.suspects = ms.filter((i) => motifs[i].suspect).length;
    f.genericLabels = ms.filter((i) => motifs[i].genericLabel).length;
    f.resembles = [...new Set(ms.map((i) => motifs[i].resembles).filter(Boolean))].slice(0, 12);
    f.symbols = [...new Set(ms.flatMap((i) => motifs[i].syms).filter((s) => symMap.get(normalize(s)) === f.key))].sort();
    delete f.members;
}
families.sort((a, b) => b.n - a.n);

const out = { generated: new Date().toISOString().slice(0, 10), families, motifs };
writeFileSync(resolve(SCRATCH, 'assignment.json'), JSON.stringify(out));

// ---- one briefing file per family, for whoever writes the entry ----------------
mkdirSync(resolve(SCRATCH, 'family-data'), { recursive: true });
const byFam = new Map();
for (const m of motifs) (byFam.get(m.family) || byFam.set(m.family, []).get(m.family)).push(m);
for (const f of families) {
    const ms = (byFam.get(f.key) || []).slice().sort((a, b) => (b.bits || 0) - (a.bits || 0));
    writeFileSync(resolve(SCRATCH, 'family-data', `${f.key}.json`), JSON.stringify({
        key: f.key, name: f.name, class: f.class, def: f.def,
        motifCount: f.n, bySource: f.sources, symbols: f.symbols,
        representative: f.representative, dataConsensus: f.dataConsensus, cohesion: f.cohesion,
        suspectCount: f.suspects,
        motifs: ms.map((m) => ({
            id: m.id, source: m.source, symbols: m.syms, consensus: m.cons, bits: m.bits,
            prov: m.prov, familyFromData: m.familyFromData || undefined,
            resembles: m.resembles, genericLabel: m.genericLabel || undefined,
            labelAgreement: m.agree, bestSame: m.bestSame,
            bestOther: m.bestOther, altFamily: m.suspect ? m.altFamily : undefined,
            suspect: m.suspect || undefined,
        })),
    }, null, 1));
}
console.log(`wrote ${families.length} briefing files to ${resolve(SCRATCH, 'family-data')}`);

// ---- committed artifact the map and the atlas both build from -------------------
const FAM_FIELDS = (f) => ({
    key: f.key, name: f.name, class: f.class, def: f.def, n: f.n,
    bySource: f.sources, symbols: f.symbols, representative: f.representative,
    dataConsensus: f.dataConsensus, cohesion: f.cohesion,
    suspects: f.suspects, genericLabels: f.genericLabels, resembles: f.resembles,
});
const assignment = {
    generated: out.generated,
    families: families.filter((f) => f.n > 0).map(FAM_FIELDS),
    motifs: Object.fromEntries(motifs.map((m) => {
        const e = { f: m.family };
        if (m.suspect) { e.sus = 1; e.alt = m.altFamily; }
        if (m.resembles) e.res = m.resembles;
        if (m.familyFromData) e.inf = 1;
        if (m.genericLabel) e.gen = 1;
        if (m.prov && Object.keys(m.prov).length) e.p = m.prov;
        return [m.id, e];
    })),
};
const artifact = resolve(HERE, '../../../../resources/motif-family-assignment.json');
writeFileSync(artifact, JSON.stringify(assignment));
console.log(`wrote ${artifact} (${(JSON.stringify(assignment).length / 1e6).toFixed(2)} MB)`);
console.log(`\nfamilies with members: ${families.filter((f) => f.n).length}/${families.length}`);
console.log(`empty families: ${families.filter((f) => !f.n).map((f) => f.key).join(', ') || '(none)'}`);
console.log(`\ntop families:`);
for (const f of families.slice(0, 25)) console.log(`  ${String(f.n).padStart(4)}  ${f.key.padEnd(14)} ${f.dataConsensus || ''}  cohesion ${f.cohesion}  suspect ${f.suspects}`);
console.log(`\nmotifs whose nearest relatives contradict their label: ${motifs.filter((m) => m.suspect).length}`);
