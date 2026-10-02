#!/usr/bin/env node
// Precompute the "map of known DNA motifs": a 2-D similarity layout of every
// motif across all bundled DNA databases (JASPAR, HOCOMOCO, CIS-BP, Vierstra).
// Output: resources/motif-network.json  { nodes:[{id,source,x,y}], edges:[[i,j]] }
//
// This runs offline so the browser can render the base map instantly; only the
// user's uploaded motifs are compared against it at runtime.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import umapPkg from 'umap-js';
import { groupedLayout } from './lib/grouped-layout.mjs';
const { UMAP } = umapPkg;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOT_SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)));
const R = (f) => resolve(root, 'resources', f);
const BG = [0.25, 0.25, 0.25, 0.25];
const EPS = 0.01;

// ---- parsers -> list of { id, pwm(4xL probabilities) } ----
function fromJson(file) {
    const d = JSON.parse(readFileSync(R(file), 'utf8'));
    return d.motifs.map((m) => ({ id: m.id, name: m.name || m.id, pwm: toRows(m.pwm) }));
}
function toRows(pwm) {
    if (pwm.length === 4) return pwm;
    const L = pwm.length, rows = [[], [], [], []];
    for (let i = 0; i < L; i++) for (let b = 0; b < 4; b++) rows[b].push(pwm[i][b]);
    return rows;
}
function fromMeme(file) {
    const text = readFileSync(R(file), 'utf8');
    const lines = text.split(/\r?\n/);
    const motifs = [];
    let id = null, mname = '', rows = [], inM = false;
    const flush = () => {
        if (!id || !rows.length) return;
        const L = rows.length, pwm = [[], [], [], []];
        for (let i = 0; i < L; i++) for (let b = 0; b < 4; b++) pwm[b].push(rows[i][b]);
        motifs.push({ id, name: mname || id, pwm });
    };
    for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        if (t.startsWith('MOTIF')) { flush(); const p = t.split(/\s+/); id = p[1]; mname = p.slice(2).join(' '); rows = []; inM = false; continue; }
        if (t.toLowerCase().startsWith('letter-probability')) { inM = true; continue; }
        if (inM) {
            const p = t.split(/\s+/);
            if (!/^[0-9.]/.test(p[0])) { inM = false; continue; }
            const nums = p.slice(0, 4).map(parseFloat);
            if (nums.length >= 4 && !nums.some(isNaN)) rows.push(nums); else inM = false;
        }
    }
    flush();
    return motifs;
}

const SOURCES = [
    { key: 'JASPAR', motifs: fromJson('JASPAR2024_CORE_vertebrates.json') },
    { key: 'HOCOMOCO', motifs: fromMeme('H14CORE_meme_format.meme') },
    { key: 'CIS-BP', motifs: fromMeme('CISBP_Homo_sapiens.meme') },
    { key: 'Vierstra', motifs: fromJson('vierstra_clustered_motif_v2.json') },
];

// ---- encode each motif as mean-centered log-odds columns (Float32) + norms ----
function encode(pwm) {
    const L = pwm[0].length;
    const cols = new Float32Array(L * 4);
    for (let i = 0; i < L; i++) {
        let mean = 0;
        const v = [0, 0, 0, 0];
        for (let b = 0; b < 4; b++) { v[b] = Math.log2((pwm[b][i] + EPS) / (BG[b] + EPS)); mean += v[b]; }
        mean /= 4;
        for (let b = 0; b < 4; b++) cols[i * 4 + b] = v[b] - mean;
    }
    return cols;
}
function rc(cols) {
    const L = cols.length / 4;
    const out = new Float32Array(cols.length);
    for (let i = 0; i < L; i++) {
        const s = (L - 1 - i) * 4, d = i * 4;
        out[d] = cols[s + 3]; out[d + 1] = cols[s + 2]; out[d + 2] = cols[s + 1]; out[d + 3] = cols[s];
    }
    return out;
}
function norm(cols) { let s = 0; for (let i = 0; i < cols.length; i++) s += cols[i] * cols[i]; return Math.sqrt(s) || 1e-9; }

