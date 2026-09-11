
import React, { useEffect, useRef, useState, useCallback } from 'react';
// @ts-ignore
import ScanWorker from './worker?worker&inline';
import { MotifInputData, MotifHit, MotifDefinition, WorkerResponse } from './types';
import SequenceHighlighter from './components/SequenceHighlighter';
import { parseMeme } from './services/memeParser';
import { prepareDatabase, scanSequence } from './fimo'; // fallback shim

import { parseSeqstr } from './services/seqstrParser';
import { fetchSegmentSequence } from './services/ucscFetcher';

// Import Resources
import vierstraJson from '../../resources/vierstra_clustered_motif_v2.json';
import jasparJson from '../../resources/JASPAR2024_CORE_vertebrates.json';
// MEME file needs to be imported as raw text or handled via fetch if not using a bundler loader for .meme
// Since we are in a Vite environment, we can use ?raw import for non-json files if configured, 
// or we can just assume standard import might fail without config. 
// However, for this environment, I will use a direct import and assume Vite handles it or I'll use a fetch if it fails.
// Let's try standard import first, but since it's a .meme file, it might need ?raw.
import h14Meme from '../../resources/H14CORE_meme_format.meme?raw';
import cisbpMeme from '../../resources/CISBP_Homo_sapiens.meme?raw';
import cisbpRnaMeme from '../../resources/CISBP-RNA_Homo_sapiens.meme?raw';

interface DbEntry { name: string; short: string; data: any; type: 'json' | 'meme'; alphabet: 'dna' | 'rna'; }

const DATABASES: Record<string, DbEntry> = {
  'jaspar': { name: 'JASPAR 2024 CORE Vertebrates', short: 'JASPAR 2024', data: jasparJson, type: 'json', alphabet: 'dna' },
  'h14': { name: 'HOCOMOCO H14 CORE', short: 'HOCOMOCO', data: h14Meme, type: 'meme', alphabet: 'dna' },
  'cisbp': { name: 'CIS-BP 2.0 Human', short: 'CIS-BP', data: cisbpMeme, type: 'meme', alphabet: 'dna' },
  'vierstra': { name: 'Vierstra Clustered Motifs', short: 'Vierstra', data: vierstraJson, type: 'json', alphabet: 'dna' },
  'cisbp-rna': { name: 'CIS-BP-RNA Human RBPs', short: 'CIS-BP-RNA', data: cisbpRnaMeme, type: 'meme', alphabet: 'rna' },
};
const DB_ORDER = ['jaspar', 'h14', 'cisbp', 'vierstra', 'cisbp-rna'];

// Merge one or more selected databases into a single payload. DNA databases can be
// combined; RNA is its own alphabet and never mixed with DNA (enforced by the UI).
function combineDbs(entries: DbEntry[]): MotifInputData & { alphabet: 'dna' | 'rna' } {
  let alphabet: 'dna' | 'rna' = 'dna';
  const motifs: any[] = [];
  const names: string[] = [];
  for (const db of entries) {
    let d: any = db.data;
    if (db.type === 'meme') d = parseMeme(db.data as string);
    const a = d.alphabet || db.alphabet || 'dna';
    if (a === 'rna') alphabet = 'rna';
    for (const m of d.motifs) motifs.push(m);
    names.push(db.name);
  }
  const name = entries.length === 1 ? names[0] : `${entries.length} databases`;
  return { name, motifs, alphabet };
}

