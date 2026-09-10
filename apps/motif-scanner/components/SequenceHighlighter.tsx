
import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { HighlightMatch, MotifHit, MotifDefinition } from '../types';
import MotifLogo from './MotifLogo';

interface SequenceHighlighterProps {
  sequence: string;
  hits: MotifHit[];
  motifs: Record<string, MotifDefinition>;
  scoreThreshold: number;
  pValThreshold: number;
  relScoreThreshold?: number; // New prop for filtering by % of max score
  isComputing?: boolean;
  rna?: boolean;
}

const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsla(${h}, 70%, 50%, 0.3)`; 
};
const stringToSolidColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 70%, 60%)`;
};

const ROW_HEIGHT = 24; 
const CHAR_WIDTH = 9; 
const PADDING_LEFT = 80; 
const VISIBLE_BUFFER = 5;

const BASE_MAP: Record<string, number> = { 'A':0, 'C':1, 'G':2, 'T':3, 'a':0, 'c':1, 'g':2, 't':3 };

const SequenceHighlighter: React.FC<SequenceHighlighterProps> = ({ 
  sequence, 
  hits, 
  motifs, 
  scoreThreshold, 
  pValThreshold, 
  relScoreThreshold = 0.0,
  isComputing = false,
  rna = false
}) => {
  const [charsPerRow, setCharsPerRow] = useState(60);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [lastMatchIndex, setLastMatchIndex] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const availableWidth = width - PADDING_LEFT - 10;
        const cols = Math.max(20, Math.floor(availableWidth / CHAR_WIDTH));
        setCharsPerRow(cols);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const filteredMatches = useMemo(() => {
    const list: HighlightMatch[] = [];
    for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if ((h.rawScore ?? -Infinity) < scoreThreshold) continue;
        if ((h.pvalue ?? 1.0) > pValThreshold) continue;
        if (h.score < relScoreThreshold) continue;
        
        list.push({
            id: h.motifId,
            start: h.start,
            end: h.end,
            score: h.score,
            rawScore: h.rawScore,
            pvalue: h.pvalue,
            ori: h.strand,
            color: stringToColor(h.motifId)
        });
    }
    return list;
  }, [hits, scoreThreshold, pValThreshold, relScoreThreshold]);

  const matchLookup = useMemo(() => {
    const len = sequence.length;
    const lookup = new Int32Array(len).fill(-1);
    for (let i = 0; i < filteredMatches.length; i++) {
        const m = filteredMatches[i];
        const start = Math.max(0, m.start);
        const end = Math.min(len, m.end);
        for (let k = start; k < end; k++) {
            if (lookup[k] === -1) {
                lookup[k] = i;
            }
        }
    }
    return lookup;
  }, [filteredMatches, sequence.length]);

  // Update lastMatchIndex ONLY if the user is hovering over a valid match.
  // If hovering over empty space, we preserve the previous match index.
  useEffect(() => {
    if (hoveredIndex === null) return;
    const matchIdx = matchLookup[hoveredIndex];
    if (matchIdx !== -1) {
        setLastMatchIndex(hoveredIndex);
    }
  }, [hoveredIndex, matchLookup]);

  const totalRows = Math.ceil(sequence.length / charsPerRow);
  const totalHeight = totalRows * ROW_HEIGHT;
  const containerHeight = 600; 

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const startIndex = Math.floor(scrollTop / ROW_HEIGHT);
  const endIndex = Math.min(totalRows, startIndex + Math.ceil(containerHeight / ROW_HEIGHT) + VISIBLE_BUFFER);
  
  const visibleRows = useMemo(() => {
    const rows = [];
    for (let r = startIndex; r < endIndex; r++) {
        const rowStart = r * charsPerRow;
        const rowEnd = Math.min(rowStart + charsPerRow, sequence.length);
        const rowChars = [];
        
        for (let i = 0; i < (rowEnd - rowStart); i++) {
            const absIndex = rowStart + i;
            const matchIdx = matchLookup[absIndex];
            let style: React.CSSProperties = {};
            
            if (matchIdx !== -1) {
                const m = filteredMatches[matchIdx];
                style = { backgroundColor: m.color, color: '#f8fafc' };
            } else {
                style = { color: '#64748b' };
            }

            // Explicit width in style overrides potential CSS class issues and keeps it synced with JS calculations
            rowChars.push(
                <span key={absIndex} className="inline-block text-center" style={{ ...style, width: CHAR_WIDTH }}>
                  {sequence[absIndex]}
                </span>
            );
        }
        
        rows.push(
            <div 
              key={r} 
              className="absolute left-0 w-full flex font-mono text-sm leading-none items-center pointer-events-none"
              style={{ 
                  top: r * ROW_HEIGHT, 
                  height: ROW_HEIGHT,
                  paddingLeft: PADDING_LEFT 
              }}
            >
               <span className="absolute left-0 top-0 w-16 text-right pr-4 text-xs text-slate-600 font-mono pt-1.5">
                  {rowStart + 1}
               </span>
               <div className="flex">{rowChars}</div>
            </div>
        );
    }
    return rows;
  }, [startIndex, endIndex, sequence, matchLookup, filteredMatches, charsPerRow]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
     if (!containerRef.current) return;
     const rect = containerRef.current.getBoundingClientRect();
     
     const x = e.clientX - rect.left + containerRef.current.scrollLeft - PADDING_LEFT;
     const y = e.clientY - rect.top + containerRef.current.scrollTop;

     if (x < 0 || y < 0) { setHoveredIndex(null); return; }
     
     const row = Math.floor(y / ROW_HEIGHT);
     const yInRow = y % ROW_HEIGHT;

     // ENFORCE STRICT TEXT HOVER:
     // Row height is 24px. Text height is ~14px.
     // We only trigger hover if the mouse is within the central 14px of the row.
     // This creates a 5px "dead zone" above and below each line of text,
     // allowing the user to move the mouse horizontally between lines without triggering selection changes.
     const ACTIVE_TEXT_HEIGHT = 14; 
     const VERTICAL_PADDING = (ROW_HEIGHT - ACTIVE_TEXT_HEIGHT) / 2;

     if (yInRow < VERTICAL_PADDING || yInRow > (ROW_HEIGHT - VERTICAL_PADDING)) {
         setHoveredIndex(null);
         return;
     }

     const col = Math.floor(x / CHAR_WIDTH);
     if (col >= charsPerRow) { setHoveredIndex(null); return; }

     const idx = row * charsPerRow + col;
     if (idx >= sequence.length) setHoveredIndex(null);
     else setHoveredIndex(idx);
  }, [sequence.length, charsPerRow]);

  const handleMouseLeave = () => setHoveredIndex(null);

  // Calculate active matches based on the "Locked" index (lastMatchIndex), not the live cursor
  const activeMatches = useMemo(() => {
      if (lastMatchIndex === null) return [];
      return filteredMatches.filter(m => lastMatchIndex >= m.start && lastMatchIndex < m.end);
  }, [lastMatchIndex, filteredMatches]);

  const activeMotifDef = useMemo(() => {
      if (activeMatches.length === 0) return null;
      return motifs[activeMatches[0].id];
  }, [activeMatches, motifs]);

  const highlightRects = useMemo(() => {
      // Show highlight for the locked match, even if cursor moved away
      if (activeMatches.length === 0) return [];
      const match = activeMatches[0];
      const rects = [];
      
      let current = match.start;
      const end = match.end; 
      
      while (current < end) {
          const row = Math.floor(current / charsPerRow);
          const col = current % charsPerRow;
          const charsInRow = charsPerRow - col;
          const chunk = Math.min(end - current, charsInRow);
          
          rects.push({
              top: row * ROW_HEIGHT,
              left: PADDING_LEFT + (col * CHAR_WIDTH),
              width: chunk * CHAR_WIDTH,
              height: ROW_HEIGHT
          });
          current += chunk;
      }
      return rects;
  }, [activeMatches, charsPerRow]);

  // Calculate score breakdown on the fly
  const breakdown = useMemo(() => {
    if (!activeMotifDef || activeMatches.length === 0) return null;
    
    const m = activeMatches[0];
    const fullLen = activeMotifDef.len;
    const isRC = m.ori === '-';
    
    // We need to grab the actual sequence segment from the main sequence text
    const visualStart = m.start;
    const fullStart = isRC ? visualStart - activeMotifDef.trimRight : visualStart - activeMotifDef.trimLeft;
    
    const rows = [];
    const pssm = isRC ? activeMotifDef.pssmRC : activeMotifDef.pssm;
    
    if (fullStart < 0 || fullStart + fullLen > sequence.length) return null;

    for (let i = 0; i < fullLen; i++) {
        const seqIdx = fullStart + i;
        const char = sequence[seqIdx];
        const baseCode = BASE_MAP[char.toUpperCase()] ?? 4; 
        let score = 0;
        
        if (baseCode < 4) {
            score = pssm[i * 5 + baseCode];
        } else {
            score = pssm[i * 5 + 4]; 
        }

        const isTrimmed = isRC 
           ? (i < activeMotifDef.trimRight || i >= fullLen - activeMotifDef.trimLeft)
           : (i < activeMotifDef.trimLeft || i >= fullLen - activeMotifDef.trimRight);

        rows.push({ i, char, score, isTrimmed });
    }
    
    return rows;
  }, [activeMotifDef, activeMatches, sequence]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-slate-900 rounded-xl border border-slate-800 shadow-lg overflow-hidden flex flex-col relative">
        <div className="p-4 border-b border-slate-800 bg-slate-900 z-10 flex justify-between items-center">
            <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Sequence View</h3>
            <div className="text-xs text-slate-500 flex gap-4">
               <span>Showing: <span className="text-white">{filteredMatches.length}</span></span>
               <span>Hidden: <span className="text-slate-600">{hits.length - filteredMatches.length}</span></span>
            </div>
        </div>
        
        <div 
          className="relative overflow-y-auto custom-scrollbar bg-slate-950 cursor-crosshair"
          style={{ height: containerHeight }}
          onScroll={handleScroll}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          ref={containerRef}
        >
           <div style={{ height: totalHeight, position: 'relative', minWidth: '100%', minHeight: '100%' }}>
              {visibleRows}
              {highlightRects.map((style, i) => (
                  <div key={i} className="absolute border border-white bg-white/10 pointer-events-none z-10" style={style} />
              ))}
           </div>
           {isComputing && (
             <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-[1px] flex items-center justify-center z-50">
                 <div className="flex flex-col items-center gap-3">
                    <svg className="animate-spin h-8 w-8 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span className="text-sm text-primary-400 font-medium animate-pulse">Scanning sequence...</span>
                 </div>
             </div>
           )}
        </div>
      </div>

      <div className="lg:col-span-1">
        <div className="sticky top-6 flex flex-col gap-4">
             <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-lg min-h-[200px] max-h-[calc(100vh-4rem)] overflow-y-auto custom-scrollbar">
                <h3 className="text-slate-400 text-sm font-semibold mb-4 uppercase tracking-wider border-b border-slate-800 pb-2">
                    {hoveredIndex !== null 
                       ? `Position: ${hoveredIndex + 1}` 
                       : activeMatches.length > 0 
                          ? `Selected: Match at ${activeMatches[0].start + 1}` 
                          : 'Hover sequence for details'
                    }
                </h3>
                
                {activeMatches.length > 0 ? (
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-white font-bold text-lg truncate" style={{ color: stringToSolidColor(activeMatches[0].id) }}>
                                    {activeMatches[0].id}
                                </span>
                                <span className="bg-slate-800 text-xs px-2 py-1 rounded text-slate-300 border border-slate-700">
                                    {activeMatches[0].ori === '+' ? 'Forward' : 'Reverse'}
                                </span>
                            </div>
                            <div className="text-xs text-slate-500 mb-2 space-y-1">
                                <div className="flex justify-between">
                                    <span>Bit Score:</span>
                                    <span className="text-emerald-400 font-bold">{activeMatches[0].rawScore?.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Rel Score (Match%):</span>
                                    <span className="text-amber-400 font-bold">{(activeMatches[0].score * 100).toFixed(1)}%</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>P-value:</span>
                                    <span className="text-blue-400 font-mono">{activeMatches[0].pvalue?.toExponential(2) ?? 'N/A'}</span>
                                </div>
                                {activeMotifDef && (
                                   <>
                                     <div className="flex justify-between pt-1 mt-1 border-t border-slate-800/50">
                                        <span>Score Range:</span>
                                        <span className="text-slate-400">{activeMotifDef.minScore.toFixed(1)} to {activeMotifDef.maxScore.toFixed(1)}</span>
                                     </div>
                                   </>
                                )}
                            </div>

                            {/* Motif Logo (Moved above breakdown) */}
                            {activeMotifDef && (
                                <div className="mb-4 pt-2 border-t border-slate-800/50">
                                    <div className="flex justify-between text-[10px] text-slate-500 mb-1 uppercase tracking-wide">
                                        <span>Motif Logo</span>
                                    </div>
                                    <div className="bg-slate-950 p-2 rounded border border-slate-800 overflow-hidden relative">
                                        <MotifLogo 
                                            rna={rna}
                                            logoCols={
                                                activeMatches[0].ori === '-' 
                                                ? [...activeMotifDef.logoCols].reverse().map(c => [c[3], c[2], c[1], c[0]])
                                                : activeMotifDef.logoCols
                                            } 
                                            height={60} 
                                            glyphWidth={12}
                                            trimLeft={activeMatches[0].ori === '-' ? activeMotifDef.trimRight : activeMotifDef.trimLeft}
                                            trimRight={activeMatches[0].ori === '-' ? activeMotifDef.trimLeft : activeMotifDef.trimRight}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Breakdown Table (Collapsible) */}
                            {breakdown && (
                                <div className="mt-1 mb-3 border border-slate-800 rounded overflow-hidden">
                                    <button 
                                        onClick={() => setShowBreakdown(!showBreakdown)}
                                        className="w-full flex items-center justify-between bg-slate-950 px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase hover:bg-slate-900 transition-colors"
                                    >
                                        <span>Score Breakdown</span>
                                        <span className="text-xs">{showBreakdown ? '−' : '+'}</span>
                                    </button>
                                    
                                    {showBreakdown && (
                                    <div className="border-t border-slate-800">
                                        <div className="bg-slate-950/50 px-2 py-1 text-[9px] text-slate-500 text-right italic border-b border-slate-800/50">
                                            Log-odds ratio (base 2)
                                        </div>
                                        <div className="max-h-[200px] overflow-y-auto bg-slate-900/50 custom-scrollbar">
                                            <table className="w-full text-[10px] font-mono text-left">
                                                <thead>
                                                    <tr className="text-slate-500 border-b border-slate-800">
                                                        <th className="px-2 py-1">Pos</th>
                                                        <th className="px-2 py-1">Base</th>
                                                        <th className="px-2 py-1 text-right">Score</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {breakdown.map((row) => (
                                                        <tr key={row.i} className={row.isTrimmed ? 'opacity-40' : ''}>
                                                            <td className="px-2 py-0.5 text-slate-400">{row.i + 1}</td>
                                                            <td className={`px-2 py-0.5 font-bold ${row.score < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{row.char}</td>
                                                            <td className="px-2 py-0.5 text-right text-slate-300">{row.score.toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {activeMatches.length > 1 && (
                            <div>
                                <div className="text-xs font-semibold text-slate-500 mb-2 uppercase mt-4 border-t border-slate-800 pt-2">
                                    + {activeMatches.length - 1} Overlapping
                                </div>
                                <div className="flex flex-col gap-1 max-h-[150px] overflow-y-auto pr-2 custom-scrollbar">
                                    {activeMatches.slice(1).map((m, i) => (
                                        <div key={i} className="flex justify-between items-center text-xs p-1.5 rounded bg-slate-800/50 border border-slate-800 hover:bg-slate-800 transition-colors">
                                            <div className="flex flex-col truncate w-1/2">
                                               <span className="truncate text-slate-300 font-medium" title={m.id}>{m.id}</span>
                                               <span className="text-[10px] text-slate-500">{m.start+1}-{m.end}</span>
                                            </div>
                                            <div className="flex flex-col items-end w-1/2">
                                                <span className="font-mono text-emerald-400">{m.rawScore?.toFixed(1)}</span>
                                                <span className="text-[10px] text-amber-400">{(m.score * 100).toFixed(0)}%</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : hoveredIndex !== null ? (
                    <div className="text-slate-600 italic text-center py-8 px-4">
                       No hits satisfy filters at this position.
                    </div>
                ) : (
                    <div className="text-slate-600 text-sm space-y-2">
                        <p>Matches are highlighted based on the "core" (high information content) of the motif.</p>
                        <p>Scores reflect the full motif model.</p>
                    </div>
                )}
             </div>
        </div>
      </div>
    </div>
  );
};

export default SequenceHighlighter;
