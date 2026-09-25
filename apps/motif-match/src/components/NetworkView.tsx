import { useEffect, useRef, useState, useCallback } from 'react';
import MotifLogo from './MotifLogo';
import { decideAutoRC } from '../utils/alignment';

export interface DbNode {
    id: string;
    source: string;
    x: number; // normalized 0..1
    y: number;
    pwm?: number[][];
    nn?: number;   // index of nearest relative (for hover alignment)
    nns?: number;  // its correlation
}
export interface QueryNode {
    id: string;
    x: number; // world coords (already placed near matches)
    y: number;
    pwm: number[][];
    bestId?: string;
    bestScore?: number;
    bestDbIndex?: number;
}
export interface QueryEdge {
    q: number;
    db: number;
}

interface Props {
    nodes: DbNode[];
    edges: [number, number][];
    queryNodes: QueryNode[];
    queryEdges: QueryEdge[];
    sources: { key: string; count: number }[];
}

const SRC_COLORS: Record<string, string> = {
    JASPAR: '#5B8DEF',
    HOCOMOCO: '#35B0A7',
    'CIS-BP': '#A78BFA',
    Vierstra: '#EC6A9C',
};
const COL_QUERY = '#F7B32B';
const COL_EDGE = 'rgba(143,163,188,0.10)';
const COL_QEDGE = 'rgba(247,179,43,0.6)';
const COL_HILITE = '#35C9D6';
const WORLD = 1400; // normalized coords are scaled into a WORLD x WORLD box

type PickResult = { type: 'db' | 'query'; idx: number };

