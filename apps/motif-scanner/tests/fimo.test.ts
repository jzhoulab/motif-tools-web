import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseMeme } from '../services/memeParser';
import { prepareDatabase, pwmToMapping, scanSequence } from '../fimo';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createLCG(seed = 1) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = state * 16807 % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function makeLogPWM(rows: number, cols: number, seed = 1): number[][] {
  const rand = createLCG(seed);
  const pwm: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(rand() + 0.1 * (r + 1) + 0.05 * c);
    }
    pwm.push(row);
  }
  // Normalize columns and convert to log2
  const logPwm: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (let r = 0; r < rows; r++) sum += pwm[r][c];
    for (let r = 0; r < rows; r++) {
      logPwm[r][c] = Math.log2(pwm[r][c] / sum);
    }
  }
  return logPwm;
}

function parseFasta(text: string) {
  const records: Record<string, string> = {};
  let current: string | null = null;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('>')) {
      current = line.slice(1).trim();
      records[current] = '';
    } else if (current) {
      records[current] += line.trim();
    }
  }
  return records;
}

describe('pwmToMapping', () => {
  it('produces monotonic log p-values', () => {
    const logPwm = makeLogPWM(4, 6, 42);
    const { mapping } = pwmToMapping(logPwm, 0.1);
    const finite = Array.from(mapping).filter((v) => Number.isFinite(v));
    for (let i = 1; i < finite.length; i++) {
      expect(finite[i]).toBeLessThanOrEqual(finite[i - 1]);
    }
    expect(mapping.length).toBeGreaterThan(0);
  });

  it('responds to different bin sizes', () => {
    const logPwm = makeLogPWM(4, 4, 99);
    const coarse = pwmToMapping(logPwm, 1);
    const fine = pwmToMapping(logPwm, 0.05);
    expect(coarse.mapping.length).toBeLessThan(fine.mapping.length);
    expect(coarse.smallest).toBeGreaterThanOrEqual(fine.smallest);
  });
});

describe('FIMO scan (MEME fixtures)', () => {
  let sequence: string;
  let db: ReturnType<typeof prepareDatabase>;
  let fastaRecords: Record<string, string>;

  beforeAll(() => {
    const memePath = resolve(__dirname, 'data/test.meme');
    const fastaPath = resolve(__dirname, 'data/test.fa');
    const memeText = readFileSync(memePath, 'utf8');
    const fastaText = readFileSync(fastaPath, 'utf8');
    fastaRecords = parseFasta(fastaText);
    sequence = fastaRecords['chr7'];
    db = prepareDatabase(parseMeme(memeText));
  });

  it('finds hits on default threshold', () => {
    const hits = scanSequence(sequence, true, 4, db);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sequence.length).toBeGreaterThan(0);
  });

  it('reverse complement doubles search space', () => {
    const forward = scanSequence(sequence, false, 4, db);
    const both = scanSequence(sequence, true, 4, db);
    expect(both.length).toBeGreaterThanOrEqual(forward.length);
  });

  it('threshold trims weaker hits', () => {
    const permissive = scanSequence(sequence, true, 4, db);
    const strict = scanSequence(sequence, true, 10, db);
    expect(strict.length).toBeLessThanOrEqual(permissive.length);
  });

  it('reproduces canonical MEOX1/FOXQ1 hits', () => {
    const hitsByMotif = new Map<string, Array<any>>();
    for (const [seqName, seq] of Object.entries(fastaRecords)) {
      const hits = scanSequence(seq, true, 4, db);
      hits.forEach(hit => {
        const list = hitsByMotif.get(hit.motifId) || [];
        list.push({ ...hit, sequenceName: seqName });
        hitsByMotif.set(hit.motifId, list);
      });
    }

    const meoxHits = hitsByMotif.get('MEOX1_homeodomain_1') || [];
    const chr7Hit = meoxHits.find((h) => h.sequenceName === 'chr7');
    expect(chr7Hit).toBeDefined();
    expect(chr7Hit.start).toBeGreaterThanOrEqual(1349);
    expect(chr7Hit.start).toBeLessThanOrEqual(1351);
    expect(chr7Hit.end).toBeGreaterThanOrEqual(1357);
    expect(chr7Hit.end).toBeLessThanOrEqual(1361);
    expect(chr7Hit.strand).toBe('+');
    expect(Math.abs(chr7Hit.pvalue - 7.534027e-5) / 7.534027e-5).toBeLessThan(0.5);

    const foxHits = hitsByMotif.get('FOXQ1_MOUSE.H11MO.0.C') || [];
    const chr5Hit = foxHits.find((h) => h.sequenceName === 'chr5');
    expect(chr5Hit).toBeDefined();
    expect(chr5Hit.start).toBeGreaterThanOrEqual(120);
    expect(chr5Hit.start).toBeLessThanOrEqual(122);
    expect(chr5Hit.end).toBeGreaterThanOrEqual(132);
    expect(chr5Hit.end).toBeLessThanOrEqual(134);
    expect(chr5Hit.strand).toBe('+');
    expect(Math.abs(chr5Hit.pvalue - 9.9e-5) / 9.9e-5).toBeLessThan(2);
  });
});