// best ungapped normalized cross-correlation over offsets (both strands)
function ncc(aCols, aNorm, bCols, bRc, bNorm) {
    const La = aCols.length / 4, Lb = bCols.length / 4;
    let best = -1;
    for (const B of [bCols, bRc]) {
        for (let off = -(Lb - 1); off <= La - 1; off++) {
            let dot = 0;
            const start = Math.max(0, off), end = Math.min(La, Lb + off);
            for (let i = start; i < end; i++) {
                const ai = i * 4, bi = (i - off) * 4;
                dot += aCols[ai] * B[bi] + aCols[ai + 1] * B[bi + 1] + aCols[ai + 2] * B[bi + 2] + aCols[ai + 3] * B[bi + 3];
            }
            const s = dot / (aNorm * bNorm);
            if (s > best) best = s;
        }
    }
    return best;
}

// ---- assemble nodes ----
const nodes = [];
for (const src of SOURCES) for (const m of src.motifs) nodes.push({ id: m.id, name: m.name || m.id, source: src.key, pwm: m.pwm });
const N = nodes.length;
console.log(`Encoding ${N} DNA motifs from ${SOURCES.map((s) => `${s.key}:${s.motifs.length}`).join(', ')}`);

const enc = nodes.map((n) => encode(n.pwm));
const encRc = enc.map(rc);
const norms = enc.map(norm);

