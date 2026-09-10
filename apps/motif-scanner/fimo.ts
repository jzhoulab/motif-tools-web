// @ts-nocheck
import { BASE_IDX, BG, CHAR_TO_CODE, IUPAC } from './constants';
import { MotifInputData } from './types';

export interface WorkerMotif {
  id: string;
  flat: Float64Array;
  flatRC: Float64Array;
  maxScore: number;
  minScore: number;
  logoCols: number[][];
  L: number;
  trimLeft: number;
  trimRight: number;
  consensus: string;
  pValueMap: ReturnType<typeof computePValueMapping>;
}

export interface WorkerDB {
  name: string;
  motifs: WorkerMotif[];
  tomtom?: unknown;
}

export interface FimoHit {
  motifId: string;
  start: number;
  end: number;
  score: number;
  rawScore: number;
  pvalue: number;
  strand: '+' | '-';
  sequence: string;
}

export function logaddexp2(x: number, y: number): number {
  if (x === -Infinity) return y;
  if (y === -Infinity) return x;
  const vmax = x > y ? x : y;
  const vmin = x < y ? x : y;
  return vmax + Math.log2(Math.pow(2, vmin - vmax) + 1);
}

export function computePValueMapping(flat: Float64Array, L: number, binSize = 0.1) {
  const LOG_BG = [Math.log2(BG[0]), Math.log2(BG[1]), Math.log2(BG[2]), Math.log2(BG[3])];
  const intScores = new Int32Array(L * 4);

  let currMin = 0;
  let currMax = 0;
  let currPdf = new Float64Array(1);
  currPdf[0] = 0.0;

  for (let i = 0; i < L; i++) {
    let cMin = Infinity;
    let cMax = -Infinity;
    for (let b = 0; b < 4; b++) {
      const val = flat[i * 5 + b];
      const ival = Math.round(val / binSize);
      intScores[i * 4 + b] = ival;
      if (ival < cMin) cMin = ival;
      if (ival > cMax) cMax = ival;
    }

    const nextMin = currMin + cMin;
    const nextMax = currMax + cMax;
    const nextSize = nextMax - nextMin + 1;
    const nextPdf = new Float64Array(nextSize).fill(-Infinity);

    for (let j = 0; j < currPdf.length; j++) {
      const logP = currPdf[j];
      if (logP === -Infinity) continue;
      const currentScore = currMin + j;
      for (let b = 0; b < 4; b++) {
        const transitionScore = intScores[i * 4 + b];
        const nextScore = currentScore + transitionScore;
        const nextIdx = nextScore - nextMin;
        const bgLog = LOG_BG[b];
        nextPdf[nextIdx] = logaddexp2(nextPdf[nextIdx], logP + bgLog);
      }
    }

    currPdf = nextPdf;
    currMin = nextMin;
    currMax = nextMax;
  }

  const pvalues = new Float64Array(currPdf.length);
  let runningLogSum = -Infinity;
  for (let i = currPdf.length - 1; i >= 0; i--) {
    runningLogSum = logaddexp2(runningLogSum, currPdf[i]);
    pvalues[i] = runningLogSum;
  }

  return { offset: currMin, pvalues, binSize };
}

export function getPValue(score: number, mapping: ReturnType<typeof computePValueMapping> | null) {
  if (!mapping) return 1.0;
  const { offset, pvalues, binSize } = mapping;
  const qScore = Math.round(score / binSize);
  const idx = qScore - offset;
  if (idx >= pvalues.length) return Math.pow(2, pvalues[pvalues.length - 1]);
  if (idx < 0) return 1.0;
  return Math.pow(2, pvalues[idx]);
}

export function toPPM(entry: any): number[][] {
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

function computeTrimOffsets(ppm: number[][], L: number) {
  const IC_THRESHOLD = 0.35;
  const bitCols = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    let ic = 0;
    for (let b = 0; b < 4; b++) {
      const p = ppm[b][i];
      if (p > 0) {
        ic += p * Math.log2(p / BG[b]);
      }
    }
    bitCols[i] = ic;
  }
  let trimLeft = 0;
  while (trimLeft < L && bitCols[trimLeft] < IC_THRESHOLD) trimLeft++;
  let trimRight = 0;
  while (trimRight < L && bitCols[L - 1 - trimRight] < IC_THRESHOLD) trimRight++;
  if (trimLeft + trimRight >= L) {
    let maxIC = -1;
    let maxIdx = 0;
    for (let i = 0; i < L; i++) {
      if (bitCols[i] > maxIC) { maxIC = bitCols[i]; maxIdx = i; }
    }
    trimLeft = maxIdx;
    trimRight = L - 1 - maxIdx;
  }
  return { trimLeft, trimRight };
}

