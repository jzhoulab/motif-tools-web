/// <reference lib="webworker" />
import { parseOnnxWeights } from './utils/onnxParser';
import { computePairwiseScores, normalizeMotifs, clusterScores } from './utils/matcher';
import { parseMeme } from './utils/memeParser';

// Global state
let DB: any = null;           // single database for the cluster view
let NET_DB: any[] = [];       // combined DNA motif set backing the network map (JSON node order)

// Ensure a PWM is stored as 4 rows x L columns (A,C,G,T). Accepts L x 4 too.
function toRows(pwm: number[][]): number[][] {
    if (pwm.length === 4) return pwm;
    if (pwm[0] && pwm[0].length === 4) {
        const L = pwm.length;
        const rows: number[][] = [[], [], [], []];
        for (let i = 0; i < L; i++) for (let b = 0; b < 4; b++) rows[b].push(pwm[i][b]);
        return rows;
    }
    return pwm;
}

// Center-pad a 4xL PWM to a target width with background (0.25).
function pad(pwm: number[][], targetL: number): number[][] {
    const currL = pwm[0].length;
    const diff = targetL - currL;
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return pwm.map((row) => [...Array(left).fill(0.25), ...row, ...Array(right).fill(0.25)]);
}

// Build a sparse k-nearest-neighbour edge list from a symmetric score matrix.
function knnEdges(scores: number[][], k: number, thresh: number) {
    const N = scores.length;
    const seen = new Set<string>();
    const edges: { source: number; target: number; weight: number }[] = [];
    for (let i = 0; i < N; i++) {
        const row = scores[i];
        const cand: number[] = [];
        for (let j = 0; j < N; j++) if (j !== i && row[j] >= thresh) cand.push(j);
        cand.sort((a, b) => row[b] - row[a]);
        for (let n = 0; n < Math.min(k, cand.length); n++) {
            const j = cand[n];
            const key = i < j ? `${i}-${j}` : `${j}-${i}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push({ source: i, target: j, weight: row[j] });
        }
    }
    return edges;
}

// Extract first-layer Conv1d filters (filters x 4 x width) from an ONNX buffer.
async function extractOnnxFilters(buffer: ArrayBuffer) {
    const parsedWeights = await parseOnnxWeights(buffer);
    const convWeights = parsedWeights.filter((w) => w.dims.length === 3); // (Out, In, L)
    if (convWeights.length === 0) {
        throw new Error('No Conv1d weights (3-D tensors) found in the ONNX file. Expected a first-layer Conv1d of shape (filters x 4 x width).');
    }
    const t = convWeights[0];
    const [outCh, , len] = t.dims;
    if (t.dims[1] !== 4) {
        throw new Error(`First conv layer has ${t.dims[1]} input channels; expected 4 (A/C/G/T). Shape was ${t.dims.join(' x ')}.`);
    }
    const filters: number[][][] = [];
    for (let i = 0; i < outCh; i++) {
        const filter: number[][] = [];
        for (let j = 0; j < 4; j++) {
            const row: number[] = [];
            for (let k = 0; k < len; k++) row.push(t.data[i * 4 * len + j * len + k]);
            filter.push(row);
        }
        filters.push(filter);
    }
    return { filters, labels: filters.map((_, i) => `Filter ${i}`), layerName: t.name, dims: t.dims };
}

// Turn a parsed motif set ({ motifs: [{ id, pwm }] }) into query filters + labels.
function motifsToFilters(data: any) {
    const motifs = data?.motifs;
    if (!motifs || !motifs.length) throw new Error('No motifs found in the uploaded file.');
    return {
        filters: motifs.map((m: any) => toRows(m.pwm)) as number[][][],
        labels: motifs.map((m: any, i: number) => m.id || m.name || `Motif ${i}`) as string[],
    };
}

// Pairwise NCC in row-blocks so the intermediate tensors stay bounded in memory
// (a single |A|x|B| conv over long motif sets can otherwise exhaust the tab).
async function pairwiseChunked(A: number[][][], B: number[][][], block = 128): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < A.length; i += block) {
        const sub = A.slice(i, i + block);
        const s = await computePairwiseScores(sub, B);
        for (const row of s) out.push(row);
    }
    return out;
}

// Shared pipeline: cluster query motifs/filters against the loaded DB and match.
async function runMatch(queryFilters: number[][][], queryLabels: string[]) {
    if (!DB) throw new Error('Database not loaded.');
    if (!queryFilters.length) throw new Error('No query motifs/filters found in the input.');

    self.postMessage({ type: 'status', message: 'Processing & Clustering...' });

    const qLen = Math.max(...queryFilters.map((f) => f[0].length));
    const maxLen = Math.max(qLen, ...DB.motifs.map((m: any) => toRows(m.pwm)[0].length));

    const paddedQuery = queryFilters.map((f) => pad(f, maxLen));
    const paddedDB = DB.motifs.map((m: any) => pad(toRows(m.pwm), maxLen));

    const allMotifs = [...paddedQuery, ...paddedDB];
    const numQuery = paddedQuery.length;
    const N = allMotifs.length;

    const { clustering: clusteringMotifs, visualization: visMotifs } = normalizeMotifs(allMotifs);
    const scores = await pairwiseChunked(clusteringMotifs, clusteringMotifs);
    const clusters = clusterScores(scores, 0.9, false);

    const clusterRep = new Map<number, number>();
    clusters.forEach((members, cid) => {
        if (members.length === 1) {
            clusterRep.set(cid, members[0]);
        } else {
            let bestSum = -Infinity;
            let bestIdx = members[0];
            for (const i of members) {
                let sum = 0;
                for (const j of members) sum += scores[i][j];
                if (sum > bestSum) { bestSum = sum; bestIdx = i; }
            }
            clusterRep.set(cid, bestIdx);
        }
    });

    const qClusters: any[] = [];
    const dClusters: any[] = [];
    const matches: any[] = [];

    clusters.forEach((members, cid) => {
        const rep = clusterRep.get(cid)!;
        const qMem = members.filter((i) => i < numQuery);
        const dMem = members.filter((i) => i >= numQuery);

        if (qMem.length > 0) {
            let localRep = qMem.includes(rep) ? rep : qMem[0];
            if (qMem.length > 1) {
                let bestSum = -Infinity;
                for (const i of qMem) {
                    let sum = 0;
                    for (const j of qMem) sum += scores[i][j];
                    if (sum > bestSum) { bestSum = sum; localRep = i; }
                }
            }
            qClusters.push({ id: cid, members: qMem, rep: localRep, size: qMem.length });
        }

        if (dMem.length > 0) {
            let localRep = dMem.includes(rep) ? rep : dMem[0];
            if (dMem.length > 1) {
                let bestSum = -Infinity;
                for (const i of dMem) {
                    let sum = 0;
                    for (const j of dMem) sum += scores[i][j];
                    if (sum > bestSum) { bestSum = sum; localRep = i; }
                }
            }
            dClusters.push({ id: cid, members: dMem, rep: localRep, size: dMem.length });
        }
    });

    for (const qc of qClusters) {
        let bestDC: any = null;
        let bestAvg = -Infinity;
        let bestMax = -Infinity;
        let bestPair = { q: -1, d: -1 };

        for (const dc of dClusters) {
            let sum = 0;
            let count = 0;
            let maxS = -1;
            let bestQ = -1, bestD = -1;
            for (const q of qc.members) {
                for (const d of dc.members) {
                    const s = scores[q][d];
                    sum += s;
                    count++;
                    if (s > maxS) { maxS = s; bestQ = q; bestD = d; }
                }
            }
            const avg = count > 0 ? sum / count : 0;
            if (avg > bestAvg) {
                bestAvg = avg;
                bestMax = maxS;
                bestDC = dc;
                bestPair = { q: bestQ, d: bestD };
            }
        }

        if (bestDC) {
            matches.push({
                q_id: qc.id,
                d_id: bestDC.id,
                q_rep: qc.rep,
                d_rep: bestDC.rep,
                avg: bestAvg,
                max: bestMax,
                q_size: qc.size,
                d_size: bestDC.size,
                q_members: qc.members,
                d_members: bestDC.members,
                q_best: bestPair.q,
                d_best: bestPair.d,
            });
        }
    }

    matches.sort((a, b) => b.avg - a.avg);

    const annotations = [...queryLabels, ...DB.motifs.map((m: any) => m.id)];

    const flatScores = new Float32Array(N * N);
    for (let i = 0; i < N; i++) flatScores.set(scores[i], i * N);

    self.postMessage(
        { type: 'results', matches, motifs: visMotifs, annotations, scores: flatScores, N },
        [flatScores.buffer]
    );
}

self.onmessage = async (e: MessageEvent) => {
    const { type, payload, format } = e.data;

    try {
        if (type === 'load-db') {
            if (format === 'meme') {
                try {
                    DB = parseMeme(payload);
                } catch (err: any) {
                    throw new Error(`Failed to parse MEME: ${err.message}`);
                }
            } else {
                DB = payload;
            }
            if (!DB || !DB.motifs) throw new Error('Invalid DB structure loaded.');
            self.postMessage({ type: 'db-loaded', count: DB.motifs.length });
        } else if (type === 'match') {
            self.postMessage({ type: 'status', message: 'Parsing ONNX...' });
            const { filters, labels, layerName, dims } = await extractOnnxFilters(payload as ArrayBuffer);
            self.postMessage({ type: 'weights-loaded', layerName, dims });
            await runMatch(filters, labels);
        } else if (type === 'match-motifs') {
            const { filters, labels } = motifsToFilters(payload);
            self.postMessage({ type: 'weights-loaded', layerName: payload?.name || 'Uploaded motifs', dims: [filters.length, 4, 0] });
            await runMatch(filters, labels);
        } else if (type === 'set-net-db') {
            // Combined DNA motif set backing the precomputed network map (same order).
            NET_DB = payload?.motifs || [];
        } else if (type === 'network-query') {
            // Place the user's motifs/filters onto the precomputed DNA map
            // (edges to their nearest motifs across all DNA databases).
            if (!NET_DB.length) throw new Error('Motif map not loaded.');
            let filters: number[][][];
            let labels: string[];
            if (payload?.kind === 'onnx') {
                self.postMessage({ type: 'status', message: 'Parsing ONNX...' });
                const r = await extractOnnxFilters(payload.buffer);
                filters = r.filters; labels = r.labels;
            } else {
                const r = motifsToFilters(payload?.data);
                filters = r.filters; labels = r.labels;
            }
            self.postMessage({ type: 'status', message: 'Placing your motifs on the map…' });

            const dbRows = NET_DB.map((m: any) => toRows(m.pwm));
            const nq = filters.length;
            const nd = dbRows.length;
            const maxLen = Math.max(...filters.map((f) => f[0].length), ...dbRows.map((r: number[][]) => r[0].length));
            const combined = [...filters.map((f) => pad(f, maxLen)), ...dbRows.map((r: number[][]) => pad(r, maxLen))];
            const { clustering, visualization } = normalizeMotifs(combined);
            const qClust = clustering.slice(0, nq);
            const dClust = clustering.slice(nq);
            const scores = await pairwiseChunked(qClust, dClust); // nq x nd

            const K = 4;
            const thresh = 0.5;
            const qnodes = filters.map((f, i) => ({ id: labels[i], pwm: visualization[i] }));
            const qedges: { q: number; db: number; weight: number }[] = [];
            const bestMatch: { db: number; weight: number }[] = [];
            for (let i = 0; i < nq; i++) {
                const row = scores[i];
                const ranked = row.map((s, j) => [j, s] as [number, number]).filter(([, s]) => s >= thresh).sort((a, b) => b[1] - a[1]).slice(0, K);
                for (const [j, s] of ranked) qedges.push({ q: i, db: j, weight: s });
                let bj = 0, bs = -Infinity;
                for (let j = 0; j < nd; j++) if (row[j] > bs) { bs = row[j]; bj = j; }
                bestMatch.push({ db: bj, weight: bs });
            }
            self.postMessage({ type: 'network-query', nodes: qnodes, edges: qedges, bestMatch });
        }
    } catch (err: any) {
        self.postMessage({ type: 'error', message: err.message });
    }
};
