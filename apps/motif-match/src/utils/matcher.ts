import * as tf from '@tensorflow/tfjs';

// Constants
const MOTIFCOR_THRESH = 0.9;

export interface Motif {
    id: string;
    name: string;
    pwm: number[][]; // 4 x L
}

// Helper to ensure shape (N, 4, L)
function ensureN4L(tensor: tf.Tensor): tf.Tensor3D {
    if (tensor.rank === 2) {
        // (4, L) -> (1, 4, L)
        return tensor.expandDims(0) as tf.Tensor3D;
    } else if (tensor.rank === 3) {
        const shape = tensor.shape;
        if (shape[1] !== 4) {
            // (N, L, 4) -> (N, 4, L)
            return tensor.transpose([0, 2, 1]) as tf.Tensor3D;
        }
    }
    return tensor as tf.Tensor3D;
}

// Mean center global (internal scoring normalization)
function meanCenterGlobal(x: tf.Tensor3D): tf.Tensor3D {
    const mean = x.mean([1, 2], true);
    return x.sub(mean);
}

// RC Flip: flip channels and positions
function rcFlip(x: tf.Tensor3D): tf.Tensor3D {
    // x is (N, 4, L)
    // Reverse axis 1 (channels: A,C,G,T -> T,G,C,A) and axis 2 (length)
    return x.reverse([1, 2]);
}

// External Normalization: (x - mean_col - 0.7 * abs(mean_col))
// Returns two versions: one for clustering (with /6 heuristic) and one for visualization (without)
export function normalizeMotifs(motifs: number[][][]): { clustering: number[][][], visualization: number[][][] } {
    return tf.tidy(() => {
        const t = tf.tensor3d(motifs); // (N, 4, L)
        
        // Mean along axis 1 (channels) -> (N, 1, L)
        const meanCol = t.mean(1, true);
        
        // Centered
        const centered = t.sub(meanCol);
        
        // Final: centered - 0.7 * absMean
        // Bug fix: use centered for abs mean to match notebook behavior
        const absMean = centered.abs().mean(1, true);
        const baseNormalized = centered.sub(absMean.mul(0.7));
        
        // Heuristic from notebook for clustering: mats[mats<0] = mats[mats<0] / 6.
        const negMask = baseNormalized.less(0);
        const scaled = baseNormalized.where(negMask, baseNormalized.div(6.0));
        
        return {
            clustering: scaled.arraySync() as number[][][],
            visualization: baseNormalized.arraySync() as number[][][]
        };
    });
}

// Pairwise scores circular (using FFT/Conv1d)
export async function computePairwiseScores(
    queryFilters: number[][][], // (M, 4, L)
    dbMotifs: number[][][],     // (N, 4, L)
): Promise<number[][]> {
    return tf.tidy(() => {
        // Convert to tensors
        const A = tf.tensor3d(queryFilters); // (M, 4, Lq)
        const B = tf.tensor3d(dbMotifs);     // (N, 4, Ld)

        // Pad to common length if needed, or assume they are padded.
        // For simplicity, let's assume they are padded to same length L for now, 
        // or we handle sliding window.

        // A0, B0 are already "normalized" by normalizeMotifs externally?
        // Notebook does external norm, THEN inside scorer does _mean_center_global.
        // So we do _mean_center_global here too.
        const A0 = meanCenterGlobal(A);
        const B0 = meanCenterGlobal(B);

        const Anorm = A0.mul(A0).sum([1, 2]).sqrt().expandDims(1); // (M, 1)
        const Bnorm = B0.mul(B0).sum([1, 2]).sqrt().expandDims(0); // (1, N)
        
        // Avoid division by zero
        const AnormSafe = Anorm.maximum(1e-12);
        const BnormSafe = Bnorm.maximum(1e-12);
        
        const denom = AnormSafe.matMul(BnormSafe); // (M, N)

        // Convolution
        // We can treat B as filters.
        // B shape: (N, 4, L). Conv1d filters need to be (kernelSize, inChannels, outChannels)
        // Here inChannels=4.
        // So we transpose B to (L, 4, N).
        const B_filters = B0.transpose([2, 1, 0]); // (L, 4, N)

        // A input: (M, 4, L). Conv1d input needs (batch, length, inChannels)
        // So transpose A to (M, L, 4).
        const A_input = A0.transpose([0, 2, 1]); // (M, L, 4)

        // We need 'same' padding for circular-like, or 'valid' for linear.
        // Notebook uses 'linear' mode in cell 336?
        // "mode='linear'".
        // Linear mode uses padding (implicit in 'same').
        // But conv1d 'same' output length matches input length.
        
        const convF = tf.conv1d(A_input, B_filters, 1, 'same'); // (M, L, N)

        // Max over length dimension
        const maxF = convF.max(1); // (M, N)

        // RC
        const B0_rc = rcFlip(B0);
        const B_filters_rc = B0_rc.transpose([2, 1, 0]);
        const convR = tf.conv1d(A_input, B_filters_rc, 1, 'same');
        const maxR = convR.max(1); // (M, N)

        const scores = tf.maximum(maxF, maxR).div(denom);
        
        // Clip scores
        const clipped = scores.clipByValue(-1.0, 1.0);

        return clipped.arraySync() as number[][];
    });
}

