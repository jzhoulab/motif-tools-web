// Two-scale layout: families placed relative to each other by the weak between-family
// similarity, members placed inside their family by the strong local similarity.
//
// The point of splitting the two scales is that they carry different information. Strong
// similarity (>0.75) says "these are the same motif" and is what the clique view uses.
// Weak similarity (0.4-0.7) says nothing useful about any individual pair, but aggregated
// over a whole family it is highly reproducible — a split-half test over the 7,140 family
// pairs gives r = 0.86 (r = 0.79 using only pairs scoring below 0.60) — and it recovers
// DNA-binding-domain class with AUC 0.76 without ever being told what a domain is. So it
// is the right thing to arrange families with, and the wrong thing to place motifs with.
import umapPkg from 'umap-js';
const { UMAP } = umapPkg;

const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// Similarity between two families: each member's best match in the other family, then the
// median of those. Median rather than max so a single bridging motif cannot drag two
// unrelated families together.
export function familySimilarity(S, groups) {
    const keys = [...groups.keys()];
    const F = keys.map(() => new Float64Array(keys.length));
    for (let a = 0; a < keys.length; a++) {
        const ma = groups.get(keys[a]);
        for (let b = a + 1; b < keys.length; b++) {
            const mb = groups.get(keys[b]);
            const fwd = ma.map((i) => { let s = -1; for (const j of mb) if (S[i][j] > s) s = S[i][j]; return s; });
            const rev = mb.map((j) => { let s = -1; for (const i of ma) if (S[i][j] > s) s = S[i][j]; return s; });
            const v = (median(fwd) + median(rev)) / 2;
            F[a][b] = v; F[b][a] = v;
        }
    }
    return { keys, F };
}

function embedFromSim(sim, n, { nNeighbors, minDist, seed }) {
    if (n === 1) return [[0, 0]];
    if (n === 2) return [[-0.5, 0], [0.5, 0]];
    const K = Math.max(2, Math.min(nNeighbors, n - 1));
    const idx = [], dist = [];
    for (let a = 0; a < n; a++) {
        const o = [];
        for (let b = 0; b < n; b++) if (b !== a) o.push(b);
        o.sort((x, y) => sim(a, y) - sim(a, x));
        const take = o.slice(0, K - 1);
        idx.push([a, ...take]);
        dist.push([0, ...take.map((b) => Math.max(0, 1 - sim(a, b)))]);
    }
    const u = new UMAP({ nComponents: 2, nNeighbors: K, minDist, spread: 1.0, random: rng(seed) });
    u.setPrecomputedKNN(idx, dist);
    return u.fit(Array.from({ length: n }, () => [0]));
}

// Normalize a point set into a unit disc centred on the origin.
function toUnitDisc(pts) {
    if (pts.length === 1) return [[0, 0]];
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let r = 0;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy));
    r = r || 1;
    return pts.map((p) => [(p[0] - cx) / r, (p[1] - cy) / r]);
}

// Families that are dissimilar to everything else embed far away, leaving large empty
// gaps. Pull every disc toward the centre as far as it will go without overlapping, so
// the map is compact while each disc keeps the neighbours the similarity gave it.
function compact(centres, radii, iterations = 220) {
    const n = centres.length;
    const cx = centres.reduce((s, c) => s + c[0], 0) / n;
    const cy = centres.reduce((s, c) => s + c[1], 0) / n;
    for (let it = 0; it < iterations; it++) {
        let moved = 0;
        for (let a = 0; a < n; a++) {
            const dx = cx - centres[a][0], dy = cy - centres[a][1];
            const d = Math.hypot(dx, dy);
            if (d < 1e-6) continue;
            const step = Math.min(d, radii[a] * 0.12 + 0.002);
            const nx = centres[a][0] + (dx / d) * step, ny = centres[a][1] + (dy / d) * step;
            let blocked = false;
            for (let b = 0; b < n && !blocked; b++) {
                if (b === a) continue;
                if (Math.hypot(centres[b][0] - nx, centres[b][1] - ny) < (radii[a] + radii[b]) * 1.06) blocked = true;
            }
            if (!blocked) { centres[a][0] = nx; centres[a][1] = ny; moved += step; }
        }
        if (moved < 1e-4) break;
    }
}

