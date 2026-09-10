
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
import cisbpRnaMeme from '../../resources/CISBP-RNA_Homo_sapiens.meme?raw';

const DATABASES = {
  'vierstra': { name: 'Vierstra Clustered Motifs', data: vierstraJson, type: 'json', alphabet: 'dna' },
  'jaspar': { name: 'JASPAR 2024 CORE Vertebrates', data: jasparJson, type: 'json', alphabet: 'dna' },
  'h14': { name: 'H14CORE MEME Format', data: h14Meme, type: 'meme', alphabet: 'dna' },
  'cisbp-rna': { name: 'CIS-BP-RNA Human RBPs (RNA)', data: cisbpRnaMeme, type: 'meme', alphabet: 'rna' },
  'custom': { name: 'Custom Upload', data: null, type: 'custom', alphabet: 'dna' }
};

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

  // Database Selection
  const [selectedDbKey, setSelectedDbKey] = useState<string>('vierstra');

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

  // Load Database Effect
  useEffect(() => {
    if (!workerRef.current) return;
    if (selectedDbKey === 'custom') return; // Handled by file upload

    const db = DATABASES[selectedDbKey as keyof typeof DATABASES];
    if (!db) return;

    setIsComputing(true);
    setDbName(`Loading ${db.name}...`);

    try {
      let payload: any = db.data;
      if (db.type === 'meme') {
        payload = parseMeme(db.data as string);
      }

      // Ensure name is passed if not in data
      if (!payload.name) payload.name = db.name;

      const isRna = payload.alphabet === 'rna' || (db as any).alphabet === 'rna';
      setAlphabet(isRna ? 'rna' : 'dna');
      setRc(!isRna);

      workerRef.current.postMessage({ type: "load-db", payload });
    } catch (err: any) {
      setError(`Failed to load database: ${err.message}`);
      setIsComputing(false);
    }

  }, [selectedDbKey]);

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

    const initialDb = DATABASES['vierstra'];
    worker.postMessage({ type: "load-db", payload: initialDb.data });

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

    setSelectedDbKey('custom'); // Switch dropdown to custom
    setIsComputing(true);
    try {
      const text = await file.text();
      let data: MotifInputData | null = null;
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
        const isRna = (data as any).alphabet === 'rna';
        setAlphabet(isRna ? 'rna' : 'dna');
        setRc(!isRna);
        workerRef.current.postMessage({ type: "load-db", payload: data });
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">

        <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-800 pb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
              <span className="bg-gradient-to-r from-primary-400 to-emerald-400 bg-clip-text text-transparent">Realtime</span> Motif Scanner
            </h1>
            <p className="text-slate-400 text-sm max-w-2xl">
              FIMO-style Probabilistic Scanning. Visuals are trimmed to "Core" motif (high info content), but scores/p-values reflect the full PSSM.
            </p>
            <div className="mt-3 flex items-center gap-3 text-xs text-slate-500 font-mono">
              <span className="px-2 py-1 bg-slate-900 rounded border border-slate-800 text-emerald-400">DB: {dbName}</span>
              <span className="px-2 py-1 bg-slate-900 rounded border border-slate-800 text-primary-400">{motifCount} Motifs</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Database Selector */}
            <div className="relative">
              <select
                value={selectedDbKey}
                onChange={(e) => setSelectedDbKey(e.target.value)}
                className="appearance-none bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 pr-8"
              >
                {Object.entries(DATABASES).map(([key, db]) => (
                  <option key={key} value={key}>{db.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
              </div>
            </div>

            <label className="btn-secondary cursor-pointer flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 px-4 py-2 rounded-lg transition-colors text-sm font-medium shadow-sm">
              <span>Load Custom (JSON / MEME)</span>
              <input type="file" accept=".json,.txt,.meme" className="hidden" onChange={handleFileUpload} />
            </label>
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
