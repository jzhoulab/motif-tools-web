// @ts-nocheck
import {
  buildLogoCols,
  reverseLogoCols,
  reverseComplementString,
  flattenPpmColumns,
  columnNormsFromFlat,
  reverseComplementFlat
} from './tomtom';

const PAD = 51;
const EPS = 0.01;
const BG = [0.295, 0.205, 0.205, 0.295];
const LOG2 = Math.log(2);
const BASE_IDX: Record<string, number> = { A: 0, C: 1, G: 2, T: 3, a: 0, c: 1, g: 2, t: 3 };
const IUPAC: Record<string, string[]> = {
  A: ["A"], C: ["C"], G: ["G"], T: ["T"], U: ["T"],
  R: ["A", "G"], Y: ["C", "T"], S: ["G", "C"], W: ["A", "T"],
  K: ["G", "T"], M: ["A", "C"], B: ["C", "G", "T"], D: ["A", "G", "T"],
  H: ["A", "C", "T"], V: ["A", "C", "G"], N: ["A", "C", "G", "T"]
};

function nextPow2(n: number) { let p = 1; while (p < n) p <<= 1; return p; }

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const u_r = re[i + j], u_i = im[i + j];
        const v_r = re[i + j + len / 2] * wr - im[i + j + len / 2] * wi;
        const v_i = re[i + j + len / 2] * wi + im[i + j + len / 2] * wr;
        re[i + j] = u_r + v_r; im[i + j] = u_i + v_i;
        re[i + j + len / 2] = u_r - v_r; im[i + j + len / 2] = u_i - v_i;
        const nwr = wr * c - wi * s;
        const nwi = wr * s + wi * c;
        wr = nwr; wi = nwi;
      }
    }
  }
}

function ifft(re: Float64Array, im: Float64Array) {
  for (let i = 0; i < re.length; i++) im[i] = -im[i];
  fft(re, im);
  const inv = 1 / re.length;
  for (let i = 0; i < re.length; i++) { re[i] *= inv; im[i] *= inv; }
}

function reverseVec(v: Float64Array) {
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[v.length - 1 - i] = v[i];
  return out;
}

function convolveReal(a: Float64Array, b: Float64Array) {
  const n = nextPow2(a.length + b.length - 1);
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(a); br.set(b);
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const im = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r; ai[i] = im;
  }
  ifft(ar, ai);
  return ar.subarray(0, a.length + b.length - 1);
}