// Push overlapping family discs apart without losing their arrangement.
function relax(centres, radii, iterations = 400) {
    const n = centres.length;
    for (let it = 0; it < iterations; it++) {
        let moved = 0;
        for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
            const dx = centres[b][0] - centres[a][0], dy = centres[b][1] - centres[a][1];
            const d = Math.hypot(dx, dy) || 1e-6;
            const want = (radii[a] + radii[b]) * 1.06;
            if (d >= want) continue;
            const push = (want - d) / 2, ux = dx / d, uy = dy / d;
            centres[a][0] -= ux * push; centres[a][1] -= uy * push;
            centres[b][0] += ux * push; centres[b][1] += uy * push;
            moved += push;
        }
        if (moved < 1e-5) break;
    }
}

export function groupedLayout(S, famOf, famKeys, { log = () => {} } = {}) {
    const N = famOf.length;
    const groups = new Map();
    famOf.forEach((f, i) => { if (f >= 0) (groups.get(f) || groups.set(f, []).get(f)).push(i); });

    const { keys, F } = familySimilarity(S, groups);
    log(`  family-family similarity over ${keys.length} families`);
    const centres = embedFromSim((a, b) => F[a][b], keys.length, { nNeighbors: 18, minDist: 0.08, seed: 7 })
        .map((p) => [p[0], p[1]]);

    // disc area proportional to membership, filling about a third of the map
    const total = N;
    const base = Math.sqrt(0.30 / (Math.PI * total));
    const radii = keys.map((k) => Math.max(0.012, base * Math.sqrt(groups.get(k).length)));
    // put the centres on a comparable scale to the radii before pushing them apart
    {
        const xs = centres.map((c) => c[0]), ys = centres.map((c) => c[1]);
        const sx = Math.max(...xs) - Math.min(...xs) || 1, sy = Math.max(...ys) - Math.min(...ys) || 1;
        const s = 1 / Math.max(sx, sy);
        const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
        centres.forEach((c) => { c[0] = (c[0] - mx) * s; c[1] = (c[1] - my) * s; });
    }
    relax(centres, radii);
    compact(centres, radii);
    relax(centres, radii, 120);
    log(`  ${keys.length} family discs placed, packed and compacted`);

    // members inside their own family's disc
    const x = new Float64Array(N), y = new Float64Array(N);
    keys.forEach((k, fi) => {
        const m = groups.get(k);
        const local = embedFromSim((a, b) => S[m[a]][m[b]], m.length, { nNeighbors: 10, minDist: 0.06, seed: 99 + fi });
        const disc = toUnitDisc(local);
        // keep a little margin so dots do not sit exactly on the territory edge
        const r = radii[fi] * 0.88;
        m.forEach((idx, a) => {
            x[idx] = centres[fi][0] + disc[a][0] * r;
            y[idx] = centres[fi][1] + disc[a][1] * r;
        });
    });

    // normalize the whole thing into [0,1]
    const xs = [...x], ys = [...y];
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const nodes = [];
    for (let i = 0; i < N; i++) nodes.push({ x: (x[i] - minX) / span, y: (y[i] - minY) / span });
    const territories = keys.map((k, fi) => ({
        c: k,
        size: groups.get(k).length,
        x: Math.round(((centres[fi][0] - minX) / span) * 1000) / 1000,
        y: Math.round(((centres[fi][1] - minY) / span) * 1000) / 1000,
        r: Math.round((radii[fi] / span) * 1000) / 1000,
    }));
    return { nodes, territories, famKeysUsed: keys };
}