// ---- full pairwise (upper triangle) then kNN edges ----
const t0 = Date.now();
const K = 8, THRESH = 0.75;
const S = Array.from({ length: N }, () => new Float32Array(N));
for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
        const s = ncc(enc[i], norms[i], enc[j], encRc[j], norms[j]);
        S[i][j] = s; S[j][i] = s;
    }
    if (i % 400 === 0) console.log(`  pairwise ${i}/${N}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log(`pairwise done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Emphasize strong correlations and let weak ones decay to ~0:
//   w(s) = ((s - FLOOR) / (1 - FLOOR))^GAMMA, clamped to [0,1]
// with FLOOR=0.7 (so s<=0.7 contributes zero) and GAMMA>1 (superlinear).
const FLOOR = 0.7, GAMMA = 3;
const wOf = (s) => { const t = (s - FLOOR) / (1 - FLOOR); return t <= 0 ? 0 : Math.pow(Math.min(1, t), GAMMA); };

// Top-K neighbours per node (candidates), then keep only MUTUAL edges — this
// drops one-directional "bridge" links to hubs and leaves clique-like groups.
const topK = [];
for (let i = 0; i < N; i++) {
    const row = S[i];
    const cand = [];
    for (let j = 0; j < N; j++) if (j !== i && row[j] >= THRESH) cand.push(j);
    cand.sort((a, b) => row[b] - row[a]);
    topK.push(new Set(cand.slice(0, K)));
}
const edges = [];       // [i, j, correlation] for output + hover cliques
for (let i = 0; i < N; i++) {
    for (const j of topK[i]) {
        if (j > i && topK[j].has(i)) {           // mutual only
            edges.push([i, j, Math.round(S[i][j] * 100) / 100]);
        }
    }
}
const connected = new Set();
for (const [i, j] of edges) { connected.add(i); connected.add(j); }
console.log(`mutual kNN: ${edges.length} edges, ${connected.size}/${N} connected (threshold ${THRESH}, floor ${FLOOR}, gamma ${GAMMA})`);

// The map used to colour by connected components of the similarity graph. Single-linkage
// chains, so a component could walk from AP-1 through CREB to POU and be drawn as one
// territory of 318 motifs spanning seven unrelated families. Now that every motif has a
// curated family, the territories are the families themselves - computed after the
// layout, below, once each motif has coordinates.

// ---- UMAP embedding from the precomputed similarity (distance = 1 - NCC) ----
// A neighbour-embedding gives an organic "map": related motifs form clusters,
// unrelated ones spread out — no artificial placement. We feed UMAP our own kNN.
const NN = 10;
const knnIndices = [];
const knnDistances = [];
for (let i = 0; i < N; i++) {
    const row = S[i];
    const order = [];
    for (let j = 0; j < N; j++) if (j !== i) order.push(j);
    order.sort((a, b) => row[b] - row[a]);
    const idx = [i];                          // UMAP expects self as the first neighbour
    const dist = [0];
    for (let n = 0; n < NN - 1; n++) {
        const j = order[n];
        idx.push(j);
        dist.push(Math.max(0, 1 - row[j]));   // similarity -> distance
    }
    knnIndices.push(idx);
    knnDistances.push(dist);
}

// deterministic RNG so the map is stable across rebuilds
let seed = 1234567;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const t1 = Date.now();
// Tight cliques: small minDist packs members together, and damping UMAP's
// repulsion (repulsionStrength / negativeSampleRate) stops it pushing the
// clusters apart into a diffuse cloud.
const umap = new UMAP({
    nComponents: 2,
    nNeighbors: NN,
    minDist: 0.02,
    spread: 1.0,
    repulsionStrength: 0.4,
    negativeSampleRate: 3,
    random: rand,
});
umap.setPrecomputedKNN(knnIndices, knnDistances);
const dummyX = Array.from({ length: N }, () => [0]);
const embedding = umap.fit(dummyX);
console.log(`UMAP embedded ${N} motifs in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
const simNodes = embedding.map(([x, y]) => ({ x, y }));

// nearest overall relative per node (for the hover alignment), regardless of threshold
const nn = new Int32Array(N).fill(-1);
const nnScore = new Float32Array(N);
for (let i = 0; i < N; i++) {
    const row = S[i];
    let bj = -1, bs = -Infinity;
    for (let j = 0; j < N; j++) if (j !== i && row[j] > bs) { bs = row[j]; bj = j; }
    nn[i] = bj; nnScore[i] = bs;
}

// Normalize on a robust (1st-99th percentile) range so a handful of far outliers
// don't squeeze the dense core into a tiny patch. Outliers simply land outside
// [0,1] and still render.
const pct = (arr, q) => { const a = [...arr].sort((u, v) => u - v); return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]; };
const xsAll = simNodes.map((s) => s.x), ysAll = simNodes.map((s) => s.y);
const minX = pct(xsAll, 0.01), maxX = pct(xsAll, 0.99);
const minY = pct(ysAll, 0.01), maxY = pct(ysAll, 0.99);
const span = Math.max(maxX - minX, maxY - minY) || 1;
// ---- curated motif family for EVERY motif -------------------------------------
// resources/motif-family-assignment.json is built by scripts/families/assign.mjs from
// the ontology plus the per-symbol assignment tables; it also carries the label checks
// (does this motif actually look like the family its name claims?).
const ASSIGN = JSON.parse(readFileSync(R('motif-family-assignment.json'), 'utf8'));
// Map labels want a compact form: "AP-1 (FOS/JUN)" -> "AP-1".
const shortName = (name) => {
    let t = String(name).split(' (')[0].replace(/\s*\/\s*/g, '/');
    if (t.length > 26) t = t.slice(0, 25) + '\u2026';
    return t;
};
const ONTOLOGY = JSON.parse(readFileSync(resolve(ROOT_SCRIPTS, 'families/ontology.json'), 'utf8'));
const abbrOf = new Map(ONTOLOGY.map((f) => [f.key, f.abbr || shortName(f.name)]));
// Three lengths per family: `abbr` for the zoomed-out map, `short` once there is room,
// `name` for the card and the atlas link.
const famList = ASSIGN.families.map((f) => ({
    key: f.key, name: f.name, short: shortName(f.name), abbr: abbrOf.get(f.key) || shortName(f.name), class: f.class,
}));
const famIndex = new Map(famList.map((f, i) => [f.key, i]));
const famNameOf = nodes.map((n) => {
    const e = ASSIGN.motifs[n.id];
    return e ? e.f : '';
});
const famOf = famNameOf.map((k) => (k && famIndex.has(k) ? famIndex.get(k) : -1));
const missing = famOf.filter((f) => f < 0).length;
console.log(`families: ${famList.length}; motifs with a family: ${N - missing}/${N}`);
if (missing) console.warn(`! ${missing} motifs are missing from the assignment - rerun scripts/families/assign.mjs`);

// ---- family territories ------------------------------------------------------
// A family is not always one blob on the map: KRAB-ZNFs are scattered everywhere, and a
// centroid over scattered points lands in empty space. So for each family we find where
// its members are densest, and draw and label only that core - members outside it keep
// the family's colour but do not stretch the territory.
const CORE_R = 0.085;                      // radius of the core neighbourhood, map units
const clusterId = new Int32Array(N).fill(-1);
const famMembers = new Map();
famOf.forEach((f, i) => { if (f >= 0) (famMembers.get(f) || famMembers.set(f, []).get(f)).push(i); });
const territories = [];
for (const [f, members] of famMembers) {
    if (members.length < 4) continue;
    const px = members.map((i) => (simNodes[i].x - minX) / span);
    const py = members.map((i) => (simNodes[i].y - minY) / span);
    // densest point: the member with the most family neighbours within CORE_R
    let bi = 0, bn = -1;
    for (let a = 0; a < members.length; a++) {
        let c = 0;
        for (let b = 0; b < members.length; b++) {
            if (Math.hypot(px[a] - px[b], py[a] - py[b]) <= CORE_R) c++;
        }
        if (c > bn) { bn = c; bi = a; }
    }
    if (bn < 4) continue;                  // no coherent core: colour the dots, draw no territory
    const core = [];
    for (let b = 0; b < members.length; b++) {
        if (Math.hypot(px[bi] - px[b], py[bi] - py[b]) <= CORE_R) core.push(b);
    }
    for (const b of core) clusterId[members[b]] = f;
    territories.push({
        c: f,
        label: famList[f].abbr,
        name: famList[f].short,
        size: core.length,
        total: members.length,
        x: Math.round((core.reduce((s, b) => s + px[b], 0) / core.length) * 1000) / 1000,
        y: Math.round((core.reduce((s, b) => s + py[b], 0) / core.length) * 1000) / 1000,
    });
}
territories.sort((a, b) => b.size - a.size);
console.log(`family territories: ${territories.length} of ${famMembers.size} families have a coherent core; ` +
    `${clusterId.filter((c) => c >= 0).length}/${N} motifs inside one`);
console.log(`  largest: ${territories.slice(0, 8).map((t) => `${t.label}(${t.size}${t.size < t.total ? '/' + t.total : ''})`).join(', ')}`);

// ---- second layout: families arranged by their aggregate similarity ----------
// The organic layout above is built from each motif's nearest neighbours, which is the
// right scale for "these are the same motif" but leaves 30% of its input fabricated for
// motifs that have no real relatives. The grouped layout uses the two scales separately.
const t2 = Date.now();
const grouped = groupedLayout(S, famOf, famList.map((f) => f.key), { log: console.log });
console.log(`grouped layout built in ${((Date.now() - t2) / 1000).toFixed(1)}s`);
const groupedTerritories = grouped.territories.map((t) => ({
    ...t,
    label: famList[t.c]?.abbr || '',
    name: famList[t.c]?.short || '',
}));

const outNodes = nodes.map((n, i) => {
    const a = ASSIGN.motifs[n.id] || {};
    const out = {
        id: n.id,
        source: n.source,
        x: Math.round(((simNodes[i].x - minX) / span) * 1000) / 1000,
        y: Math.round(((simNodes[i].y - minY) / span) * 1000) / 1000,
        nn: nn[i],
        nns: Math.round(nnScore[i] * 100) / 100,
        c: clusterId[i],
        f: famOf[i],
        // grouped layout coordinates (see lib/grouped-layout.mjs)
        gx: Math.round(grouped.nodes[i].x * 1000) / 1000,
        gy: Math.round(grouped.nodes[i].y * 1000) / 1000,
    };
    // Label caveats, so the map can say when a motif's name is doing more work than the
    // evidence supports: sus = its closest relatives belong to family `alt`;
    // res = an uncharacterised motif that matches family `res`; inf = family inferred
    // from motif similarity because the label was generic; ev/sp = how the entry was made.
    if (a.sus && famIndex.has(a.alt)) { out.sus = 1; out.alt = famIndex.get(a.alt); }
    if (a.res && famIndex.has(a.res)) out.res = famIndex.get(a.res);
    if (a.inf) out.inf = 1;
    if (a.p?.evidence) out.ev = a.p.evidence + (a.p.grade || '');
    if (a.p?.species) out.sp = `${a.p.species} ${a.p.dbdIdentity ?? ''}`.trim();
    if (a.p?.dimer) out.dim = 1;
    return out;
});

const out = { generated: new Date().toISOString().slice(0, 10), sources: SOURCES.map((s) => ({ key: s.key, count: s.motifs.length })), nodes: outNodes, edges, clusters: territories, groupedClusters: groupedTerritories, families: famList };
const outPath = R('motif-network.json');
writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${outPath}: ${outNodes.length} nodes, ${edges.length} edges, ${(JSON.stringify(out).length / 1e6).toFixed(2)} MB`);
