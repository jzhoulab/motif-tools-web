/// <reference lib="webworker" />
import { parseOnnxWeights } from './utils/onnxParser';
import { computePairwiseScores, normalizeMotifs, clusterScores } from './utils/matcher';
import { parseMeme } from './utils/memeParser';

// Global state
let DB: any = null;

self.onmessage = async (e: MessageEvent) => {
    const { type, payload, format } = e.data;

    try {
        if (type === 'load-db') {
            if (format === 'meme') {
                // Parse MEME
                try {
                   const parsed = parseMeme(payload);
                   DB = parsed;
                } catch (err: any) {
                    throw new Error(`Failed to parse MEME: ${err.message}`);
                }
            } else {
                // Assume JSON
                DB = payload;
            }
            
            if (!DB || !DB.motifs) {
                 throw new Error("Invalid DB structure loaded.");
            }
            
            self.postMessage({ type: 'db-loaded', count: DB.motifs.length });
        } else if (type === 'match') {
            // payload is ArrayBuffer of ONNX file
            const buffer = payload as ArrayBuffer;
            
            self.postMessage({ type: 'status', message: 'Parsing ONNX...' });
            const parsedWeights = await parseOnnxWeights(buffer);
            
            // Find conv weights
            const convWeights = parsedWeights.filter(w => w.dims.length === 3); // (Out, In, L)
            
            if (convWeights.length === 0) {
                throw new Error("No Conv1d weights (3D tensors) found in ONNX file.");
            }
            
            const targetLayer = convWeights[0]; // Use first one
            self.postMessage({ 
                type: 'weights-loaded', 
                layerName: targetLayer.name, 
                dims: targetLayer.dims 
            });

            if (!DB) {
                throw new Error("Database not loaded.");
            }

            self.postMessage({ type: 'status', message: 'Processing & Clustering...' });

            // Prepare query filters
            const [outCh, inCh, len] = targetLayer.dims; // [200, 4, 51] usually
            
            const queryFilters = [];
            for (let i = 0; i < outCh; i++) {
                const filter = [];
                for (let j = 0; j < 4; j++) { // 4 channels
                    const row = [];
                    for (let k = 0; k < len; k++) {
                        row.push(targetLayer.data[i * 4 * len + j * len + k]);
                    }
                    filter.push(row);
                }
                queryFilters.push(filter);
            }

            // Prepare DB motifs
            const maxLen = Math.max(len, ...DB.motifs.map((m: any) => m.pwm[0].length));

            const pad = (pwm: number[][], targetL: number) => {
                const currL = pwm[0].length;
                const diff = targetL - currL;
                const left = Math.floor(diff / 2);
                const right = diff - left;
                return pwm.map(row => [
                    ...Array(left).fill(0.25),
                    ...row,
                    ...Array(right).fill(0.25)
                ]);
            };

            const paddedQuery = queryFilters.map(f => pad(f, maxLen));
            const paddedDB = DB.motifs.map((m: any) => pad(m.pwm, maxLen));

            // Combine ALL for full clustering
            const allMotifs = [...paddedQuery, ...paddedDB];
            const numQuery = paddedQuery.length;
            const numDB = paddedDB.length;
            const N = allMotifs.length;

            // Normalize
            const { clustering: clusteringMotifs, visualization: visMotifs } = normalizeMotifs(allMotifs);

            // Compute Full Pairwise Matrix (N x N)
            // We pass the same list as A and B to get N x N
            const scores = await computePairwiseScores(clusteringMotifs, clusteringMotifs);

            // Cluster
            // Match notebook: mutualBest=False, threshold=0.9
            const clusters = clusterScores(scores, 0.9, false);

            // Build output structure similar to notebook
            // We need to split clusters into Query-side and DB-side
            // For each cluster, check members. If any are Query (idx < numQuery), it's relevant.
            
            const qClusters = [];
            const dClusters = [];
            const matches = [];

            // Identify cluster representatives
            const clusterRep = new Map<number, number>(); // clusterIdx -> repIdx
            
            clusters.forEach((members, cid) => {
                if (members.length === 1) {
                    clusterRep.set(cid, members[0]);
                } else {
                    // Find member with highest sum of scores within cluster
                    let bestSum = -Infinity;
                    let bestIdx = members[0];
                    for (const i of members) {
                        let sum = 0;
                        for (const j of members) sum += scores[i][j];
                        if (sum > bestSum) {
                            bestSum = sum;
                            bestIdx = i;
                        }
                    }
                    clusterRep.set(cid, bestIdx);
                }
            });

            // Build cluster objects
            clusters.forEach((members, cid) => {
                const rep = clusterRep.get(cid)!;
                
                // Split members
                const qMem = members.filter(i => i < numQuery);
                const dMem = members.filter(i => i >= numQuery);

                // Create Query Cluster object if it has query members
                if (qMem.length > 0) {
                    // Rep for sub-cluster? Or use global rep? Notebook uses local rep.
                    // Let's simplify: use global rep if in qMem, else pick one.
                    let localRep = qMem.includes(rep) ? rep : qMem[0]; 
                    // Actually find local best
                    if (qMem.length > 1) {
                         let bestSum = -Infinity;
                         for (const i of qMem) {
                             let sum = 0;
                             for (const j of qMem) sum += scores[i][j];
                             if (sum > bestSum) { bestSum = sum; localRep = i; }
                         }
                    }

                    qClusters.push({
                        id: cid,
                        members: qMem,
                        rep: localRep,
                        size: qMem.length
                    });
                }

                // Create DB Cluster object
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

                    dClusters.push({
                        id: cid,
                        members: dMem,
                        rep: localRep,
                        size: dMem.length
                    });
                }
            });

            // Find best matches between Q-clusters and D-clusters
            // For each Q-cluster, find best D-cluster (highest average score between members)
            for (const qc of qClusters) {
                let bestDC = null;
                let bestAvg = -Infinity;
                let bestMax = -Infinity;
                let bestPair = { q: -1, d: -1 };

                for (const dc of dClusters) {
                    // Compute avg score between qc.members and dc.members
                    let sum = 0;
                    let count = 0;
                    let maxS = -1;
                    let bestQ = -1, bestD = -1;

                    for (const q of qc.members) {
                        for (const d of dc.members) {
                            const s = scores[q][d];
                            sum += s;
                            count++;
                            if (s > maxS) {
                                maxS = s;
                                bestQ = q;
                                bestD = d;
                            }
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
                        q_best: bestPair.q, // Best single pair indices
                        d_best: bestPair.d
                    });
                }
            }

            matches.sort((a, b) => b.avg - a.avg);

            // Send back everything needed for visualization
            // We need raw motifs (normalized or original? Notebook visualizes normalized?)
            // Notebook: "motifs_cols = A.transpose...". A is normalized.
            // So we send `normalizedAll`.
            
            // Also need annotations
            const annotations = [
                ...Array(numQuery).fill(0).map((_, i) => `Filter ${i}`),
                ...DB.motifs.map((m: any) => m.id)
            ];

            // Flatten scores for efficient transfer
            const flatScores = new Float32Array(N * N);
            for (let i = 0; i < N; i++) {
                flatScores.set(scores[i], i * N);
            }

            self.postMessage({ 
                type: 'results', 
                matches,
                motifs: visMotifs, // (N, 4, L)
                annotations,
                scores: flatScores,
                N 
            }, [flatScores.buffer]);
        }
    } catch (err: any) {
        self.postMessage({ type: 'error', message: err.message });
    }
};
