// Minimal Markdown -> HTML for the family atlas pages. We only support the subset the
// entries use (headings, paragraphs, lists, bold/italic/code, links), and we escape
// first, so nothing an entry contains can inject markup.
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
    return esc(s)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
}
export function md(src) {
    const out = [];
    let list = null, para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of String(src || '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) { flushPara(); flushList(); continue; }
        const h = line.match(/^(#{2,4})\s+(.*)$/);
        if (h) { flushPara(); flushList(); const lv = h[1].length; out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); continue; }
        const li = line.match(/^[-*]\s+(.*)$/);
        if (li) { flushPara(); if (list !== 'ul') { flushList(); list = 'ul'; out.push('<ul>'); } out.push(`<li>${inline(li[1])}</li>`); continue; }
        const ol = line.match(/^\d+[.)]\s+(.*)$/);
        if (ol) { flushPara(); if (list !== 'ol') { flushList(); list = 'ol'; out.push('<ol>'); } out.push(`<li>${inline(ol[1])}</li>`); continue; }
        flushList();
        para.push(line);
    }
    flushPara(); flushList();
    return out.join('\n');
}
