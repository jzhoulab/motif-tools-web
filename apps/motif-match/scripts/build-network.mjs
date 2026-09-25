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
const { UMAP } = umapPkg;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const R = (f) => resolve(root, 'resources', f);
const BG = [0.25, 0.25, 0.25, 0.25];
const EPS = 0.01;

// ---- parsers -> list of { id, pwm(4xL probabilities) } ----
function fromJson(file) {
    const d = JSON.parse(readFileSync(R(file), 'utf8'));
    return d.motifs.map((m) => ({ id: m.id, pwm: toRows(m.pwm) }));
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
    let id = null, rows = [], inM = false;
    const flush = () => {
        if (!id || !rows.length) return;
        const L = rows.length, pwm = [[], [], [], []];
        for (let i = 0; i < L; i++) for (let b = 0; b < 4; b++) pwm[b].push(rows[i][b]);
        motifs.push({ id, pwm });
    };
    for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        if (t.startsWith('MOTIF')) { flush(); const p = t.split(/\s+/); id = p[1]; rows = []; inM = false; continue; }
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
for (const src of SOURCES) for (const m of src.motifs) nodes.push({ id: m.id, source: src.key, pwm: m.pwm });
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

// ---- connected components -> cluster id per node (for map-style coloring) ----
const parent = Array.from({ length: N }, (_, i) => i);
const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
for (const [i, j] of edges) { const ra = find(i), rb = find(j); if (ra !== rb) parent[ra] = rb; }
const compMembers = new Map();
for (let i = 0; i < N; i++) { const r = find(i); (compMembers.get(r) || compMembers.set(r, []).get(r)).push(i); }
const bigComps = [...compMembers.values()].filter((m) => m.length >= 5).sort((a, b) => b.length - a.length);
const clusterId = new Int32Array(N).fill(-1); // -1 = not in a coloured cluster
bigComps.forEach((members, cid) => { for (const m of members) clusterId[m] = cid; });
console.log(`coloured clusters (size>=5): ${bigComps.length}`);

// ---- UMAP embedding from the precomputed similarity (distance = 1 - NCC) ----
// A neighbour-embedding gives an organic "map": related motifs form clusters,
// unrelated ones spread out — no artificial placement. We feed UMAP our own kNN.
const NN = 15;
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
const umap = new UMAP({ nComponents: 2, nNeighbors: NN, minDist: 0.25, spread: 1.4, random: rand });
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

// normalize coordinates to a stable range
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const s of simNodes) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); }
const span = Math.max(maxX - minX, maxY - minY) || 1;
const outNodes = nodes.map((n, i) => ({
    id: n.id,
    source: n.source,
    x: Math.round(((simNodes[i].x - minX) / span) * 1000) / 1000,
    y: Math.round(((simNodes[i].y - minY) / span) * 1000) / 1000,
    nn: nn[i],
    nns: Math.round(nnScore[i] * 100) / 100,
    c: clusterId[i],
}));

// ---- name each coloured cluster by its dominant TF family ----
function nameRoot(id, source) {
    if (source === 'Vierstra') {                 // AC0001:DLX/LHX:Homeodomain
        const p = id.split(':');
        if (p.length >= 2) return (p[1].split(/[/,]/)[0] || '').trim().replace(/\d+$/, '');
        return '';
    }
    if (/^M\d+(_|$)/.test(id)) return '';         // CIS-BP code (no TF name in id)
    const t = id.split(' (')[0].split('.')[0].split('::')[0]; // JASPAR / HOCOMOCO
    return t.replace(/[_-].*$/, '').replace(/\d+$/, '');
}
const clusterInfo = new Map();
outNodes.forEach((n, i) => {
    if (n.c < 0) return;
    let e = clusterInfo.get(n.c);
    if (!e) { e = { xs: [], ys: [], roots: new Map() }; clusterInfo.set(n.c, e); }
    e.xs.push(n.x); e.ys.push(n.y);
    const root = nameRoot(nodes[i].id, nodes[i].source);
    if (root) e.roots.set(root, (e.roots.get(root) || 0) + 1);
});
const clusters = [];
for (const [c, e] of clusterInfo) {
    let label = '', best = 0;
    for (const [r, cnt] of e.roots) if (cnt > best) { best = cnt; label = r; }
    clusters.push({
        c,
        label,
        size: e.xs.length,
        x: Math.round((e.xs.reduce((a, b) => a + b, 0) / e.xs.length) * 1000) / 1000,
        y: Math.round((e.ys.reduce((a, b) => a + b, 0) / e.ys.length) * 1000) / 1000,
    });
}
clusters.sort((a, b) => b.size - a.size);
console.log(`named ${clusters.filter((c) => c.label).length}/${clusters.length} clusters; top: ${clusters.slice(0, 8).map((c) => c.label + '(' + c.size + ')').join(', ')}`);

const out = { generated: new Date().toISOString().slice(0, 10), sources: SOURCES.map((s) => ({ key: s.key, count: s.motifs.length })), nodes: outNodes, edges, clusters };
const outPath = R('motif-network.json');
writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${outPath}: ${outNodes.length} nodes, ${edges.length} edges, ${(JSON.stringify(out).length / 1e6).toFixed(2)} MB`);
