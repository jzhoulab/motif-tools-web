/// <reference lib="webworker" />
import { parseOnnxWeights } from './utils/onnxParser';
import { computePairwiseScores, normalizeMotifs, clusterScores } from './utils/matcher';
import { parseMeme } from './utils/memeParser';

// Global state
let DB: any = null;

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

// Shared pipeline: cluster query motifs/filters against the loaded DB and match.
async function runMatch(queryFilters: number[][][], queryLabels: string[]) {
    if (!DB) throw new Error('Database not loaded.');
    if (!queryFilters.length) throw new Error('No query motifs/filters found in the input.');

    self.postMessage({ type: 'status', message: 'Processing & Clustering...' });

    const qLen = Math.max(...queryFilters.map((f) => f[0].length));
    const maxLen = Math.max(qLen, ...DB.motifs.map((m: any) => toRows(m.pwm)[0].length));

    const pad = (pwm: number[][], targetL: number) => {
        const currL = pwm[0].length;
        const diff = targetL - currL;
        const left = Math.floor(diff / 2);
        const right = diff - left;
        return pwm.map((row) => [...Array(left).fill(0.25), ...row, ...Array(right).fill(0.25)]);
    };

    const paddedQuery = queryFilters.map((f) => pad(f, maxLen));
    const paddedDB = DB.motifs.map((m: any) => pad(toRows(m.pwm), maxLen));

    const allMotifs = [...paddedQuery, ...paddedDB];
    const numQuery = paddedQuery.length;
    const N = allMotifs.length;

    const { clustering: clusteringMotifs, visualization: visMotifs } = normalizeMotifs(allMotifs);
    const scores = await computePairwiseScores(clusteringMotifs, clusteringMotifs);
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
            // payload is an ArrayBuffer of an ONNX file
            const buffer = payload as ArrayBuffer;
            self.postMessage({ type: 'status', message: 'Parsing ONNX...' });
            const parsedWeights = await parseOnnxWeights(buffer);
            const convWeights = parsedWeights.filter((w) => w.dims.length === 3); // (Out, In, L)
            if (convWeights.length === 0) {
                throw new Error('No Conv1d weights (3-D tensors) found in the ONNX file. Expected a first-layer Conv1d of shape (filters x 4 x width).');
            }
            const targetLayer = convWeights[0];
            const [outCh, , len] = targetLayer.dims;
            if (targetLayer.dims[1] !== 4) {
                throw new Error(`First conv layer has ${targetLayer.dims[1]} input channels; expected 4 (A/C/G/T). Shape was ${targetLayer.dims.join(' x ')}.`);
            }
            self.postMessage({ type: 'weights-loaded', layerName: targetLayer.name, dims: targetLayer.dims });

            const queryFilters: number[][][] = [];
            for (let i = 0; i < outCh; i++) {
                const filter: number[][] = [];
                for (let j = 0; j < 4; j++) {
                    const row: number[] = [];
                    for (let k = 0; k < len; k++) row.push(targetLayer.data[i * 4 * len + j * len + k]);
                    filter.push(row);
                }
                queryFilters.push(filter);
            }
            const labels = queryFilters.map((_, i) => `Filter ${i}`);
            await runMatch(queryFilters, labels);
        } else if (type === 'match-motifs') {
            // payload is a parsed motif set: { name?, motifs: [{ id, pwm }] }
            const motifs = payload?.motifs;
            if (!motifs || !motifs.length) throw new Error('No motifs found in the uploaded file.');
            self.postMessage({ type: 'weights-loaded', layerName: payload.name || 'Uploaded motifs', dims: [motifs.length, 4, 0] });
            const queryFilters = motifs.map((m: any) => toRows(m.pwm));
            const labels = motifs.map((m: any, i: number) => m.id || m.name || `Motif ${i}`);
            await runMatch(queryFilters, labels);
        }
    } catch (err: any) {
        self.postMessage({ type: 'error', message: err.message });
    }
};
