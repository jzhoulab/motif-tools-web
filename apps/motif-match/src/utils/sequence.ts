// Turn a typed DNA/IUPAC consensus into a probability matrix (4 x L, rows A,C,G,T)
// so it can be compared against the motif map exactly like an uploaded motif.

const IUPAC: Record<string, number[]> = {
    A: [0], C: [1], G: [2], T: [3], U: [3],
    R: [0, 2], Y: [1, 3], S: [1, 2], W: [0, 3], K: [2, 3], M: [0, 1],
    B: [1, 2, 3], D: [0, 2, 3], H: [0, 1, 3], V: [0, 1, 2], N: [0, 1, 2, 3],
};

export function isSequence(s: string): boolean {
    const t = s.trim().toUpperCase();
    return t.length >= 4 && /^[ACGTURYSWKMBDHVN]+$/.test(t);
}

export function sequenceToPwm(seq: string): number[][] {
    const t = seq.trim().toUpperCase().replace(/[^ACGTURYSWKMBDHVN]/g, '');
    const pwm: number[][] = [[], [], [], []];
    const eps = 0.001;
    for (const ch of t) {
        const set = IUPAC[ch] || IUPAC.N;
        const p = (1 - 4 * eps) / set.length;
        const col = [eps, eps, eps, eps];
        for (const b of set) col[b] = p + eps;
        for (let b = 0; b < 4; b++) pwm[b].push(col[b]);
    }
    return pwm;
}