// Clustering with "mutual best" support
export function clusterScores(
    scores: number[][], 
    threshold: number = 0.95,
    mutualBest: boolean = true
): number[][] {
    const N = scores.length;
    const adj: number[][] = [];
    for (let i = 0; i < N; i++) adj.push([]);

    // Precompute max per row/col if mutualBest
    const rowMax = new Float32Array(N);
    const colMax = new Float32Array(N);
    
    if (mutualBest) {
        for (let i = 0; i < N; i++) {
            let max = -Infinity;
            for (let j = 0; j < N; j++) if (scores[i][j] > max) max = scores[i][j];
            rowMax[i] = max;
        }
        for (let j = 0; j < N; j++) {
            let max = -Infinity;
            for (let i = 0; i < N; i++) if (scores[i][j] > max) max = scores[i][j];
            colMax[j] = max;
        }
    }

    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
            const s = scores[i][j];
            if (s >= threshold) {
                let keep = true;
                if (mutualBest) {
                    // Must be best for both i and j?
                    // Notebook: (S >= S.max(axis=1)) & (S >= S.max(axis=0))
                    // Note: strictly >=, so ties are ok.
                    if (s < rowMax[i] || s < colMax[j] || s < rowMax[j] || s < colMax[i]) {
                        // Wait, symmetric matrix? Yes.
                        // So rowMax[i] == colMax[i].
                        if (s < rowMax[i] || s < rowMax[j]) {
                            keep = false;
                        }
                    }
                }
                if (keep) {
                    adj[i].push(j);
                    adj[j].push(i);
                }
            }
        }
    }

    const visited = new Set<number>();
    const clusters: number[][] = [];

    for (let i = 0; i < N; i++) {
        if (!visited.has(i)) {
            const cluster: number[] = [];
            // Skip singletons if they have no edges?
            // Notebook: "degree==0 -> non-clustered"
            // But here we just want connected components.
            
            if (adj[i].length === 0) {
                // Singleton
                // In notebook: "skip pure singletons (degree==0), keep anything with an edge"
                // But we want to return all clusters or handle singletons separately?
                // Let's return singletons as clusters of size 1 for now.
                // Notebook separates them.
                // Let's follow standard CC.
                visited.add(i);
                clusters.push([i]);
                continue;
            }

            const stack = [i];
            visited.add(i);
            while (stack.length > 0) {
                const u = stack.pop()!;
                cluster.push(u);
                for (const v of adj[u]) {
                    if (!visited.has(v)) {
                        visited.add(v);
                        stack.push(v);
                    }
                }
            }
            clusters.push(cluster);
        }
    }
    return clusters;
}
