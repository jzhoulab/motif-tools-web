import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import MotifLogo from './MotifLogo';
import { getRC, bestShift } from '../utils/alignment';

export interface DbNode {
    id: string;
    source: string;
    x: number; // normalized 0..1
    y: number;
    pwm?: number[][];
    nn?: number;   // index of nearest relative (for hover alignment)
    nns?: number;  // its correlation
    c?: number;    // cluster id (-1 = not in a coloured cluster)
}

// Colour for a cluster id via golden-angle hue rotation (locally distinct).
const clusterHue = (c: number) => (c * 137.508) % 360;
function clusterColor(c: number | undefined): string {
    if (c == null || c < 0) return '#4a5a70';
    return `hsl(${clusterHue(c).toFixed(0)} 60% 62%)`;
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

export interface Cluster {
    c: number;
    label: string;
    size: number;
    x: number;
    y: number;
}

interface Props {
    nodes: DbNode[];
    edges: number[][]; // [i, j] or [i, j, correlation]
    queryNodes: QueryNode[];
    queryEdges: QueryEdge[];
    sources: { key: string; count: number }[];
    clusters: Cluster[];
}

const MAX_CLIQUE_LOGOS = 8;

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

export default function NetworkView({ nodes, edges, queryNodes, queryEdges, sources, clusters }: Props) {
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
    const [colorMode, setColorMode] = useState<'cluster' | 'source'>('cluster');
    const colorModeRef = useRef(colorMode);
    colorModeRef.current = colorMode;

    // soft "territory" blobs, one per coloured cluster (normalized coords)
    const blobs = useMemo(() => {
        const g = new Map<number, { xs: number[]; ys: number[] }>();
        for (const nd of nodes) {
            if (nd.c == null || nd.c < 0) continue;
            let e = g.get(nd.c);
            if (!e) { e = { xs: [], ys: [] }; g.set(nd.c, e); }
            e.xs.push(nd.x); e.ys.push(nd.y);
        }
        const out: { hue: number; cx: number; cy: number; r: number }[] = [];
        for (const [c, e] of g) {
            const cx = e.xs.reduce((a, b) => a + b, 0) / e.xs.length;
            const cy = e.ys.reduce((a, b) => a + b, 0) / e.ys.length;
            let r = 0;
            for (let k = 0; k < e.xs.length; k++) r = Math.max(r, Math.hypot(e.xs[k] - cx, e.ys[k] - cy));
            out.push({ hue: clusterHue(c), cx, cy, r: r + 0.012 });
        }
        return out;
    }, [nodes]);

    // adjacency: db node index -> its clique neighbours sorted by correlation
    const adj = useMemo(() => {
        const m = new Map<number, { idx: number; w: number }[]>();
        for (const e of edges) {
            const a = e[0], b = e[1], w = e.length > 2 ? e[2] : 0;
            (m.get(a) || m.set(a, []).get(a)!).push({ idx: b, w });
            (m.get(b) || m.set(b, []).get(b)!).push({ idx: a, w });
        }
        for (const list of m.values()) list.sort((p, q) => q.w - p.w);
        return m;
    }, [edges]);

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
        const cmode = colorModeRef.current;
        const t = transformRef.current;

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // soft territory blobs behind everything (cluster colour mode; dimmed while focused)
        if (cmode === 'cluster') {
            const blobA = focus ? 0.12 : 0.22;
            for (const bl of blobs) {
                const [sx, sy] = toScreen(bl.cx * WORLD, bl.cy * WORLD);
                const rr = bl.r * WORLD * t.k;
                if (rr < 7) continue;
                const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
                g.addColorStop(0, `hsla(${bl.hue.toFixed(0)} 60% 55% / ${blobA})`);
                g.addColorStop(1, `hsla(${bl.hue.toFixed(0)} 60% 55% / 0)`);
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(sx, sy, rr, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // db edges (skip if either endpoint hidden, or if the edge spans a long
        // distance in the embedding — those are UMAP "tears" that just add clutter)
        const MAXLEN = 0.09; // in normalized 0..1 coords
        ctx.strokeStyle = COL_EDGE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b] of edges) {
            const na = nodes[a], nb = nodes[b];
            if (hid.has(na.source) || hid.has(nb.source)) continue;
            if (Math.hypot(na.x - nb.x, na.y - nb.y) > MAXLEN) continue;
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
            ctx.arc(sx, sy, isFocus ? 3 : isNeigh ? 2 : 1.3, 0, Math.PI * 2);
            ctx.fillStyle = isFocus || isNeigh ? COL_HILITE : (cmode === 'cluster' ? clusterColor(n.c) : (SRC_COLORS[n.source] || '#8FA3BC'));
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
            ctx.arc(sx, sy, isFocus ? 4 : 3, 0, Math.PI * 2);
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

        // cluster (motif family) names — always shown, like place labels on a map
        if (cmode === 'cluster') {
            const minSize = t.k > 1.3 ? 6 : t.k > 0.7 ? 12 : 20;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = focus ? 0.55 : 1;
            // place labels largest-first, skipping any that would collide (map-style)
            const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
            for (const cl of clusters) {
                if (!cl.label || cl.size < minSize) continue;
                const [sx, sy] = toScreen(cl.x * WORLD, cl.y * WORLD);
                if (sx < -40 || sy < -20 || sx > w + 40 || sy > h + 20) continue;
                const fs = Math.max(11, Math.min(20, 7 + Math.sqrt(cl.size) * 0.8));
                ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
                const tw = ctx.measureText(cl.label).width;
                const box = { x1: sx - tw / 2 - 4, y1: sy - fs / 2 - 2, x2: sx + tw / 2 + 4, y2: sy + fs / 2 + 2 };
                let clash = false;
                for (const p of placed) {
                    if (box.x1 < p.x2 && box.x2 > p.x1 && box.y1 < p.y2 && box.y2 > p.y1) { clash = true; break; }
                }
                if (clash) continue;
                placed.push(box);
                ctx.shadowColor = 'rgba(0,0,0,0.95)';
                ctx.shadowBlur = 5;
                ctx.fillStyle = `hsl(${clusterHue(cl.c).toFixed(0)} 75% 82%)`;
                ctx.fillText(cl.label, sx, sy);
                ctx.shadowBlur = 0;
            }
            ctx.globalAlpha = 1;
        }

        ctx.restore();
    }, [nodes, edges, queryNodes, queryEdges, hover, selected, clusters]);

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

    useEffect(() => { draw(); }, [draw, hidden, colorMode]);

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

    // Non-passive wheel listener so zoom never scrolls or (ctrl+wheel) zooms the page.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const handler = (e: WheelEvent) => {
            e.preventDefault();
            const r = canvas.getBoundingClientRect();
            const sx = e.clientX - r.left, sy = e.clientY - r.top;
            const t = transformRef.current;
            const k = Math.max(0.1, Math.min(12, t.k * Math.exp(-e.deltaY * 0.0015)));
            t.x = sx - ((sx - t.x) / t.k) * k;
            t.y = sy - ((sy - t.y) / t.k) * k;
            t.k = k;
            draw();
        };
        canvas.addEventListener('wheel', handler, { passive: false });
        return () => canvas.removeEventListener('wheel', handler);
    }, [draw]);

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
            />

            <div className="net-legend">
                {colorMode === 'source' ? (
                    sources.map((s) => (
                        <button
                            key={s.key}
                            className={`net-legend-item ${hidden.has(s.key) ? 'off' : ''}`}
                            onClick={() => toggleSource(s.key)}
                            title="Toggle database"
                        >
                            <i style={{ background: SRC_COLORS[s.key] || '#8FA3BC' }} />
                            {s.key} <span className="net-count">{s.count}</span>
                        </button>
                    ))
                ) : (
                    <span className="net-legend-item static">
                        <i style={{ background: 'linear-gradient(90deg,#5B8DEF,#35B0A7,#A78BFA,#EC6A9C)' }} />
                        coloured by motif family <span className="net-count">{blobs.length} clusters</span>
                    </span>
                )}
                {queryNodes.length > 0 && (
                    <span className="net-legend-item static"><i style={{ background: COL_QUERY }} /> your motifs <span className="net-count">{queryNodes.length}</span></span>
                )}
            </div>

            <div className="net-controls">
                <div className="net-colormode">
                    <span>Colour</span>
                    <button className={colorMode === 'cluster' ? 'active' : ''} onClick={() => setColorMode('cluster')}>Family</button>
                    <button className={colorMode === 'source' ? 'active' : ''} onClick={() => setColorMode('source')}>Database</button>
                </div>
                <button onClick={() => { fittedRef.current = false; fit(); }}>Fit</button>
            </div>
            <div className="net-hint">scroll to zoom · drag to pan · hover a node for its logo</div>

            {hover && hn && (() => {
                // Build the clique to show: the hovered motif first, then its
                // neighbours (DB node -> its clique; query node -> its matches),
                // every logo reverse-complemented to the hovered motif's direction.
                const refPwm = (hn.pwm as number[][] | undefined);
                // No matrix for this node (shouldn't happen, but never crash the view)
                if (!refPwm || !refPwm[0]?.length) {
                    return (
                        <div
                            className="net-tooltip"
                            style={{
                                left: Math.min(hover.x + 14, (sizeRef.current.w || 400) - 260),
                                top: Math.max(8, Math.min(hover.y + 14, (sizeRef.current.h || 400) - 70)),
                            }}
                        >
                            <div className="net-tooltip-title">
                                <span className="net-dot" style={{ background: hover.pick.type === 'db' ? (SRC_COLORS[(hn as DbNode).source] || '#8FA3BC') : COL_QUERY }} />
                                {hn.id}
                            </div>
                        </div>
                    );
                }
                type Row = { id: string; pwm: number[][]; r?: number; self?: boolean; src?: string; query?: boolean };
                const rows: Row[] = [{ id: hn.id, pwm: refPwm, self: true, src: hover.pick.type === 'db' ? (hn as DbNode).source : undefined, query: hover.pick.type === 'query' }];

                if (hover.pick.type === 'query') {
                    const q = queryNodes[hover.pick.idx];
                    const es = queryEdges.filter((e) => e.q === hover.pick.idx).sort((a, b) => (b as any).weight - (a as any).weight);
                    for (const e of es) {
                        const dn = nodes[e.db];
                        if (dn?.pwm) rows.push({ id: dn.id, pwm: dn.pwm, r: (e as any).weight, src: dn.source });
                    }
                    if (rows.length === 1 && q.bestDbIndex != null) {
                        const dn = nodes[q.bestDbIndex];
                        if (dn?.pwm) rows.push({ id: dn.id, pwm: dn.pwm, r: q.bestScore, src: dn.source });
                    }
                } else {
                    const neigh = adj.get(hover.pick.idx) || [];
                    for (const nb of neigh) {
                        const dn = nodes[nb.idx];
                        if (dn?.pwm) rows.push({ id: dn.id, pwm: dn.pwm, r: nb.w, src: dn.source });
                    }
                    if (rows.length === 1 && (hn as DbNode).nn != null && (hn as DbNode).nn! >= 0) {
                        const dn = nodes[(hn as DbNode).nn!];
                        if (dn?.pwm) rows.push({ id: dn.id, pwm: dn.pwm, r: (hn as DbNode).nns, src: dn.source });
                    }
                }
                const extra = rows.length - MAX_CLIQUE_LOGOS;
                const shown = rows.slice(0, MAX_CLIQUE_LOGOS);

                // Orient each row to the reference and compute its offset so the shared
                // core lines up column-by-column across the stacked logos.
                // Orientation AND offset come from the same metric: take whichever
                // strand cross-correlates better with the hovered motif, and use that
                // strand's argmax offset. (A separate RC rule would disagree with the
                // offset and leave logos visibly unaligned.)
                const aligned = shown.map((row) => {
                    if (!row.pwm || !row.pwm[0]?.length) return { row, flip: false, shift: 0, len: 1 };
                    const len = row.pwm[0].length;
                    if (row.self) return { row, flip: false, shift: 0, len };
                    const fwd = bestShift(row.pwm, refPwm);
                    const rev = bestShift(getRC(row.pwm), refPwm);
                    const flip = rev.score > fwd.score;
                    return { row, flip, shift: (flip ? rev : fwd).shift, len };
                });
                let gMin = 0, gMax = refPwm[0].length;
                for (const a of aligned) { gMin = Math.min(gMin, a.shift); gMax = Math.max(gMax, a.shift + a.len); }
                const totalCols = Math.max(1, gMax - gMin);
                const colW = Math.max(6, Math.min(13, 300 / totalCols));
                const frameW = totalCols * colW;
                const tall = 34 + shown.length * 46 + (extra > 0 ? 16 : 0);

                return (
                    <div
                        className="net-tooltip net-clique"
                        style={{
                            width: Math.max(240, frameW + 24),
                            left: Math.min(hover.x + 14, (sizeRef.current.w || 400) - (frameW + 34)),
                            top: Math.max(8, Math.min(hover.y + 14, (sizeRef.current.h || 400) - tall)),
                        }}
                    >
                        <div className="net-tooltip-title">
                            <span className="net-dot" style={{ background: hover.pick.type === 'db' ? (SRC_COLORS[(hn as DbNode).source] || '#8FA3BC') : COL_QUERY }} />
                            {hn.id}
                            {rows.length > 1 && <span className="net-clique-count">{hover.pick.type === 'query' ? `${rows.length - 1} matches` : `clique of ${rows.length}`}</span>}
                        </div>
                        <div className="net-clique-list">
                            {aligned.map((a, i) => (
                                <div className="net-clique-row" key={i}>
                                    <div className="net-clique-logo" style={{ width: frameW }}>
                                        <div style={{ marginLeft: (a.shift - gMin) * colW, width: a.len * colW }}>
                                            <MotifLogo pwm={a.row.pwm} rc={a.flip} height={30} glyphWidth={colW} fit="fill" width={a.len * colW} />
                                        </div>
                                    </div>
                                    <div className="net-clique-meta">
                                        <span className="net-clique-name">
                                            <i className="net-dot" style={{ background: a.row.query ? COL_QUERY : (SRC_COLORS[a.row.src || ''] || '#8FA3BC') }} />
                                            {a.row.id.length > 22 ? a.row.id.slice(0, 21) + '…' : a.row.id}{a.flip ? ' ↺' : ''}
                                        </span>
                                        <span className="net-clique-r">{a.row.self ? 'hovered' : (a.row.r != null ? `r ${a.row.r.toFixed(2)}` : '')}</span>
                                    </div>
                                </div>
                            ))}
                            {extra > 0 && <div className="net-clique-more">+{extra} more in clique</div>}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