function App() {
  // query is now the UI input state
  const [query, setQuery] = useState("TGTGCGGCGAAGCCGGTGAGTGAGCGGCGCGGGGCCAATCAGCGTGCGCCGTCCGAAAGTTGCCTTTTATGGCTCGAGCGGCCGCGGCGGCGCCCTATAAAACCCAGCGGC");
  // activeSequence is what the scanner actually scans
  const [activeSequence, setActiveSequence] = useState(query);

  const [hits, setHits] = useState<MotifHit[]>([]);
  const [motifDefs, setMotifDefs] = useState<Record<string, MotifDefinition>>({});
  const [dbName, setDbName] = useState("loading...");
  const [motifCount, setMotifCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [isFetchingSeq, setIsFetchingSeq] = useState(false);

  // Database Selection (multi-select; DNA sets combine, RNA is exclusive)
  const [selectedDbKeys, setSelectedDbKeys] = useState<string[]>(['jaspar']);
  const customDbRef = useRef<DbEntry | null>(null);
  const [hasCustom, setHasCustom] = useState(false);

  // Controls
  const [rc, setRc] = useState(true);
  const [alphabet, setAlphabet] = useState<'dna' | 'rna'>('dna');
  // Default threshold in Bits (5.0 is the worker hard floor)
  const [scoreThreshold, setScoreThreshold] = useState(6.0);
  // Default P-value threshold (1e-3)
  const [pValThresholdLog, setPValThresholdLog] = useState(3);
  // Relative Score Threshold (0.0 - 1.0)
  const [relScoreThreshold, setRelScoreThreshold] = useState(0.95);

  const queryRef = useRef(activeSequence);
  const rcRef = useRef(rc);
  const workerRef = useRef<Worker | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { queryRef.current = activeSequence; }, [activeSequence]);
  useEffect(() => { rcRef.current = rc; }, [rc]);

  const triggerQuery = useCallback((workerInstance: Worker | null = null) => {
    const w = workerInstance || workerRef.current;
    if (!w) return;

    const currentQuery = queryRef.current;
    const currentRc = rcRef.current;

    if (!currentQuery) {
      setHits([]);
      return;
    }

    setIsComputing(true);

    // Send request with a LOW hardcoded threshold to get most hits, 
    // filtering happens on client side for UI responsiveness.
    w.postMessage({
      type: "query",
      payload: { text: currentQuery, rc: currentRc, threshold: 4.0 }
    });
  }, []);

  const entriesFor = useCallback((keys: string[]): DbEntry[] => {
    return keys.map(k => k === 'custom' ? customDbRef.current : DATABASES[k]).filter(Boolean) as DbEntry[];
  }, []);

  const loadDbs = useCallback((keys: string[], w?: Worker | null) => {
    const worker = w || workerRef.current;
    if (!worker) return;
    const entries = entriesFor(keys);
    if (!entries.length) return;

    setIsComputing(true);
    setDbName('Loading...');
    try {
      const payload = combineDbs(entries);
      setAlphabet(payload.alphabet);
      setRc(payload.alphabet !== 'rna');
      worker.postMessage({ type: "load-db", payload });
    } catch (err: any) {
      setError(`Failed to load database: ${err.message}`);
      setIsComputing(false);
    }
  }, [entriesFor]);

  // Toggle a built-in database. DNA sets accumulate; RNA is exclusive; never empty.
  const toggleDb = useCallback((key: string) => {
    setSelectedDbKeys(prev => {
      const db = DATABASES[key];
      const base = prev.filter(k => k !== 'custom');
      if (db.alphabet === 'rna') return [key];               // RNA replaces everything
      const baseAlpha = base.length ? DATABASES[base[0]]?.alphabet : 'dna';
      if (baseAlpha === 'rna') return [key];                 // switching DNA<-RNA
      if (base.includes(key)) {
        const next = base.filter(k => k !== key);
        return next.length ? next : base;                    // keep at least one
      }
      return [...base, key];
    });
  }, []);

  // Load Database Effect (re-runs whenever the selection changes)
  useEffect(() => {
    if (!workerRef.current) return;
    loadDbs(selectedDbKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDbKeys.join('|'), loadDbs]);

  useEffect(() => {
    // Try real Worker; if blocked (file://), fallback to inline shim on main thread.
    let worker: Worker | { postMessage: Function; terminate: Function; onmessage: any } | null = null;

    const createWorkerShim = () => {
      let DB: any = { name: 'empty', motifs: [] };
      const shim: any = {
        onmessage: null,
        postMessage: (msg: any) => {
          const { type, payload } = msg;
          try {
            if (type === 'load-db') {
              DB = prepareDatabase(payload);
              const motifs = DB.motifs.map((m: any) => ({
                id: m.id,
                len: m.L,
                consensus: m.consensus,
                logoCols: m.logoCols,
                pssm: m.flat,
                pssmRC: m.flatRC,
                maxScore: m.maxScore,
                minScore: m.minScore,
                trimLeft: m.trimLeft,
                trimRight: m.trimRight,
              }));
              shim.onmessage?.({ data: { type: 'loaded', name: DB.name, count: DB.motifs.length, motifs } });
            } else if (type === 'query') {
              const { text, rc, threshold } = payload;
              const hits = scanSequence(text, rc, threshold, DB);
              shim.onmessage?.({ data: { type: 'results', hits } });
            }
          } catch (err: any) {
            shim.onmessage?.({ data: { type: 'error', message: String(err?.message || err) } });
          }
        },
        terminate: () => {},
      };
      return shim;
    };

    const createWorker = () => {
      try {
        return new ScanWorker();
      } catch (err) {
        console.warn('Worker unavailable, using main-thread fallback', err);
        return createWorkerShim();
      }
    };

    worker = createWorker();
    if (!worker) return;
    workerRef.current = worker as any;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { type, hits, motifs, message, name, count } = e.data;

      if (type === "loaded") {
        setDbName(name || "Unknown");
        setMotifCount(count || 0);
        if (motifs) {
          const map: Record<string, MotifDefinition> = {};
          motifs.forEach(m => map[m.id] = m);
          setMotifDefs(map);
        }
        setError(null);
        triggerQuery(worker);
      } else if (type === "results") {
        setHits(hits || []);
        // Only clear error if it wasn't a fetch error (fetch errors persist until fixed)
        if (!isFetchingSeq) setError(null);
        setIsComputing(false);
      } else if (type === "error") {
        setError(message || "Unknown worker error");
        setIsComputing(false);
      }
    };

    loadDbs(selectedDbKeys, worker as Worker);

    return () => {
      if (worker && 'terminate' in worker) worker.terminate();
    };
  }, [triggerQuery]);

  useEffect(() => {
    const t = setTimeout(() => {
      triggerQuery();
    }, 300);
    return () => clearTimeout(t);
  }, [activeSequence, rc, triggerQuery]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workerRef.current) return;

    setIsComputing(true);
    try {
      const text = await file.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        try {
          data = parseMeme(text);
        } catch (memeErr: any) {
          throw new Error(`Failed parse: ${jsonErr} | ${memeErr.message}`);
        }
      }
      if (data) {
        const alpha: 'dna' | 'rna' = (data.alphabet === 'rna') ? 'rna' : 'dna';
        customDbRef.current = { name: file.name, short: file.name, data, type: 'json', alphabet: alpha };
        setHasCustom(true);
        setSelectedDbKeys(['custom']); // upload becomes its own single selection
        e.target.value = '';
      }
    } catch (err: any) {
      setError(err.message);
      setIsComputing(false);
    }
  };

  const processSeqstr = async (input: string) => {
    setIsFetchingSeq(true);
    setError(null);
    try {
      const parsed = parseSeqstr(input);
      if (parsed.length === 0) {
        // Fallback to raw if parsing fails but regex matched? 
        // Or maybe just treat as raw.
        throw new Error("Invalid Seqstr format");
      }

      const sequences: string[] = [];
      for (const item of parsed) {
        let itemSeq = "";
        for (const seg of item.segments) {
          const segSeq = await fetchSegmentSequence(seg);
          itemSeq += segSeq;
        }
        sequences.push(itemSeq);
      }
      const fullSequence = sequences.join("NNNNN");
      setActiveSequence(fullSequence);
    } catch (err: any) {
      setError(`Seqstr Error: ${err.message}`);
      // Fallback: If it fails parsing, maybe it's just a weird raw sequence?
      // But if it looked like Seqstr, we should probably show the error.
    } finally {
      setIsFetchingSeq(false);
    }
  };

  const handleSequenceInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    setQuery(raw);

    // Debounce logic
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);

    // Heuristic: Is it Seqstr?
    // If it contains characters specific to Seqstr syntax ([, ], :, @, <, >) or digits (coordinates),
    // we treat it as potential Seqstr input rather than raw sequence.
    // Raw sequence should mostly be letters.
    const isSeqstr = /[\[\]:@<>;0-9]/.test(raw) || /chr\w*:/i.test(raw);

    if (isSeqstr) {
      fetchTimeoutRef.current = setTimeout(() => {
        processSeqstr(raw);
      }, 800); // 800ms debounce for network calls
    } else {
      // Treat as raw sequence
      const clean = raw.replace(/[^a-zA-Z]/g, '');
      setActiveSequence(clean);
      setError(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-primary-500/30 selection:text-white pb-20">
      {/* Shared Motif Tools top bar */}
      <div className="border-b border-slate-800 bg-slate-900/40 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <a href="https://motif.zhoulab.io/" className="flex items-center gap-2.5">
            <span className="flex gap-[3px]">
              <span className="w-[6px] h-[18px] rounded-sm" style={{ background: '#109648' }}></span>
              <span className="w-[6px] h-[18px] rounded-sm" style={{ background: '#255C99' }}></span>
              <span className="w-[6px] h-[18px] rounded-sm" style={{ background: '#F7B32B' }}></span>
              <span className="w-[6px] h-[18px] rounded-sm" style={{ background: '#D62828' }}></span>
            </span>
            <span className="font-semibold text-white tracking-tight">Motif Tools</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-300">Scanner</span>
          </a>
          <a href="https://motif.zhoulab.io/" className="text-sm text-slate-400 hover:text-white transition-colors">← All tools</a>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">

        <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-800 pb-6 gap-4">
          <div>
            <p className="text-slate-400 text-sm max-w-2xl">
              FIMO-style probabilistic scanning. Logos are trimmed to the high-information "core" of each motif; scores and p-values use the full matrix.
            </p>
            <div className="mt-3 flex items-center gap-3 text-xs text-slate-500 font-mono">
              <span className="px-2 py-1 bg-slate-900 rounded border border-slate-800 text-emerald-400">DB: {dbName}</span>
              <span className="px-2 py-1 bg-slate-900 rounded border border-slate-800 text-primary-400">{motifCount} Motifs</span>
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Databases (select one or more)</span>
            <div className="flex flex-wrap gap-2 md:justify-end">
              {DB_ORDER.map((key) => {
                const db = DATABASES[key];
                const active = selectedDbKeys.includes(key);
                const isRna = db.alphabet === 'rna';
                return (
                  <button
                    key={key}
                    onClick={() => toggleDb(key)}
                    title={db.name}
                    className={`flex items-center gap-2 text-sm rounded-lg border px-3 py-2 transition-colors ${active ? 'bg-primary-500/15 border-primary-500 text-primary-200' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'}`}
                  >
                    <span className={`w-2 h-2 rounded-sm ${isRna ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
                    {db.short}
                  </button>
                );
              })}
              {hasCustom && (
                <button
                  onClick={() => setSelectedDbKeys(['custom'])}
                  className={`flex items-center gap-2 text-sm rounded-lg border px-3 py-2 transition-colors ${selectedDbKeys.includes('custom') ? 'bg-primary-500/15 border-primary-500 text-primary-200' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'}`}
                  title={customDbRef.current?.name}
                >
                  <span className="w-2 h-2 rounded-sm bg-sky-400"></span>
                  Custom
                </button>
              )}
              <label className="cursor-pointer flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 px-3 py-2 rounded-lg transition-colors text-sm">
                <span>+ Upload</span>
                <input type="file" accept=".json,.txt,.meme" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        </div>

        <div className="grid gap-6 mb-8">
          <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-1 focus-within:border-primary-500/50 transition-colors relative">
            <div className="flex justify-between items-center px-4 py-2 border-b border-slate-800/50 bg-slate-900/30 rounded-t-lg">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Sequence / Seqstr Input
              </label>
              <div className="group relative">
                <span className="cursor-help text-xs text-primary-400 hover:text-primary-300 underline decoration-dotted">
                  Seqstr Format Help
                </span>
                <div className="absolute right-0 top-6 w-80 p-3 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-xs text-slate-300 z-50 hidden group-hover:block">
                  <p className="font-bold text-slate-200 mb-1">Supported Formats:</p>
                  <ul className="space-y-1 list-disc pl-4 mb-2">
                    <li>Raw DNA: <code className="bg-slate-800 px-1 rounded">ATCG...</code></li>
                    <li>Interval: <code className="bg-slate-800 px-1 rounded">[hg38]chr7:5530575-5530625 -</code></li>
                  </ul>
                  <p className="font-bold text-slate-200 mb-1">Advanced:</p>
                  <ul className="space-y-1 list-disc pl-4">
                    <li>Mutations: <code className="bg-slate-800 px-1 rounded">@chr7 5530575 C T</code></li>
                    <li>Multiple: Separate with <code className="bg-slate-800 px-1 rounded">;</code> or newlines</li>
                  </ul>
                </div>
              </div>
            </div>
            <textarea
              value={query} // This is now the UI state (what user types)
              onChange={handleSequenceInput}
              placeholder="Paste DNA sequence or Seqstr format..."
              className="w-full h-24 bg-transparent text-slate-100 font-mono text-sm p-4 outline-none resize-y border-none focus:ring-0 placeholder:text-slate-600"
              spellCheck={false}
            />

            {/* Status Indicator Overlay */}
            {(isFetchingSeq || error || (query !== activeSequence && activeSequence)) && (
              <div className="absolute bottom-2 right-2 flex items-center gap-2 bg-slate-950/80 backdrop-blur px-2 py-1 rounded text-xs border border-slate-800">
                {isFetchingSeq && (
                  <span className="text-primary-400 flex items-center gap-1">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Fetching...
                  </span>
                )}
                {!isFetchingSeq && error && (
                  <span className="text-red-400 max-w-[200px] truncate" title={error}>
                    Error: {error}
                  </span>
                )}
                {!isFetchingSeq && !error && query !== activeSequence && (
                  <span className="text-emerald-400">
                    Seqstr Loaded ({activeSequence.length} bp)
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-6 items-center bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-sm">
            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <div className="relative">
                <input type="checkbox" checked={rc} onChange={e => setRc(e.target.checked)} className="sr-only peer" />
                <div className="w-10 h-5 bg-slate-700 rounded-full peer-checked:bg-primary-500 transition-colors"></div>
                <div className="absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform peer-checked:translate-x-5"></div>
              </div>
              <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Scan Reverse Complement</span>
            </label>

            <div className="h-6 w-px bg-slate-700 hidden sm:block"></div>

            {/* Bit Score Slider */}
            <div className="flex-1 min-w-[140px]">
              <div className="flex justify-between w-full mb-1 items-center">
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Min Bit Score</span>
                <span className="text-xs text-emerald-400 font-bold">{scoreThreshold.toFixed(1)}</span>
              </div>
              <input
                type="range" min="4" max="20" step="0.1"
                value={scoreThreshold}
                onChange={(e) => setScoreThreshold(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400"
              />
            </div>

            {/* Relative Score Slider */}
            <div className="flex-1 min-w-[140px]">
              <div className="flex justify-between w-full mb-1 items-center">
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Min Rel Score</span>
                <span className="text-xs text-amber-400 font-bold">{Math.round(relScoreThreshold * 100)}%</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.01"
                value={relScoreThreshold}
                onChange={(e) => setRelScoreThreshold(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500 hover:accent-amber-400"
              />
            </div>

            {/* P-Value Slider */}
            <div className="flex-1 min-w-[140px]">
              <div className="flex justify-between w-full mb-1 items-center">
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Max P-value</span>
                <span className="text-xs text-blue-400 font-bold">1e-{pValThresholdLog}</span>
              </div>
              <input
                type="range" min="2" max="10" step="0.1"
                value={pValThresholdLog}
                onChange={(e) => setPValThresholdLog(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400"
                style={{ direction: 'ltr' }}
              />
            </div>

            <div className="text-xs text-slate-500 min-w-[80px] flex justify-end">
              {isComputing ? (
                <div className="flex items-center gap-2 text-primary-400 font-medium animate-pulse">Scanning...</div>
              ) : (
                <span>Ready</span>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-950/30 border border-red-900/50 rounded-lg text-red-400 text-sm">
            Error: {error}
          </div>
        )}

        <SequenceHighlighter
          sequence={activeSequence}
          rna={alphabet === 'rna'}
          hits={hits}
          motifs={motifDefs}
          scoreThreshold={scoreThreshold}
          relScoreThreshold={relScoreThreshold}
          pValThreshold={Math.pow(10, -pValThresholdLog)}
          isComputing={isComputing}
        />

      </div>
    </div>
  );
}

export default App;