export function toPSSM(ppm: number[][]) {
  const L = ppm[0].length;
  const pseudocount = 0.01;
  const flat = new Float64Array(L * 5);
  const flatRC = new Float64Array(L * 5);
  let minScore = 0;
  let maxScore = 0;
  const logoCols: number[][] = [];

  for (let i = 0; i < L; i++) {
    let colMin = Infinity;
    let colMax = -Infinity;
    const scores: number[] = [];
    for (let b = 0; b < 4; b++) {
      const p = ppm[b][i];
      const val = Math.log2((p + pseudocount) / (BG[b] + pseudocount));
      scores[b] = val;
      if (val < colMin) colMin = val;
      if (val > colMax) colMax = val;
    }
    const offset = i * 5;
    flat[offset + 0] = scores[0];
    flat[offset + 1] = scores[1];
    flat[offset + 2] = scores[2];
    flat[offset + 3] = scores[3];
    flat[offset + 4] = colMin;
    minScore += colMin;
    maxScore += colMax;
    logoCols.push(scores);
  }

  for (let i = 0; i < L; i++) {
    const srcIdx = L - 1 - i;
    const offset = i * 5;
    const srcOffset = srcIdx * 5;
    flatRC[offset + 0] = flat[srcOffset + 3];
    flatRC[offset + 1] = flat[srcOffset + 2];
    flatRC[offset + 2] = flat[srcOffset + 1];
    flatRC[offset + 3] = flat[srcOffset + 0];
    flatRC[offset + 4] = flat[srcOffset + 4];
  }

  const pValueMap = computePValueMapping(flat, L);
  const { trimLeft, trimRight } = computeTrimOffsets(ppm, L);
  return { flat, flatRC, maxScore, minScore, logoCols, L, pValueMap, trimLeft, trimRight };
}

export function prepareDatabase(input: MotifInputData): WorkerDB {
  const motifs: WorkerMotif[] = [];
  for (const entry of input.motifs) {
    const id = entry.id || entry.name || `motif_${motifs.length}`;
    const ppm = toPPM(entry);
    const pssm = toPSSM(ppm);
    const cons = entry.consensus || id;
    motifs.push({
      id,
      consensus: cons,
      ...pssm
    });
  }
  return { name: input.name || "unnamed", motifs };
}

export function scanSequence(text: string, rc: boolean, threshold: number, DB: WorkerDB): FimoHit[] {
  if (!text || !DB.motifs.length) return [];
  const len = text.length;
  const seqCodes = new Int8Array(len);
  for (let i = 0; i < len; i++) {
    seqCodes[i] = CHAR_TO_CODE[text.charCodeAt(i)];
  }

  const hits: FimoHit[] = [];
  const MAX_HITS = 20000;

  for (const m of DB.motifs) {
    const { flat, flatRC, maxScore, minScore, L, id, pValueMap, trimLeft, trimRight } = m;
    const end = len - L + 1;
    const range = maxScore - minScore;
    const scale = range > 1e-9 ? (1 / range) : 0;

    for (let i = 0; i < end; i++) {
      let score = 0;
      for (let j = 0; j < L; j++) {
        score += flat[j * 5 + seqCodes[i + j]];
      }
      if (score >= threshold) {
        hits.push({
          motifId: id,
          start: i + trimLeft,
          end: (i + L) - trimRight,
          score: (score - minScore) * scale,
          rawScore: score,
          pvalue: getPValue(score, pValueMap),
          strand: '+',
          sequence: text.substring(i + trimLeft, (i + L) - trimRight)
        });
      }
    }

    if (rc) {
      for (let i = 0; i < end; i++) {
        let score = 0;
        for (let j = 0; j < L; j++) {
          score += flatRC[j * 5 + seqCodes[i + j]];
        }
        if (score >= threshold) {
          hits.push({
            motifId: id,
            start: i + trimRight,
            end: (i + L) - trimLeft,
            score: (score - minScore) * scale,
            rawScore: score,
            pvalue: getPValue(score, pValueMap),
            strand: '-',
            sequence: text.substring(i + trimRight, (i + L) - trimLeft)
          });
        }
      }
    }
    if (hits.length > MAX_HITS) break;
  }
  hits.sort((a, b) => b.rawScore - a.rawScore);
  if (hits.length > MAX_HITS) hits.length = MAX_HITS;
  return hits;
}

export function pwmToMapping(logPwm: number[][], binSize: number) {
  const n = logPwm.length;
  const L = logPwm[0].length;
  const intLogPwm = logPwm.map(row => row.map(v => Math.round(v / binSize)));

  let smallest = 9999999;
  let largest = -9999999;
  let log_pwm_min_csum = 0;
  let log_pwm_max_csum = 0;

  for (let i = 0; i < L; i++) {
    let log_pwm_min = 9999999;
    let log_pwm_max = -9999999;
    for (let j = 0; j < n; j++) {
      const val = intLogPwm[j][i];
      if (val < log_pwm_min) log_pwm_min = val;
      if (val > log_pwm_max) log_pwm_max = val;
    }
    log_pwm_min_csum += log_pwm_min;
    log_pwm_max_csum += log_pwm_max;
    if (log_pwm_min_csum < smallest) smallest = log_pwm_min_csum;
    if (log_pwm_max_csum > largest) largest = log_pwm_max_csum;
  }
  largest += L;

  const size = largest - smallest + 1;
  const logBg = Math.log2(0.25);
  const logpdf = new Float64Array(size).fill(-Infinity);
  const old = new Float64Array(size).fill(-Infinity);

  for (let i = 0; i < n; i++) {
    const idx = intLogPwm[i][0] - smallest;
    old[idx] = logaddexp2(old[idx], logBg);
  }

  for (let i = 1; i < L; i++) {
    logpdf.fill(-Infinity);
    for (let j = 0; j < size; j++) {
      const x = old[j];
      if (x === -Infinity) continue;
      for (let k = 0; k < n; k++) {
        const idx = j + intLogPwm[k][i];
        if (idx < 0 || idx >= size) continue;
        logpdf[idx] = logaddexp2(logpdf[idx], logBg + x);
      }
    }
    old.set(logpdf);
  }

  for (let i = size - 2; i >= 0; i--) {
    old[i] = logaddexp2(old[i], old[i + 1]);
  }

  return { smallest, mapping: old };
}

