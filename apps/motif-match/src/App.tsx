import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import './App.css';
// @ts-ignore
import Worker from './worker.ts?worker&inline';
// @ts-ignore
import vierstraJson from '@resources/vierstra_clustered_motif_v2.json';
// @ts-ignore
import jasparJson from '@resources/JASPAR2024_CORE_vertebrates.json';
// @ts-ignore
import h14Meme from '@resources/H14CORE_meme_format.meme?raw';
// @ts-ignore
import cisbpMeme from '@resources/CISBP_Homo_sapiens.meme?raw';
// @ts-ignore
import cisbpRnaMeme from '@resources/CISBP-RNA_Homo_sapiens.meme?raw';

import MotifLogo from './components/MotifLogo';
import Heatmap from './components/Heatmap';
import { SearchIcon, ArrowRightIcon, RefreshIcon, GridIcon, DownloadIcon } from './components/Icons';
import { decideAutoRC } from './utils/alignment';
import { parseMeme } from './utils/memeParser';

const DATABASES = {
  'jaspar': { name: 'JASPAR 2024 CORE Vertebrates', data: jasparJson, type: 'json' },
  'h14': { name: 'HOCOMOCO H14 CORE', data: h14Meme, type: 'meme' },
  'cisbp': { name: 'CIS-BP 2.0 Human', data: cisbpMeme, type: 'meme' },
  'vierstra': { name: 'Vierstra Clustered Motifs', data: vierstraJson, type: 'json' },
  'cisbp-rna': { name: 'CIS-BP-RNA Human RBPs', data: cisbpRnaMeme, type: 'meme' }
};

// A loaded query is either an ONNX model or a parsed motif set (MEME/JSON).
type Query =
  | { kind: 'onnx'; buffer: ArrayBuffer; name: string }
  | { kind: 'motifs'; data: { name: string; motifs: any[] }; name: string };

