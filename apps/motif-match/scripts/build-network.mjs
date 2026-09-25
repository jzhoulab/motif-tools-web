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
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY } from 'd3-force';

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
const K = 6, THRESH = 0.6;
const S = Array.from({ length: N }, () => new Float32Array(N));
for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
        const s = ncc(enc[i], norms[i], enc[j], encRc[j], norms[j]);
        S[i][j] = s; S[j][i] = s;
    }
    if (i % 400 === 0) console.log(`  pairwise ${i}/${N}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log(`pairwise done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const edges = [];
const seen = new Set();
for (let i = 0; i < N; i++) {
    const row = S[i];
    const cand = [];
    for (let j = 0; j < N; j++) if (j !== i && row[j] >= THRESH) cand.push(j);
    cand.sort((a, b) => row[b] - row[a]);
    for (let n = 0; n < Math.min(K, cand.length); n++) {
        const j = cand[n];
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([i, j]);
    }
}
console.log(`kNN done: ${edges.length} edges`);

// ---- force layout ----
const simNodes = nodes.map((n, i) => ({ i }));
const simLinks = edges.map(([s, t]) => ({ source: s, target: t }));
const sim = forceSimulation(simNodes)
    .force('link', forceLink(simLinks).id((d) => d.i).distance(18).strength(0.6))
    .force('charge', forceManyBody().strength(-14).distanceMax(220).theta(0.9))
    .force('x', forceX(0).strength(0.02))
    .force('y', forceY(0).strength(0.02))
    .force('collide', forceCollide(3))
    .stop();
const ticks = 320;
for (let k = 0; k < ticks; k++) { sim.tick(); if (k % 60 === 0) console.log(`  layout tick ${k}/${ticks}`); }

// normalize coordinates to a stable range
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const s of simNodes) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); }
const span = Math.max(maxX - minX, maxY - minY) || 1;
const outNodes = nodes.map((n, i) => ({
    id: n.id,
    source: n.source,
    x: Math.round(((simNodes[i].x - minX) / span) * 1000) / 1000,
    y: Math.round(((simNodes[i].y - minY) / span) * 1000) / 1000,
}));

const out = { generated: new Date().toISOString().slice(0, 10), sources: SOURCES.map((s) => ({ key: s.key, count: s.motifs.length })), nodes: outNodes, edges };
const outPath = R('motif-network.json');
writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${outPath}: ${outNodes.length} nodes, ${edges.length} edges, ${(JSON.stringify(out).length / 1e6).toFixed(2)} MB`);