export default function NetworkView({ nodes, edges, queryNodes, queryEdges, sources }: Props) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const transformRef = useRef({ x: 0, y: 0, k: 1 });
    const sizeRef = useRef({ w: 0, h: 0 });
    const fittedRef = useRef(false);
    const panRef = useRef<{ on: boolean; sx: number; sy: number } | null>(null);
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const hiddenRef = useRef(hidden);
    hiddenRef.current = hidden;

    const [hover, setHover] = useState<{ pick: PickResult; x: number; y: number } | null>(null);
    const [selected, setSelected] = useState<PickResult | null>(null);

    const wx = (n: { x: number; y: number }) => n.x * WORLD;
    const wy = (n: { x: number; y: number }) => n.y * WORLD;
    const toScreen = (x: number, y: number) => {
        const t = transformRef.current;
        return [x * t.k + t.x, y * t.k + t.y];
    };

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const { w, h } = sizeRef.current;
        const dpr = window.devicePixelRatio || 1;
        const hid = hiddenRef.current;
        const focus = hover?.pick || selected;

        // neighbours of focus (db-db + query-db)
        const neigh = new Set<string>();
        if (focus) {
            if (focus.type === 'db') {
                for (const [a, b] of edges) {
                    if (a === focus.idx) neigh.add('d' + b);
                    else if (b === focus.idx) neigh.add('d' + a);
                }
                for (const e of queryEdges) if (e.db === focus.idx) neigh.add('q' + e.q);
            } else {
                for (const e of queryEdges) if (e.q === focus.idx) neigh.add('d' + e.db);
            }
        }
        const focusUid = focus ? (focus.type === 'db' ? 'd' : 'q') + focus.idx : null;

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // db edges (skip if either endpoint hidden)
        ctx.strokeStyle = COL_EDGE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b] of edges) {
            const na = nodes[a], nb = nodes[b];
            if (hid.has(na.source) || hid.has(nb.source)) continue;
            const [ax, ay] = toScreen(wx(na), wy(na));
            const [bx, by] = toScreen(wx(nb), wy(nb));
            ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        }
        ctx.stroke();

        // highlighted db edges around focus
        if (focus && focus.type === 'db') {
            ctx.strokeStyle = 'rgba(53,201,214,0.55)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (const [a, b] of edges) {
                if (a !== focus.idx && b !== focus.idx) continue;
                const na = nodes[a], nb = nodes[b];
                const [ax, ay] = toScreen(wx(na), wy(na));
                const [bx, by] = toScreen(wx(nb), wy(nb));
                ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
            }
            ctx.stroke();
        }

        // query edges
        ctx.strokeStyle = COL_QEDGE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const e of queryEdges) {
            const qn = queryNodes[e.q], dn = nodes[e.db];
            if (!qn || !dn || hid.has(dn.source)) continue;
            const [ax, ay] = toScreen(wx(qn), wy(qn));
            const [bx, by] = toScreen(wx(dn), wy(dn));
            ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        }
        ctx.stroke();

        // db nodes
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (hid.has(n.source)) continue;
            const [sx, sy] = toScreen(wx(n), wy(n));
            if (sx < -10 || sy < -10 || sx > w + 10 || sy > h + 10) continue;
            const uid = 'd' + i;
            const isFocus = uid === focusUid;
            const isNeigh = neigh.has(uid);
            ctx.beginPath();
            ctx.arc(sx, sy, isFocus ? 6 : isNeigh ? 4 : 2.6, 0, Math.PI * 2);
            ctx.fillStyle = isFocus || isNeigh ? COL_HILITE : (SRC_COLORS[n.source] || '#8FA3BC');
            ctx.globalAlpha = focus && !isFocus && !isNeigh ? 0.35 : 0.95;
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // query nodes on top
        for (let i = 0; i < queryNodes.length; i++) {
            const n = queryNodes[i];
            const [sx, sy] = toScreen(wx(n), wy(n));
            const isFocus = 'q' + i === focusUid;
            ctx.beginPath();
            ctx.arc(sx, sy, isFocus ? 8 : 6, 0, Math.PI * 2);
            ctx.fillStyle = COL_QUERY;
            ctx.strokeStyle = '#0B1220';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();
        }

        // labels
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const label = (n: { x: number; y: number; id: string }, strong: boolean) => {
            const [sx, sy] = toScreen(wx(n), wy(n));
            const text = n.id.length > 30 ? n.id.slice(0, 29) + '…' : n.id;
            const tw = ctx.measureText(text).width;
            ctx.fillStyle = 'rgba(11,18,32,0.85)';
            ctx.fillRect(sx + 8, sy - 8, tw + 8, 16);
            ctx.fillStyle = strong ? '#E7EDF5' : '#C7D3E3';
            ctx.fillText(text, sx + 12, sy + 0.5);
        };
        if (queryNodes.length > 0 && queryNodes.length <= 40) {
            for (let i = 0; i < queryNodes.length; i++) if ('q' + i !== focusUid) label(queryNodes[i], false);
        }
        if (focus) label(focus.type === 'db' ? nodes[focus.idx] : queryNodes[focus.idx], true);

        ctx.restore();
    }, [nodes, edges, queryNodes, queryEdges, hover, selected]);

    const fit = useCallback(() => {
        const { w, h } = sizeRef.current;
        if (!w) return;
        const pad = 50;
        const k = Math.min((w - pad * 2) / WORLD, (h - pad * 2) / WORLD);
        transformRef.current = { k, x: w / 2 - (WORLD / 2) * k, y: h / 2 - (WORLD / 2) * k };
        draw();
    }, [draw]);

    useEffect(() => {
        const canvas = canvasRef.current, wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const resize = () => {
            const rect = wrap.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            sizeRef.current = { w: rect.width, h: rect.height };
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
            if (!fittedRef.current) { fittedRef.current = true; fit(); } else draw();
        };
        resize();
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, [fit, draw]);

    useEffect(() => { draw(); }, [draw, hidden]);

    const pick = useCallback((sx: number, sy: number): PickResult | null => {
        const t = transformRef.current;
        const hid = hiddenRef.current;
        const rq = (12 / t.k), rd = (7 / t.k);
        const [mx, my] = [(sx - t.x) / t.k, (sy - t.y) / t.k];
        // query first
        let best: PickResult | null = null, bestD = Infinity;
        for (let i = 0; i < queryNodes.length; i++) {
            const dx = wx(queryNodes[i]) - mx, dy = wy(queryNodes[i]) - my;
            const d = dx * dx + dy * dy;
            if (d < rq * rq && d < bestD) { best = { type: 'query', idx: i }; bestD = d; }
        }
        if (best) return best;
        for (let i = 0; i < nodes.length; i++) {
            if (hid.has(nodes[i].source)) continue;
            const dx = wx(nodes[i]) - mx, dy = wy(nodes[i]) - my;
            const d = dx * dx + dy * dy;
            if (d < rd * rd && d < bestD) { best = { type: 'db', idx: i }; bestD = d; }
        }
        return best;
    }, [nodes, queryNodes]);

    const rel = (e: React.PointerEvent | React.WheelEvent) => {
        const r = canvasRef.current!.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    };

    const onDown = (e: React.PointerEvent) => {
        const [sx, sy] = rel(e);
        const p = pick(sx, sy);
        if (p) setSelected(p);
        else { setSelected(null); panRef.current = { on: true, sx, sy }; }
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onMove = (e: React.PointerEvent) => {
        const [sx, sy] = rel(e);
        const pan = panRef.current;
        if (pan?.on) {
            transformRef.current.x += sx - pan.sx;
            transformRef.current.y += sy - pan.sy;
            pan.sx = sx; pan.sy = sy;
            draw();
            return;
        }
        const p = pick(sx, sy);
        if (p) setHover({ pick: p, x: sx, y: sy });
        else if (hover) setHover(null);
    };
    const onUp = () => { panRef.current = null; };
    const onWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const [sx, sy] = rel(e);
        const t = transformRef.current;
        const k = Math.max(0.1, Math.min(12, t.k * Math.exp(-e.deltaY * 0.0015)));
        t.x = sx - ((sx - t.x) / t.k) * k;
        t.y = sy - ((sy - t.y) / t.k) * k;
        t.k = k;
        draw();
    };

    const toggleSource = (key: string) => {
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const hn = hover ? (hover.pick.type === 'db' ? nodes[hover.pick.idx] : queryNodes[hover.pick.idx]) : null;

    return (
        <div className="net-wrap" ref={wrapRef}>
            <canvas
                ref={canvasRef}
                className="net-canvas"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={() => { onUp(); setHover(null); }}
                onWheel={onWheel}
            />

            <div className="net-legend">
                {sources.map((s) => (
                    <button
                        key={s.key}
                        className={`net-legend-item ${hidden.has(s.key) ? 'off' : ''}`}
                        onClick={() => toggleSource(s.key)}
                        title="Toggle database"
                    >
                        <i style={{ background: SRC_COLORS[s.key] || '#8FA3BC' }} />
                        {s.key} <span className="net-count">{s.count}</span>
                    </button>
                ))}
                {queryNodes.length > 0 && (
                    <span className="net-legend-item static"><i style={{ background: COL_QUERY }} /> your motifs <span className="net-count">{queryNodes.length}</span></span>
                )}
            </div>

            <div className="net-controls">
                <button onClick={() => { fittedRef.current = false; fit(); }}>Fit</button>
            </div>
            <div className="net-hint">scroll to zoom · drag to pan · hover a node for its logo</div>

            {hover && hn && (() => {
                // Partner motif to align against: best DB match for a query node,
                // or the nearest relative for a DB node.
                let partner: DbNode | null = null;
                let relLabel = '';
                let relScore: number | undefined;
                if (hover.pick.type === 'query') {
                    const q = queryNodes[hover.pick.idx];
                    if (q.bestDbIndex != null) partner = nodes[q.bestDbIndex] || null;
                    relLabel = 'best match';
                    relScore = q.bestScore;
                } else {
                    const dn = nodes[hover.pick.idx];
                    if (dn.nn != null && dn.nn >= 0) partner = nodes[dn.nn] || null;
                    relLabel = 'closest motif';
                    relScore = dn.nns;
                }
                const flip = partner && hn.pwm ? decideAutoRC(hn.pwm, partner.pwm as number[][]) : false;
                return (
                    <div
                        className="net-tooltip"
                        style={{
                            left: Math.min(hover.x + 14, (sizeRef.current.w || 400) - 260),
                            top: Math.min(hover.y + 14, (sizeRef.current.h || 400) - (partner ? 210 : 120)),
                        }}
                    >
                        <div className="net-tooltip-title">
                            <span className="net-dot" style={{ background: hover.pick.type === 'db' ? (SRC_COLORS[(hn as DbNode).source] || '#8FA3BC') : COL_QUERY }} />
                            {hn.id}
                        </div>
                        {hn.pwm && (
                            <div className="net-tooltip-logo">
                                <MotifLogo pwm={hn.pwm} height={50} glyphWidth={16} fit="fill" width="100%" />
                            </div>
                        )}
                        {partner && partner.pwm ? (
                            <>
                                <div className="net-align-mid">
                                    {relLabel}{relScore != null ? ` · r=${relScore.toFixed(2)}` : ''}
                                    <span className="net-align-name">{partner.id}{flip ? ' (rc)' : ''}</span>
                                </div>
                                <div className="net-tooltip-logo">
                                    <MotifLogo pwm={partner.pwm} rc={flip} height={50} glyphWidth={16} fit="fill" width="100%" />
                                </div>
                            </>
                        ) : (
                            <div className="net-tooltip-sub">
                                {hover.pick.type === 'db' ? `${(hn as DbNode).source} database` : 'your motif / filter'}
                            </div>
                        )}
                    </div>
                );
            })()}
        </div>
    );
}