function App() {
    const [status, setStatus] = useState('Initializing...');
    const [selectedDbKey, setSelectedDbKey] = useState<string>('vierstra');
    const [currentQuery, setCurrentQuery] = useState<Query | null>(null);
    const currentQueryRef = useRef<Query | null>(null);

    useEffect(() => {
        currentQueryRef.current = currentQuery;
    }, [currentQuery]);

    const postQuery = (worker: Worker, q: Query) => {
        if (q.kind === 'onnx') worker.postMessage({ type: 'match', payload: q.buffer });
        else worker.postMessage({ type: 'match-motifs', payload: q.data });
    };
    
    // Data from worker
    const [matches, setMatches] = useState<any[]>([]);
    const [motifs, setMotifs] = useState<number[][][]>([]);
    const [annotations, setAnnotations] = useState<string[]>([]);
    const [scores, setScores] = useState<Float32Array | null>(null);
    const [totalN, setTotalN] = useState(0);

    // UI State
    const [selectedMatchIndex, setSelectedMatchIndex] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    
    // Cluster View State
    const [qSel, setQSel] = useState<number | null>(null);
    const [dSel, setDSel] = useState<number | null>(null);
    
    // RC State
    const [rcQ, setRcQ] = useState(false);
    const [rcD, setRcD] = useState(false);
    const [rcQManual, setRcQManual] = useState(false);
    const [rcDManual, setRcDManual] = useState(false);
    
    // Per-member RC overrides
    const [rcOverrides, setRcOverrides] = useState<Map<number, boolean>>(new Map());
    const [listFlipQ, setListFlipQ] = useState(false);
    const [listFlipD, setListFlipD] = useState(false);
    const [heatmapTransposed, setHeatmapTransposed] = useState(true);

    const workerRef = useRef<Worker | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const worker = new Worker();
        workerRef.current = worker;

        worker.onmessage = (e) => {
            const { type, message, count, matches: results, layerName, dims, motifs: rawMotifs, annotations: annots, scores: rawScores, N } = e.data;
            
            if (type === 'db-loaded') {
                const q = currentQueryRef.current;
                if (q) {
                    setStatus(`Database loaded. Re-matching against ${q.name}...`);
                    postQuery(worker, q);
                } else {
                    setStatus(`Database loaded (${count} motifs). Ready.`);
                }
            } else if (type === 'status') {
                setStatus(message);
            } else if (type === 'weights-loaded') {
                setStatus(`Loaded layer ${layerName} (${dims.join('x')}). Matching...`);
            } else if (type === 'results') {
                setMatches(results);
                setMotifs(rawMotifs);
                setAnnotations(annots);
                setScores(new Float32Array(rawScores));
                setTotalN(N);
                
                setStatus('Matching complete.');
                if (results.length > 0) {
                    setSelectedMatchIndex(0);
                }
            } else if (type === 'error') {
                setStatus(`Error: ${message}`);
                console.error(message);
            }
        };

        return () => worker.terminate();
    }, []);

    useEffect(() => {
        if (!workerRef.current) return;
        const db = DATABASES[selectedDbKey as keyof typeof DATABASES];
        setStatus(`Loading ${db.name}...`);
        
        // Clear previous results to indicate re-computation
        setMatches([]);
        setSelectedMatchIndex(null);
        setQSel(null);
        setDSel(null);
        
        try {
            workerRef.current.postMessage({ 
                type: 'load-db', 
                payload: db.data, 
                format: db.type 
            });
        } catch (err: any) {
            setStatus(`Failed to load DB: ${err.message}`);
        }
    }, [selectedDbKey]);

    const handleExport = () => {
        if (matches.length === 0) return;
        
        // Header
        const headers = ['Query ID', 'DB ID', 'Query Name', 'DB Name', 'Avg Score', 'Max Score', 'Q Size', 'D Size', 'Query Members', 'DB Members'];
        const rows = matches.map(m => [
            m.q_rep,
            m.d_rep,
            annotations[m.q_rep],
            annotations[m.d_rep],
            m.avg.toFixed(4),
            m.max.toFixed(4),
            m.q_size,
            m.d_size,
            m.q_members.map((i: number) => annotations[i]).join('|'),
            m.d_members.map((i: number) => annotations[i]).join('|')
        ]);
        
        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.map(c => `"${c}"`).join(','))
        ].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `motif_matches_${selectedDbKey}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const loadQuery = useCallback((file: File) => {
        const worker = workerRef.current;
        if (!worker) return;
        setStatus(`Reading ${file.name}...`);
        const name = file.name.toLowerCase();
        const reader = new FileReader();

        if (name.endsWith('.onnx')) {
            reader.onload = () => {
                if (!reader.result) return;
                const buffer = reader.result as ArrayBuffer;
                const q: Query = { kind: 'onnx', buffer, name: file.name };
                setCurrentQuery(q);
                postQuery(worker, q);
            };
            reader.readAsArrayBuffer(file);
        } else {
            // MEME (.meme/.txt) or JSON motif set
            reader.onload = () => {
                if (typeof reader.result !== 'string') return;
                const text = reader.result;
                try {
                    let data: { name: string; motifs: any[] };
                    try {
                        const json = JSON.parse(text);
                        data = json.motifs ? json : { name: file.name, motifs: json };
                    } catch {
                        data = parseMeme(text);
                    }
                    if (!data.motifs || !data.motifs.length) throw new Error('No motifs found in file.');
                    const q: Query = { kind: 'motifs', data, name: file.name };
                    setCurrentQuery(q);
                    postQuery(worker, q);
                } catch (err: any) {
                    setStatus(`Error: ${err.message}`);
                }
            };
            reader.readAsText(file);
        }
    }, []);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (file) loadQuery(file);
    }, [loadQuery]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, noClick: true });

    const currentMatch = selectedMatchIndex !== null ? matches[selectedMatchIndex] : null;

    // Keyboard Navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if searching
            if (document.activeElement?.tagName === 'INPUT') return;
            
            if (matches.length === 0) return;
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedMatchIndex(prev => {
                    if (prev === null) return 0;
                    return Math.min(prev + 1, matches.length - 1);
                });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedMatchIndex(prev => {
                    if (prev === null) return matches.length - 1;
                    return Math.max(prev - 1, 0);
                });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [matches.length]);

    useEffect(() => {
        if (currentMatch) {
            setQSel(currentMatch.q_rep);
            setDSel(currentMatch.d_rep);
            setRcQ(false);
            setRcD(false);
            setRcQManual(false);
            setRcDManual(false);
            setRcOverrides(new Map());
            setListFlipQ(false);
            setListFlipD(false);
        }
    }, [selectedMatchIndex]);

    useEffect(() => {
        if (!currentMatch || !motifs.length) return;
        
        const dbRep = currentMatch.d_rep;
        const dbRepMotif = motifs[dbRep];

        if (qSel !== null && !rcQManual) {
            const shouldFlip = decideAutoRC(motifs[qSel], dbRepMotif);
            setRcQ(shouldFlip);
        }
        
        if (dSel !== null && !rcDManual) {
            const shouldFlip = decideAutoRC(motifs[dSel], dbRepMotif);
            setRcD(shouldFlip);
        }
    }, [qSel, dSel, currentMatch, motifs, rcQManual, rcDManual]);

    const getScore = useCallback((i: number, j: number) => {
        if (!scores || !totalN) return 0;
        return scores[i * totalN + j];
    }, [scores, totalN]);

    const getEffectiveRC = useCallback((idx: number, isListFlip: boolean, refIdx: number) => {
        const override = rcOverrides.get(idx);
        const auto = decideAutoRC(motifs[idx], motifs[refIdx]);
        const flip = !!override;
        return (isListFlip !== flip) ? !auto : auto;
    }, [motifs, rcOverrides]);

    const toggleOverride = (idx: number) => {
        const newMap = new Map(rcOverrides);
        newMap.set(idx, !newMap.get(idx));
        setRcOverrides(newMap);
    };

    const filteredMatches = useMemo(() => {
        if (!searchQuery) return matches;
        const q = searchQuery.toLowerCase();
        return matches.filter(m => {
            const qn = (annotations[m.q_rep] || '').toLowerCase();
            const dn = (annotations[m.d_rep] || '').toLowerCase();
            return qn.includes(q) || dn.includes(q);
        });
    }, [matches, searchQuery, annotations]);

    const heatmapData = useMemo(() => {
        if (!currentMatch || !scores) return null;
        const qMem = currentMatch.q_members as number[];
        const dMem = currentMatch.d_members as number[];
        
        const mat = qMem.map(q => dMem.map(d => getScore(q, d)));
        const qLabels = qMem.map(i => annotations[i]);
        const dLabels = dMem.map(i => annotations[i]);
        
        return { mat, qLabels, dLabels };
    }, [currentMatch, scores, annotations, getScore]);

    return (
        <div className="App" {...getRootProps()}>
                <input {...getInputProps()} />
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".onnx,.meme,.txt,.json"
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) loadQuery(f); e.target.value = ''; }}
                />
            {isDragActive && (
                <div className="dropzone-overlay">
                    <div>Drop an <strong>.onnx</strong> model or a <strong>.meme / .json</strong> motif file</div>
            </div>
            )}

            <header className="header">
                <a className="brand-link" href="https://motif.zhoulab.io/">
                    <span className="brand-mark"><i></i><i></i><i></i><i></i></span>
                    <span className="brand-name">Motif Tools</span>
                    <span className="brand-sep">/</span>
                    <span className="brand-tool">Match</span>
                </a>
                <div className="controls">
                    <a className="back-link" href="https://motif.zhoulab.io/">← All tools</a>
                    <button className="btn-upload" onClick={() => fileInputRef.current?.click()}>Load file…</button>
                    <div className="status-pill">
                        <div className={`status-dot ${status.includes('Ready') || status.includes('complete') ? 'ready' : 'busy'}`}></div>
                        {status}
                    </div>
                    <button 
                        className="btn-icon"
                        onClick={handleExport}
                        title="Export Matches as CSV"
                        disabled={matches.length === 0}
                        style={{ opacity: matches.length === 0 ? 0.5 : 1 }}
                    >
                        <DownloadIcon style={{ width: 14, height: 14 }} />
                    </button>
                    <select 
                        value={selectedDbKey} 
                        onChange={(e) => setSelectedDbKey(e.target.value)}
                        className="db-select"
                    >
                        {Object.entries(DATABASES).map(([key, db]) => (
                            <option key={key} value={key}>{db.name}</option>
                        ))}
                    </select>
                </div>
            </header>

            <div className="main-layout">
                {/* Left Column */}
                <div className="col-left">
                    <div className="list-header">
                        <div className="search-wrapper">
                            <input 
                                type="text" 
                                placeholder="Filter matches..." 
                                className="search-box"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                            <div className="search-icon-wrapper">
                                <SearchIcon className="search-icon" />
                            </div>
                        </div>
                    </div>
                    <div className="match-list">
                        {matches.length === 0 ? (
                            <div className="empty-state">
                                <span>No model loaded</span>
                                <span className="text-xs">Drop an .onnx file anywhere to start</span>
                            </div>
                        ) : (
                            filteredMatches.map((m, i) => {
                                const isActive = matches.indexOf(m) === selectedMatchIndex;
                                return (
                                    <div 
                                        key={i} 
                                        className={`match-item ${isActive ? 'active' : ''}`}
                                        onClick={() => setSelectedMatchIndex(matches.indexOf(m))}
                                    >
                                        <div className="match-meta">
                                            <span>Q:{m.q_size} • D:{m.d_size}</span>
                                            <span className="score-badge">{m.avg.toFixed(3)}</span>
                                        </div>
                                        <div className="match-names">
                                            <div className="q-name" title={annotations[m.q_rep]}>
                                                {annotations[m.q_rep]}
                                            </div>
                                            <div className="d-name" title={annotations[m.d_rep]}>
                                                <ArrowRightIcon className="arrow-icon" />
                                                {annotations[m.d_rep]}
                                            </div>
                                        </div>
                                        <div className="mini-logo-wrapper">
                                            <MotifLogo pwm={motifs[m.q_rep]} height={32} glyphWidth={10} width="100%" fit="fill" />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Center Column */}
                <div className="col-center">
                    {currentMatch && motifs.length > 0 ? (
                        <>
                            {/* Query Logo Card */}
                            <div className="card">
                                <div className="section-label">
                                    <span>Query Representative</span>
                                    <div className="logo-actions">
                                        <button 
                                            className={`btn-icon ${rcQ ? 'active' : ''}`}
                                            onClick={() => { setRcQ(!rcQ); setRcQManual(true); }}
                                            title="Reverse Complement"
                                        >
                                            RC
                                        </button>
                                    </div>
                                </div>
                                <div className="logo-title">
                                    {annotations[qSel!]}
                                </div>
                                <MotifLogo 
                                    pwm={motifs[qSel!]} 
                                    rc={rcQ} 
                                    height={140} 
                                    width="100%"
                                    glyphWidth={24}
                                />
                            </div>

                            {/* DB Logo Card */}
                            <div className="card">
                                <div className="section-label">
                                    <span>Database Representative</span>
                                    <div className="logo-actions">
                                        <button 
                                            className={`btn-icon ${rcD ? 'active' : ''}`}
                                            onClick={() => { setRcD(!rcD); setRcDManual(true); }}
                                            title="Reverse Complement"
                                        >
                                            RC
                                        </button>
                                    </div>
                                </div>
                                <div className="logo-title">
                                    {annotations[dSel!]}
                                </div>
                                <div className="db-logo-wrapper">
                                    <MotifLogo 
                                        pwm={motifs[dSel!]} 
                                        rc={rcD} 
                                        height={140} 
                                        width="100%"
                                        glyphWidth={24}
                                    />
                                </div>
                            </div>

                            {/* Heatmap Card */}
                            <div className="heatmap-card">
                                <Heatmap 
                                    matrix={heatmapData!.mat}
                                    rowLabels={heatmapData!.qLabels}
                                    colLabels={heatmapData!.dLabels}
                                    transposed={heatmapTransposed}
                                    onSwapAxes={() => setHeatmapTransposed(!heatmapTransposed)}
                                />
                            </div>
                        </>
                    ) : matches.length > 0 ? (
                        <div className="empty-state">
                            <GridIcon className="empty-icon" />
                            <p>Select a match to view details</p>
                        </div>
                    ) : (
                        <div className="input-guide">
                            <GridIcon className="empty-icon" />
                            <h2>Load a model or a motif set to begin</h2>
                            <p className="input-guide-lead">
                                Motif Match clusters a collection of motifs and aligns each cluster to known
                                motifs in the database you pick above — so you can see which known motifs your
                                set resembles. The collection can come from a trained model or from a motif file.
                            </p>
                            <div className="input-spec">
                                <div className="input-spec-row">
                                    <span className="input-spec-k">ONNX model</span>
                                    <span className="input-spec-v">a <code>.onnx</code> file whose first layer is a <code>Conv1d</code> of shape <code>(filters × 4 × width)</code> — one channel per base A/C/G/T. Its learned filters become the query set.</span>
                                </div>
                                <div className="input-spec-row">
                                    <span className="input-spec-k">Motif file</span>
                                    <span className="input-spec-v">a <code>.meme</code> file, or JSON <code>{'{ motifs: [{ id, pwm }] }'}</code>, to compare any set of motifs against the database.</span>
                                </div>
                                <div className="input-spec-row">
                                    <span className="input-spec-k">Output</span>
                                    <span className="input-spec-v">clusters matched to known motifs, with aligned logos and a similarity heatmap; export as CSV.</span>
                                </div>
                            </div>
                            <div className="input-guide-actions">
                                <button className="btn-upload primary" onClick={() => fileInputRef.current?.click()}>Choose a file…</button>
                                <span className="input-guide-hint">or drag it anywhere onto this page</span>
                            </div>
                            <p className="input-guide-note">
                                Just have a sequence or a single motif? Use the
                                {' '}<a href="https://motif.zhoulab.io/scan/">Scanner</a> or
                                {' '}<a href="https://motif.zhoulab.io/search/">Search</a> tools instead.
                            </p>
                        </div>
                    )}
                </div>

                {/* Right Column */}
                <div className="col-right">
                    {currentMatch && motifs.length > 0 && (
                        <>
                            <div className="grid-section">
                                <div className="cluster-header">
                                    <span className="cluster-title">Query Cluster ({currentMatch.q_members.length})</span>
                                    <button 
                                        className={`btn-xs ${listFlipQ ? 'active' : ''}`} 
                                        onClick={() => setListFlipQ(!listFlipQ)}
                                    >
                                        Flip All
                                    </button>
                                </div>
                                <div className="member-grid">
                                    {currentMatch.q_members.map((idx: number) => {
                                        const isRep = idx === currentMatch.q_rep;
                                        const isSel = idx === qSel;
                                        const effRC = getEffectiveRC(idx, listFlipQ, currentMatch.d_rep);
                                        
                                        return (
                                            <div 
                                                key={idx} 
                                                className={`member-card ${isRep ? 'rep' : ''} ${isSel ? 'selected' : ''}`}
                                                onClick={() => { setQSel(idx); setRcQManual(false); }}
                                            >
                                                <div className="member-info">
                                                    <span className="member-name" title={annotations[idx]}>{annotations[idx]}</span>
                                                    <button 
                                                        className={`btn-xs ${effRC ? 'active' : ''}`}
                                                        onClick={(e) => { e.stopPropagation(); toggleOverride(idx); }}
                                                    >RC</button>
                                                </div>
                                                <MotifLogo 
                                                    pwm={motifs[idx]} 
                                                    rc={effRC}
                                                    height={36}
                                                    width="100%"
                                                    glyphWidth={12}
                                                    fit="fill"
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid-section">
                                <div className="cluster-header">
                                    <span className="cluster-title">Database Cluster ({currentMatch.d_members.length})</span>
                                    <button 
                                        className={`btn-xs ${listFlipD ? 'active' : ''}`} 
                                        onClick={() => setListFlipD(!listFlipD)}
                                    >
                                        Flip All
                                    </button>
                                </div>
                                <div className="member-grid">
                                    {currentMatch.d_members.map((idx: number) => {
                                        const isRep = idx === currentMatch.d_rep;
                                        const isSel = idx === dSel;
                                        const effRC = getEffectiveRC(idx, listFlipD, currentMatch.d_rep);

                                        return (
                                            <div 
                                                key={idx} 
                                                className={`member-card ${isRep ? 'rep' : ''} ${isSel ? 'selected' : ''}`}
                                                onClick={() => { setDSel(idx); setRcDManual(false); }}
                                            >
                                                <div className="member-info">
                                                    <span className="member-name" title={annotations[idx]}>{annotations[idx]}</span>
                                                    <button 
                                                        className={`btn-xs ${effRC ? 'active' : ''}`}
                                                        onClick={(e) => { e.stopPropagation(); toggleOverride(idx); }}
                                                    >RC</button>
                                                </div>
                                                <MotifLogo 
                                                    pwm={motifs[idx]} 
                                                    rc={effRC}
                                                    height={36}
                                                    width="100%"
                                                    glyphWidth={12}
                                                    fit="fill"
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;
