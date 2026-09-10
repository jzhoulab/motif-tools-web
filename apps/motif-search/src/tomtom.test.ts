import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { binnedMedian, pairwiseMaxArrays, mergeRcResultsTomTom, reverseComplementString, runTomTomSearch } from './tomtom';
import { prepareTomTomDB, buildQueryFromString } from './tomtomPrep';
import { parseMeme } from './memeParser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function makeGamma(values: number[]): Float64Array {
  return Float64Array.from(values);
}

describe('tomtom helpers (parity with memesuite-lite tests)', () => {
  it('binned median odd short', () => {
    const x = [0, 4, 2, 1, 3];
    const bins = new Float64Array(x.length);
    const binSum = new Float64Array(x.length);
    const counts = new Float64Array(x.length).fill(1);
    const gamma = makeGamma(x);
    const median = binnedMedian(gamma, 0, x.length, bins, binSum, 0, 4, counts, 1);
    expect(median).toBe(2);
  });

  it('binned median even w/weights', () => {
    const x = [0, 1, 2, 3];
    const bins = new Float64Array(x.length);
    const binSum = new Float64Array(x.length);
    const counts = new Float64Array(x.length).fill(1);
    counts[2] = 2;
    const gamma = makeGamma(x);
    const median = binnedMedian(gamma, 0, x.length, bins, binSum, 0, 3, counts, 1);
    expect(median).toBe(2);
  });

  it('pairwise max matches analytical form', () => {
    const rng = seed => {
      let x = seed;
      return () => (x = (x * 9301 + 49297) % 233280) / 233280;
    };
    const rand = rng(1);
    const makeVec = () => {
      const arr = Array.from({ length: 100 }, () => Math.abs(rand()));
      const sum = arr.reduce((a, b) => a + b, 0);
      return arr.map(v => v / sum);
    };
    const x = Float64Array.from(makeVec());
    const y = Float64Array.from(makeVec());
    const yCsum = new Float64Array(100);
    let acc = 0;
    for (let i = 0; i < y.length; i++) {
      acc += y[i];
      yCsum[i] = acc;
    }
    const out = new Float64Array(100);
    const xCsum = new Float64Array(100);
    let xAcc = 0;
    for (let i = 0; i < x.length; i++) {
      xAcc += x[i];
      xCsum[i] = xAcc;
    }
    pairwiseMaxArrays(x, y, yCsum, out, 100);
    const expectVec = Array.from(x, (xi, i) => xi * yCsum[i] + y[i] * xCsum[i] - xi * y[i]);
    expect(Array.from(out)).toStrictEqual(expectVec);
  });

  it('merge RC results keeps best strand', () => {
    const rows = 1000;
    const cols = 5;
    const results = new Float64Array(rows * cols);
    for (let i = 0; i < rows * cols; i++) {
      results[i] = Math.random();
    }
    const motifCount = rows / 2;
    const before = results.slice();
    mergeRcResultsTomTom(results, motifCount);

    for (let i = 0; i < motifCount; i++) {
      const base = i * cols;
      const rc = base + motifCount * cols;
      const p = Math.min(before[base], before[rc]);
      const expectedP = 1 - Math.pow(1 - p, 2);
      expect(results[base]).toBeCloseTo(expectedP, 10);
    }
  });
});

describe('TomTom MEME fixtures', () => {
  let db: any;

  beforeAll(() => {
    const memePath = resolve(__dirname, '../tests/data/test.meme');
    const memeText = readFileSync(memePath, 'utf8');
    db = prepareTomTomDB(parseMeme(memeText));
  });

  it('finds the self match with near-zero p-value', () => {
    const motif = db.motifs.find((m: any) => m.id === 'MEOX1_homeodomain_1');
    const query = { ppm: motif.ppm, lo: motif.lo, K: motif.kernel, norm: motif.norm, L: motif.L, start: motif.start, seq: motif.cons };
    const results = runTomTomSearch(query, true, db);
    const top = results[0];
    expect(top.id).toBe('MEOX1_homeodomain_1');
    expect(top.tomtom.pvalue).toBeLessThan(1e-12);
    expect(top.tomtom.offset).toBe(0);
  });

  it('detects reverse-complement orientation from consensus inputs', () => {
    const motif = db.motifs.find((m: any) => m.id === 'FOXQ1_MOUSE.H11MO.0.C');
    const rcConsensus = reverseComplementString(motif.cons);
    const query = buildQueryFromString(rcConsensus);
    const results = runTomTomSearch(query, true, db);
    const hit = results.find((r: any) => r.id === 'FOXQ1_MOUSE.H11MO.0.C');
    expect(hit).toBeDefined();
    expect(hit.tomtom.ori).toBe('-');
  });
});