function toPPM(entry: any) {
  if (entry.pwm) {
    let pwm = entry.pwm;
    if (pwm.length !== 4 && pwm[0]?.length === 4) {
      const L = pwm.length;
      const out = [new Float64Array(L), new Float64Array(L), new Float64Array(L), new Float64Array(L)];
      for (let i = 0; i < L; i++) {
        out[0][i] = pwm[i][0]; out[1][i] = pwm[i][1]; out[2][i] = pwm[i][2]; out[3][i] = pwm[i][3];
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
    const M = [new Float64Array(L), new Float64Array(L), new Float64Array(L), new Float64Array(L)];
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
  throw new Error("motif needs pwm or consensus");
}

function toLogOdds(ppm: number[][]) {
  const L = ppm[0].length;
  const LO = [new Float64Array(L), new Float64Array(L), new Float64Array(L), new Float64Array(L)];
  for (let i = 0; i < L; i++) {
    for (let b = 0; b < 4; b++) {
      LO[b][i] = Math.log((ppm[b][i] + EPS) / (BG[b] + EPS)) / LOG2;
    }
  }
  return LO;
}

function toKernelFromLO(lo: number[][]) {
  const L = lo[0].length;
  const K = [new Float64Array(PAD), new Float64Array(PAD), new Float64Array(PAD), new Float64Array(PAD)];
  const start = Math.round((PAD - L) / 2);
  for (let i = 0; i < L; i++) for (let b = 0; b < 4; b++) K[b][start + i] = lo[b][i];
  return { K, L, start };
}

function kernelNorm(K: number[][]) {
  let s = 0;
  for (let b = 0; b < 4; b++) {
    const v = K[b];
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  }
  return Math.sqrt(s) || 1e-12;
}

export function buildQueryFromString(str: string) {
  const ppm = queryToPPMFromString(str.trim());
  const lo = toLogOdds(ppm);
  const { K, L, start } = toKernelFromLO(lo);
  return { ppm, lo, K, norm: kernelNorm(K), L, start, seq: str.trim() };
}

function queryToPPMFromString(str: string) {
  const L = str.length;
  const M = [new Float64Array(L), new Float64Array(L), new Float64Array(L), new Float64Array(L)];
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

function xcorrKernel4(qK: number[][], mK: number[][]) {
  const L = qK[0].length + mK[0].length - 1;
  const total = new Float64Array(L);
  for (let b = 0; b < 4; b++) {
    const conv = convolveReal(reverseVec(qK[b]), mK[b]);
    for (let i = 0; i < L; i++) total[i] += conv[i];
  }
  return total;
}

function consensusFromPPM(ppm: number[][]) {
  const L = ppm[0].length; const map = ["A", "C", "G", "T"]; let s = "";
  for (let i = 0; i < L; i++) {
    let b = 0, v = ppm[0][i];
    for (let k = 1; k < 4; k++) if (ppm[k][i] > v) { v = ppm[k][i]; b = k; }
    s += map[b];
  }
  return s;
}

function bestLLR(queryPPM: number[][], motifLO: number[][]) {
  const Lq = queryPPM[0].length, Lm = motifLO[0].length;
  let bestMean = -Infinity, bestSum = -Infinity, bestShift = 0, bestOv = 0, bestMStart = 0;
  for (let s = -(Lq - 1); s <= Lm - 1; s++) {
    const qStart = Math.max(0, -s);
    const mStart = Math.max(0, s);
    const ov = Math.min(Lq - qStart, Lm - mStart);
    if (ov <= 0) continue;
    let sum = 0;
    for (let k = 0; k < ov; k++) {
      for (let b = 0; b < 4; b++) sum += queryPPM[b][qStart + k] * motifLO[b][mStart + k];
    }
    const mean = sum / ov;
    if (sum > bestSum) { bestSum = sum; bestMean = mean; bestShift = s; bestOv = ov; bestMStart = mStart; }
  }
  return { mean: bestMean, sum: bestSum, shift: bestShift, overlap: bestOv, mStart: bestMStart };
}

export function prepareNccDatabase(input: { name?: string; motifs: any[] }) {
  const motifs = [];
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
  return { name: input.name || 'unnamed', motifs };
}

export function runNccSearch(Q: any, Qrc: any, rcEnabled: boolean, threshold: number, DB: any) {
  const results: any[] = [];
  for (const m of DB.motifs) {
    let num = xcorrKernel4(Q.K, m.kernel);
    let best = -Infinity, idx = -1;
    for (let i = 0; i < num.length; i++) {
      const s = num[i] / (Q.norm * m.norm);
      if (s > best) { best = s; idx = i; }
    }
    let ncc = { score: best, idx, ori: "+", offset: 0, overlap: 0, preview: "", mStart: 0 };
    const sPad = ncc.idx - (PAD - 1);
    const qStartInPad = Q.start + sPad;
    const ovStart = Math.max(qStartInPad, m.start);
    const ovEnd = Math.min(qStartInPad + Q.L, m.start + m.L);
    const ov = Math.max(0, ovEnd - ovStart);
    ncc.overlap = ov;
    ncc.mStart = Math.max(0, ovStart - m.start);
    ncc.offset = (ov > 0 ? (ovStart - m.start) - (ovStart - qStartInPad) : 0);
    const cons = m.cons, qSeq = Q.seq;
    let top = "", mid = "", bot = "";
    if (ov > 0) {
      const qStart = ovStart - qStartInPad;
      const mStart = ovStart - m.start;
      for (let i = 0; i < ov; i++) {
        const qc = qSeq[qStart + i] || " ";
        const mc = cons[mStart + i] || " ";
        top += qc; bot += mc; mid += (qc === mc ? "|" : " ");
      }
    }
    ncc.preview = top + "\n" + mid + "\n" + bot;

    if (rcEnabled && Qrc) {
      num = xcorrKernel4(Qrc.K, m.kernel);
      best = -Infinity; idx = -1;
      for (let i = 0; i < num.length; i++) {
        const s = num[i] / (Qrc.norm * m.norm);
        if (s > best) { best = s; idx = i; }
      }
      const sPadRC = idx - (PAD - 1);
      const qStartInPadRC = Qrc.start + sPadRC;
      const ovStartRC = Math.max(qStartInPadRC, m.start);
      const ovEndRC = Math.min(qStartInPadRC + Qrc.L, m.start + m.L);
      const ovRC = Math.max(0, ovEndRC - ovStartRC);
      if (best > ncc.score) {
        const qStart = ovStartRC - qStartInPadRC;
        const mStart = ovStartRC - m.start;
        let topRC = "", midRC = "", botRC = "";
        for (let i = 0; i < ovRC; i++) {
          const qc = Qrc.seq[qStart + i] || " ";
          const mc = m.cons[mStart + i] || " ";
          topRC += qc; botRC += mc; midRC += (qc === mc ? "|" : " ");
        }
        ncc = {
          score: best,
          idx,
          ori: "-",
          offset: (ovRC > 0 ? (ovStartRC - m.start) - (ovStartRC - qStartInPadRC) : 0),
          overlap: ovRC,
          preview: topRC + "\n" + midRC + "\n" + botRC,
          mStart: Math.max(0, ovStartRC - m.start)
        };
      }
    }

    const llrForward = bestLLR(Q.ppm, m.lo);
    let llr = llrForward;
    let llrOri = "+";
    if (rcEnabled && Qrc) {
      const llrRC = bestLLR(Qrc.ppm, m.lo);
      if (llrRC.sum > llrForward.sum) {
        llr = llrRC;
        llrOri = "-";
      }
    }
    let llrPreview = "";
    {
      const cons = m.cons, qSeq = (llrOri === "+") ? Q.seq : (Qrc?.seq || Q.seq);
      const qStart = Math.max(0, -llr.shift);
      const mStart = Math.max(0, llr.shift);
      let top = "", mid = "", bot = "";
      for (let k = 0; k < llr.overlap; k++) {
        const qc = qSeq[qStart + k] || " "; const mc = cons[mStart + k] || " ";
        top += qc; bot += mc; mid += (qc === mc ? "|" : " ");
      }
      llrPreview = top + "\n" + mid + "\n" + bot;
    }

    if (ncc.score >= threshold) {
      results.push({
        id: m.id,
        len: m.L,
        logoCols: m.logoCols,
        ncc,
        llr: {
          mean: llr.mean,
          sum: llr.sum,
          shift: llr.shift,
          ori: llrOri,
          offset: llr.shift,
          overlap: llr.overlap,
          preview: llrPreview,
          mStart: llr.mStart
        }
      });
    }
  }
  return results;
}

