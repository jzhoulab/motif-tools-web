#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMeme } from '../src/memeParser';
import { prepareTomTomDB, queryToPPMFromString, toLogOdds, toKernelFromLO, kernelNorm } from '../src/tomtomPrep';
import { runTomTomSearch } from '../src/tomtom';

interface Options {
  db: string;
  query: string;
  rc: boolean;
  maxPValue: number;
  top: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    db: '',
    query: '',
    rc: true,
    maxPValue: 1e-3,
    top: 10,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--db':
        opts.db = argv[++i] ?? '';
        break;
      case '--query':
        opts.query = argv[++i] ?? '';
        break;
      case '--no-rc':
        opts.rc = false;
        break;
      case '--max-pvalue':
        opts.maxPValue = parseFloat(argv[++i] ?? '0.001');
        break;
      case '--top':
        opts.top = parseInt(argv[++i] ?? '10', 10);
        break;
      default:
        break;
    }
  }
  return opts;
}

function usage(): never {
  console.error('Usage: npm run tomtom -- --db path/to/file.meme --query ATGC [--max-pvalue 0.001] [--top 10] [--no-rc]');
  process.exit(1);
}

function buildQuery(sequence: string) {
  const seq = sequence.toUpperCase();
  const ppm = queryToPPMFromString(seq);
  const lo = toLogOdds(ppm);
  const { K, L, start } = toKernelFromLO(lo);
  const norm = kernelNorm(K);
  return { ppm, lo, K, norm, L, start, seq };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db || !args.query) usage();

  const dbPath = resolve(process.cwd(), args.db);
  const memeText = readFileSync(dbPath, 'utf8');
  const parsed = parseMeme(memeText);
  const db = prepareTomTomDB(parsed);
  const query = buildQuery(args.query);

  const hits = runTomTomSearch(query, args.rc, db)
    .filter((hit) => hit.tomtom && hit.tomtom.pvalue <= args.maxPValue)
    .slice(0, args.top);

  if (!hits.length) {
    console.log('No matches found.');
    return;
  }

  for (const hit of hits) {
    const info = {
      motif: hit.id,
      pvalue: hit.tomtom?.pvalue,
      offset: hit.tomtom?.offset,
      overlap: hit.tomtom?.overlap,
      orientation: hit.tomtom?.ori,
      preview: hit.tomtom?.preview,
    };
    console.log(JSON.stringify(info, null, 2));
  }
}

main();
