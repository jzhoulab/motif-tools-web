// Server-side sequence logo: letter heights proportional to information content, so the
// atlas pages show the same picture the tools draw in canvas.
const LET = ['A', 'C', 'G', 'T'];
const COL = { A: '#109648', C: '#255C99', G: '#F7B32B', T: '#D62828' };
// Advance widths of the DejaVu-ish monospace fallback are close enough that a simple
// horizontal scale keeps each glyph inside its column.
export function logoSvg(pwm, { height = 84, colW = 15, pad = 2 } = {}) {
    const L = pwm[0].length;
    const w = L * colW + pad * 2, h = height + 18;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`];
    parts.push(`<rect width="${w}" height="${h}" fill="none"/>`);
    for (let i = 0; i < L; i++) {
        let ent = 0;
        for (let b = 0; b < 4; b++) { const p = pwm[b][i]; if (p > 0) ent -= p * Math.log2(p); }
        const ic = Math.max(0, 2 - ent) / 2;                       // 0..1
        const order = [0, 1, 2, 3].map((b) => ({ b, p: pwm[b][i] })).sort((a, z) => a.p - z.p);
        let y = h - 18;                                            // stack upward from the axis
        for (const { b, p } of order) {
            const lh = p * ic * height;
            if (lh < 0.6) continue;
            y -= lh;
            const cx = pad + i * colW + colW / 2;
            // A 100px-tall glyph scaled to lh: keeps the shape crisp at any height.
            parts.push(`<g transform="translate(${cx.toFixed(2)} ${(y + lh).toFixed(2)}) scale(${(colW / 12.6).toFixed(4)} ${(lh / 14.5).toFixed(4)})">`
                + `<text x="0" y="0" text-anchor="middle" font-family="'JetBrains Mono',ui-monospace,monospace" font-weight="700" font-size="20" fill="${COL[LET[b]]}">${LET[b]}</text></g>`);
        }
    }
    parts.push(`<line x1="${pad}" y1="${h - 18}" x2="${w - pad}" y2="${h - 18}" stroke="#23324A" stroke-width="1"/>`);
    parts.push('</svg>');
    return parts.join('');
}
