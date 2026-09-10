// @ts-nocheck
import {
  flattenPpmColumns,
  columnNormsFromFlat,
  reverseComplementFlat,
  reverseComplementString,
  buildLogoCols,
  reverseLogoCols,
  buildTomTomCaches,
} from './tomtom';

const PAD = 51;
const BG = [0.295, 0.205, 0.205, 0.295];
const LOG2 = Math.log(2);
const BASE_IDX: Record<string, number> = { A: 0, C: 1, G: 2, T: 3, a: 0, c: 1, g: 2, t: 3 };
const IUPAC: Record<string, string[]> = {
  A: ["A"], C: ["C"], G: ["G"], T: ["T"], U: ["T"],
  R: ["A", "G"], Y: ["C", "T"], S: ["G", "C"], W: ["A", "T"],
  K: ["G", "T"], M: ["A", "C"], B: ["C", "G", "T"], D: ["A", "G", "T"],
  H: ["A", "C", "T"], V: ["A", "C", "G"], N: ["A", "C", "G", "T"]
};

export function toPPM(entry: any) {
  if (entry.pwm) {
    let pwm = entry.pwm;
    if (pwm.length !== 4 && pwm[0]?.length === 4) {
      const L = pwm.length;
      const out = [
        new Float64Array(L),
        new Float64Array(L),
        new Float64Array(L),
        new Float64Array(L)
      ];
      for (let i = 0; i < L; i++) {
        out[0][i] = pwm[i][0];
        out[1][i] = pwm[i][1];
        out[2][i] = pwm[i][2];
        out[3][i] = pwm[i][3];
      }
      pwm = out;
    } else {
      pwm = [
        Float64Array.from(pwm[0]),
        Float64Array.from(pwm[1]),
        Float64Array.from(pwm[2]),
        Float64Array.from(pwm[3])
      ];
    }
    const L = pwm[0].length;
    for (let i = 0; i < L; i++) {
      let s = pwm[0][i] + pwm[1][i] + pwm[2][i] + pwm[3][i];
      if (s === 0) s = 1;
      pwm[0][i] /= s; pwm[1][i] /= s; pwm[2][i] /= s; pwm[3][i] /= s;
    }
    return pwm;
  }
  if (entry.consensus) {
    const L = entry.consensus.length;
    const M = [
      new Float64Array(L),
      new Float64Array(L),
      new Float64Array(L),
      new Float64Array(L)
    ];
    for (let i = 0; i < L; i++) {
      const ch = entry.consensus[i].toUpperCase();
      const set = IUPAC[ch] || ["A", "C", "G", "T"];
      const w = 1 / set.length;
      for (const b of set) {
        const idx = BASE_IDX[b];
        if (idx !== undefined) M[idx][i] += w;
      }
    }
    return M;
  }
  throw new Error("Motif needs pwm or consensus");
}

export function consensusFromPPM(ppm: number[][]) {
  const L = ppm[0].length;
  const map = ["A", "C", "G", "T"];
  let s = "";
  for (let i = 0; i < L; i++) {
    let b = 0;
    let v = ppm[0][i];
    for (let k = 1; k < 4; k++) if (ppm[k][i] > v) { v = ppm[k][i]; b = k; }
    s += map[b];
  }
  return s;
}

export function toLogOdds(ppm: number[][]) {
  const L = ppm[0].length;
  const LO = [
    new Float64Array(L),
    new Float64Array(L),
    new Float64Array(L),
    new Float64Array(L)
  ];
  for (let i = 0; i < L; i++) {
    for (let b = 0; b < 4; b++) {
      LO[b][i] = Math.log2((ppm[b][i] + 0.01) / (BG[b] + 0.01));
    }
  }
  return LO;
}

export function toKernelFromLO(lo: number[][]) {
  const L = lo[0].length;
  const K = [
    new Float64Array(PAD),
    new Float64Array(PAD),
    new Float64Array(PAD),
    new Float64Array(PAD)
  ];
  const start = Math.round((PAD - L) / 2);
  for (let i = 0; i < L; i++) for (let b = 0; b < 4; b++) K[b][start + i] = lo[b][i];
  return { K, L, start };
}

export function kernelNorm(K: number[][]) {
  let s = 0;
  for (let b = 0; b < 4; b++) {
    const v = K[b];
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  }
  return Math.sqrt(s) || 1e-12;
}

export function queryToPPMFromString(str: string) {
  const L = str.length;
  const M = [
    new Float64Array(L),
    new Float64Array(L),
    new Float64Array(L),
    new Float64Array(L)
  ];
  for (let i = 0; i < L; i++) {
    const ch = str[i].toUpperCase();
    const set = IUPAC[ch] || ["A", "C", "G", "T"];
    const w = 1 / set.length;
    for (const b of set) {
      const idx = BASE_IDX[b];
      if (idx !== undefined) M[idx][i] += w;
    }
  }
  return M;
}

export function prepareTomTomDB(input: { name?: string; motifs: any[] }) {
  const motifs: any[] = [];
  for (const entry of input.motifs) {
    const id = entry.id || entry.name || `motif_${motifs.length}`;
    const ppm = toPPM(entry);
    const lo = toLogOdds(ppm);
    const cons = consensusFromPPM(ppm);
    const consRC = reverseComplementString(cons);
    const { K, L, start } = toKernelFromLO(lo);
    const norm = kernelNorm(K);
    const logoCols = buildLogoCols(lo);
    const logoColsRC = reverseLogoCols(logoCols);
    const tomFlat = flattenPpmColumns(ppm);
    const tomNorm = columnNormsFromFlat(tomFlat);
    const tomFlatRC = reverseComplementFlat(tomFlat, L);
    motifs.push({ id, ppm, lo, kernel: K, norm, L, start, cons, consRC, logoCols, logoColsRC, tomFlat, tomNorm, tomFlatRC });
  }
  return { name: input.name || "unnamed", motifs, tomtom: buildTomTomCaches(motifs) };
}

export function buildQueryFromString(text: string) {
  const ppmQ = queryToPPMFromString(text.trim());
  const loQ = toLogOdds(ppmQ);
  const { K: Kq, L: Lq, start: startQ } = toKernelFromLO(loQ);
  const normQ = kernelNorm(Kq);
  return { ppm: ppmQ, lo: loQ, K: Kq, norm: normQ, L: Lq, start: startQ, seq: text.trim() };
}

