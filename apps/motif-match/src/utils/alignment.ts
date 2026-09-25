// Helper functions for motif alignment and RC detection

// Flattened 4xL or array of [A,C,G,T] columns?
// MotifLogo expects [A,C,G,T] columns if transposed, or 4xL rows.
// The worker returns (N, 4, L) (array of array of arrays).
// Let's assume we work with 4xL (rows).

// Convert 4xL (rows) to Lx4 (cols) for easier iteration
export function toCols(pwm: number[][]): number[][] {
    const L = pwm[0].length;
    const cols: number[][] = [];
    for (let i = 0; i < L; i++) {
        cols.push([pwm[0][i], pwm[1][i], pwm[2][i], pwm[3][i]]);
    }
    return cols;
}

// RC: Reverse columns and complement (A<->T, C<->G)
export function getRC(pwm: number[][]): number[][] {
    const cols = toCols(pwm);
    const rcCols = cols.reverse().map(c => [c[3], c[2], c[1], c[0]]);
    // Convert back to 4xL
    const L = rcCols.length;
    const out: number[][] = [[], [], [], []];
    for (let i = 0; i < L; i++) {
        out[0].push(rcCols[i][0]);
        out[1].push(rcCols[i][1]);
        out[2].push(rcCols[i][2]);
        out[3].push(rcCols[i][3]);
    }
    return out;
}

// Cosine similarity across shifts
export function bestCosineAcrossShifts(m1: number[][], m2: number[][]): number {
    const cols1 = toCols(m1);
    const cols2 = toCols(m2);
    const L1 = cols1.length;
    const L2 = cols2.length;
    
    let best = -1e9;

    // Shift range: align start of m1 with end of m2, to end of m1 with start of m2
    // s is shift of m2 relative to m1
    // overlap indices:
    // i1 in m1, i2 in m2.
    
    for (let s = -(L1 - 1); s <= L2 - 1; s++) {
        const i1Start = Math.max(0, -s);
        const i2Start = Math.max(0, s);
        const overlapLen = Math.min(L1 - i1Start, L2 - i2Start);
        
        if (overlapLen <= 0) continue;

        let dot = 0, n1 = 0, n2 = 0;
        for (let k = 0; k < overlapLen; k++) {
            const c1 = cols1[i1Start + k];
            const c2 = cols2[i2Start + k];
            
            for (let j = 0; j < 4; j++) {
                dot += c1[j] * c2[j];
                n1 += c1[j] * c1[j];
                n2 += c2[j] * c2[j];
            }
        }
        
        const score = dot / Math.max(1e-12, Math.sqrt(n1 * n2));
        if (score > best) best = score;
    }
    
    return best;
}

// Decide whether `motif` should be reverse-complemented to match `refMotif`.
// `margin` requires the RC orientation to win by a clear amount, so near-palindromic
// motifs (where forward and RC align almost equally) keep their aligned forward
// orientation instead of flipping on a coin-toss difference.
// Per-column mean-centre (subtract the column mean) so cross-correlation is
// discriminative — informative columns become signed and align sharply.
function centerCols(pwm: number[][]): number[][] {
    return toCols(pwm).map((c) => {
        const m = (c[0] + c[1] + c[2] + c[3]) / 4;
        return [c[0] - m, c[1] - m, c[2] - m, c[3] - m];
    });
}

// Best ungapped offset aligning `motif` to `refMotif`, taken from the maximum
// of the cross-correlation (raw dot of mean-centred columns) over all offsets —
// the same notion of alignment the matcher uses. Returns `shift` = the column in
// the reference frame where the motif's first column sits (reference at 0).
export function bestShift(motif: number[][], refMotif: number[][]): { shift: number; score: number } {
    const cm = centerCols(motif);
    const cr = centerCols(refMotif);
    const Lm = cm.length;
    const Lr = cr.length;
    let best = -Infinity;
    let bestD = 0;
    for (let d = -(Lm - 1); d <= Lr - 1; d++) {
        let dot = 0, ov = 0;
        for (let j = 0; j < Lm; j++) {
            const rp = d + j;
            if (rp < 0 || rp >= Lr) continue;
            const a = cm[j], b = cr[rp];
            dot += a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
            ov++;
        }
        if (ov <= 0) continue;
        if (dot > best) { best = dot; bestD = d; }
    }
    return { shift: bestD, score: best };
}

export function decideAutoRC(motif: number[][], refMotif: number[][], margin = 0): boolean {
    const scFwd = bestCosineAcrossShifts(motif, refMotif);

    const motifRC = getRC(motif);
    const scRev = bestCosineAcrossShifts(motifRC, refMotif);

    return scRev > scFwd + margin + 1e-9;
}

