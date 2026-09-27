// Shared motif I/O and similarity primitives used by the offline build scripts
// (network layout, family assignment, family diagnostics). Keeping them in one
// place means the map and the family atlas are computed from identical numbers.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const R = (f) => resolve(ROOT, 'resources', f);
export const BG = [0.25, 0.25, 0.25, 0.25];
export const EPS = 0.01;

export function toRows(pwm) {
    if (pwm.length === 4) return pwm;
    const L = pwm.length, rows = [[], [], [], []];
    for (let i = 0; i < L; i++) for (let b = 0; b < 4; b++) rows[b].push(pwm[i][b]);
    return rows;
}
export function fromJson(file) {
    const d = JSON.parse(readFileSync(R(file), 'utf8'));
    return d.motifs.map((m) => ({ id: m.id, name: m.name || m.id, pwm: toRows(m.pwm) }));
}
export function fromMeme(file) {
    const lines = readFileSync(R(file), 'utf8').split(/\r?\n/);
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
export function loadDnaSources() {
    return [
        { key: 'JASPAR', motifs: fromJson('JASPAR2024_CORE_vertebrates.json') },
        { key: 'HOCOMOCO', motifs: fromMeme('H14CORE_meme_format.meme') },
        { key: 'CIS-BP', motifs: fromMeme('CISBP_Homo_sapiens.meme') },
        { key: 'Vierstra', motifs: fromJson('vierstra_clustered_motif_v2.json') },
    ];
}
export function loadDnaMotifs() {
    const nodes = [];
    for (const src of loadDnaSources()) for (const m of src.motifs) nodes.push({ id: m.id, name: m.name || m.id, source: src.key, pwm: m.pwm });
    return nodes;
}

// ---- similarity: mean-centered log-odds columns, best ungapped NCC over offsets ----
export function encode(pwm) {
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
export function rc(cols) {
    const L = cols.length / 4;
    const out = new Float32Array(cols.length);
    for (let i = 0; i < L; i++) {
        const s = (L - 1 - i) * 4, d = i * 4;
        out[d] = cols[s + 3]; out[d + 1] = cols[s + 2]; out[d + 2] = cols[s + 1]; out[d + 3] = cols[s];
    }
    return out;
}
export function norm(cols) { let s = 0; for (let i = 0; i < cols.length; i++) s += cols[i] * cols[i]; return Math.sqrt(s) || 1e-9; }
export function ncc(aCols, aNorm, bCols, bRc, bNorm) {
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
// Full N x N similarity (Float32 rows). ~7 s for 4.2k motifs.
export function similarityMatrix(pwms, log = () => {}) {
    const N = pwms.length;
    const enc = pwms.map(encode), encRc = enc.map(rc), norms = enc.map(norm);
    const S = Array.from({ length: N }, () => new Float32Array(N));
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) { const s = ncc(enc[i], norms[i], enc[j], encRc[j], norms[j]); S[i][j] = s; S[j][i] = s; }
        if (i % 500 === 0) log(`  pairwise ${i}/${N} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
    return S;
}

// ---- presentation helpers ----
const LET = 'ACGT';
// IUPAC consensus: one letter when a base dominates, a degenerate code when two or
// three share the column, "n" when the column is essentially flat. Lower case marks
// a weakly determined position, as in the usual MEME/TRANSFAC convention.
const IUPAC2 = { AC: 'm', AG: 'r', AT: 'w', CG: 's', CT: 'y', GT: 'k' };
const IUPAC3 = { ACG: 'v', ACT: 'h', AGT: 'd', CGT: 'b' };
export function consensus(pwm) {
    const L = pwm[0].length;
    let out = '';
    for (let i = 0; i < L; i++) {
        const col = [0, 1, 2, 3].map((b) => ({ b, p: pwm[b][i] })).sort((x, y) => y.p - x.p);
        if (col[0].p >= 0.6) out += LET[col[0].b];
        else if (col[0].p >= 0.4) out += LET[col[0].b].toLowerCase();
        else if (col[0].p + col[1].p >= 0.7) {
            const k = [col[0].b, col[1].b].sort((a, b) => a - b).map((b) => LET[b]).join('');
            out += IUPAC2[k] || 'n';
        } else if (col[0].p + col[1].p + col[2].p >= 0.85) {
            const k = [col[0].b, col[1].b, col[2].b].sort((a, b) => a - b).map((b) => LET[b]).join('');
            out += IUPAC3[k] || 'n';
        } else out += 'n';
    }
    return out;
}
export function infoContent(pwm) {
    const L = pwm[0].length;
    let total = 0;
    for (let i = 0; i < L; i++) {
        let h = 0;
        for (let b = 0; b < 4; b++) { const p = pwm[b][i]; if (p > 0) h -= p * Math.log2(p); }
        total += 2 - h;
    }
    return total;
}
// Trim flanking positions that carry almost no information, so a consensus string
// reads like the motif people quote rather than the padded matrix.
export function trimmed(pwm, minBits = 0.35) {
    const L = pwm[0].length;
    const bits = [];
    for (let i = 0; i < L; i++) {
        let h = 0;
        for (let b = 0; b < 4; b++) { const p = pwm[b][i]; if (p > 0) h -= p * Math.log2(p); }
        bits.push(2 - h);
    }
    let a = 0, z = L - 1;
    while (a < z && bits[a] < minBits) a++;
    while (z > a && bits[z] < minBits) z--;
    return pwm.map((row) => row.slice(a, z + 1));
}

// ---- which gene symbol(s) does a motif claim to represent? ----
// Each database labels its motifs differently, and the label is a *claim* about
// which factor binds: JASPAR/HOCOMOCO name the assayed protein, CIS-BP may name a
// non-human orthologue whose motif was inferred from DNA-binding-domain identity,
// and a Vierstra id names the archetype's dominant factor groups, not one protein.
export function symbolsOf(node) {
    const id = node.id || '', src = node.source || '', nm = node.name || '';
    if (src === 'Vierstra') {                       // AC0001:DLX/LHX:Homeodomain
        const p = id.split(':');
        return (p[1] || '').split(/[/,]/).map((s) => s.trim()).filter(Boolean);
    }
    if (src === 'CIS-BP' || /^M\d+(_|$)/.test(id)) { // "(TFAP2D)_(Mus_musculus)_(DBD_0.80)" or "SNAI2"
        const g = nm.match(/^\(([^)]+)\)/);
        return [g ? g[1] : (nm.split(/[\s_]/)[0] || '')].filter(Boolean);
    }
    if (src === 'HOCOMOCO') return [id.split('.')[0]].filter(Boolean);
    return id.split(' (')[0].split('::').map((s) => s.trim()).filter(Boolean); // JASPAR, incl. dimers
}
// Extra provenance a reader should know about, parsed out of the label itself.
export function provenanceOf(node) {
    const id = node.id || '', src = node.source || '', nm = node.name || '';
    const out = {};
    if (src === 'CIS-BP') {
        const sp = nm.match(/\)_\(([A-Za-z_]+)\)_\(/);
        if (sp) out.species = sp[1].replace(/_/g, ' ');
        const dbd = nm.match(/DBD_([0-9.]+)/);
        if (dbd) out.dbdIdentity = parseFloat(dbd[1]);   // <1.00 = motif inferred from a similar DBD
        out.inferred = !!(dbd && parseFloat(dbd[1]) < 1);
    }
    if (src === 'HOCOMOCO') {
        // AHR.H14CORE.0.P.B -> evidence letters (P=ChIP-Seq, S=HT-SELEX, M=Methyl-HT-SELEX,
        // G=integrative, I/B=other collections) and a A-D quality grade.
        const p = id.split('.');
        if (p.length >= 5) { out.evidence = p[3]; out.grade = p[4]; }
    }
    if (src === 'JASPAR' && /::/.test(id)) out.dimer = true;
    return out;
}
