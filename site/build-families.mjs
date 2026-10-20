#!/usr/bin/env node
// Generate the motif family atlas (/families/) from resources/motif-families.json.
// Static pages, same visual language as the landing page, no client-side framework.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { md, esc } from './lib/md.mjs';
import { logoSvg } from './lib/logo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'resources/motif-families.json');

const CSS = `
:root{--ink:#0B1220;--ink-2:#0e1626;--panel:#121C2E;--panel-2:#17233a;--line:#23324A;--line-soft:#1a2740;
--text:#E7EDF5;--muted:#8FA3BC;--muted-2:#64768f;--A:#109648;--C:#255C99;--G:#F7B32B;--T:#D62828;
--cyan:#35c9d6;--maxw:1120px;--radius:14px;
--font-display:'Space Grotesk',system-ui,sans-serif;--font-body:'Inter',system-ui,sans-serif;
--font-mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--text);font-family:var(--font-body);font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
a:hover{color:var(--cyan)}
h1,h2,h3{font-family:var(--font-display);font-weight:600;letter-spacing:-0.02em;line-height:1.12;margin:0}
p{margin:0}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 28px}
.eyebrow{font-family:var(--font-mono);font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
header.top{border-bottom:1px solid var(--line-soft);padding:16px 0;position:sticky;top:0;background:rgba(11,18,32,.88);backdrop-filter:blur(8px);z-index:9}
header.top .wrap{display:flex;align-items:center;gap:22px}
.brand{font-family:var(--font-display);font-weight:700;letter-spacing:-.02em}
.brand .bars{display:inline-flex;gap:2px;margin-right:9px;vertical-align:-1px}
.brand .bars i{width:3px;height:14px;border-radius:2px;display:block}
header.top nav{margin-left:auto;display:flex;gap:20px;font-size:14px;color:var(--muted)}
main{padding:44px 0 90px}
.crumb{font-size:13px;color:var(--muted);margin-bottom:18px;font-family:var(--font-mono)}
.chip{display:inline-block;font-family:var(--font-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 9px}
.cons{font-family:var(--font-mono);font-size:15px;color:var(--cyan);letter-spacing:.06em}
.lead{color:#cfdaea;font-size:18px;margin-top:18px;max-width:74ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(252px,1fr));gap:12px;margin-top:14px}
.card{border:1px solid var(--line-soft);background:var(--panel);border-radius:12px;padding:13px 14px;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--line);transform:translateY(-1px)}
.card .nm{font-family:var(--font-display);font-weight:600;font-size:15px}
.card .cs{font-family:var(--font-mono);font-size:12px;color:var(--cyan);margin-top:3px;word-break:break-all}
.card .ct{font-size:12.5px;color:var(--muted);margin-top:6px;line-height:1.5}
.card .n{float:right;font-family:var(--font-mono);font-size:11px;color:var(--muted-2)}
.classhead{display:flex;align-items:baseline;gap:12px;margin:36px 0 2px;border-top:1px solid var(--line-soft);padding-top:22px}
.classhead h2{font-size:20px}
.classhead .n{font-family:var(--font-mono);font-size:12px;color:var(--muted-2)}
.panel{border:1px solid var(--line-soft);background:var(--panel);border-radius:var(--radius);padding:20px 22px}
.prose{max-width:76ch}
.prose h2{font-size:21px;margin:34px 0 10px}
.prose h3{font-size:17px;margin:22px 0 6px}
.prose p{margin:0 0 13px}
.prose ul,.prose ol{margin:0 0 13px;padding-left:22px;color:#dbe4f0}
.prose li{margin:4px 0}
.prose code{font-family:var(--font-mono);font-size:13.5px;background:var(--panel-2);border:1px solid var(--line-soft);border-radius:5px;padding:1px 5px;color:var(--cyan)}
.prose a{color:var(--cyan);border-bottom:1px solid rgba(53,201,214,.3)}
.caveat{border:1px solid #3a2f1c;background:#1b1710;border-radius:12px;padding:15px 17px;margin:26px 0}
.caveat .eyebrow{color:#d2a344}
table.mem{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:10px}
table.mem th{text-align:left;font-family:var(--font-mono);font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted-2);border-bottom:1px solid var(--line);padding:6px 8px}
table.mem td{border-bottom:1px solid var(--line-soft);padding:6px 8px;vertical-align:top}
table.mem td.c{font-family:var(--font-mono);color:var(--cyan);font-size:12.5px;word-break:break-all}
table.mem td.s{font-family:var(--font-mono);font-size:11.5px;color:var(--muted)}
.flag{font-family:var(--font-mono);font-size:10.5px;border-radius:4px;padding:1px 5px;margin-left:5px;white-space:nowrap}
.flag.x{background:#2a1a1a;color:#e0866f;border:1px solid #4a2a26}
.flag.i{background:#1c2436;color:#8FA3BC;border:1px solid #2a3category}
.flag.w{background:#231d12;color:#c9a35a;border:1px solid #3a2f1c}
.sbars{margin-top:12px}
.sbar-row{display:grid;grid-template-columns:minmax(190px,22ch) 1fr 120px;gap:12px;align-items:center;padding:5px 0}
.sbar-l{font-size:13.5px;color:#cfdaea}
.sbar-track{height:7px;background:var(--panel-2);border-radius:4px;overflow:hidden}
.sbar-fill{display:block;height:100%;background:var(--muted-2);border-radius:4px}
.sbar-fill.ok{background:#3f9e6b}.sbar-fill.warn{background:#c7982f}.sbar-fill.bad{background:#c2604c}
.sbar-n{font-family:var(--font-mono);font-size:12px;color:var(--muted);text-align:right}
.sbar-n i{display:block;font-style:normal;font-size:10.5px;color:var(--muted-2)}
.note{font-size:14px;color:var(--muted);margin-top:10px;max-width:78ch;line-height:1.65}
.note a{color:var(--cyan)}
@media(max-width:640px){.sbar-row{grid-template-columns:1fr 70px}.sbar-track{display:none}}
.checks{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}
.chk{font-family:var(--font-mono);font-size:11px;color:var(--muted);border:1px solid var(--line-soft);border-radius:6px;padding:3px 8px}
.chk a{color:inherit}
.chk.ok{border-color:#1e3a2a;background:#111c16;color:#6fbf8f}
.chk.warn{border-color:#3a2f1c;background:#1b1710;color:#d2a344}
.chk.bad{border-color:#4a2a26;background:#1e1312;color:#e0866f}
.prov{margin:34px 0 0;padding:14px 16px;border:1px solid var(--line-soft);border-left:3px solid var(--muted-2);
background:rgba(255,255,255,.015);border-radius:8px;font-size:13.5px;line-height:1.6;color:var(--muted);max-width:78ch}
.prov-tag{display:block;font-family:var(--font-mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted-2);margin-bottom:5px}
.prov a{color:var(--cyan)}
.feedback{margin:34px 0 0;padding:18px 20px;border:1px solid var(--line-soft);background:var(--panel);border-radius:var(--radius)}
.feedback p{margin-top:8px;font-size:14.5px;color:var(--muted);max-width:74ch}
.fb-btn{border-color:var(--cyan)!important;color:var(--cyan)!important}
.fb-btn:hover{background:rgba(53,201,214,.1)}
.evkey{margin-top:10px;font-size:12.5px;line-height:1.6;color:var(--muted-2)}
.evkey b{color:var(--muted);font-family:var(--font-mono)}
details{margin-top:12px}
summary{cursor:pointer;font-family:var(--font-mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
summary:hover{color:var(--cyan)}
.refs{list-style:none;padding:0;margin:10px 0 0;font-size:14px}
.refs li{padding:7px 0;border-bottom:1px solid var(--line-soft);color:#cfdaea}
.rel{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.rel a{font-family:var(--font-mono);font-size:12px;border:1px solid var(--line);border-radius:999px;padding:4px 10px;color:var(--muted)}
.rel a:hover{border-color:var(--cyan);color:var(--cyan)}
.sbar{display:flex;gap:10px;align-items:center;margin:22px 0 4px}
.sbar input{flex:1;max-width:420px;background:var(--panel);border:1px solid var(--line);border-radius:10px;color:var(--text);
font-family:var(--font-mono);font-size:14px;padding:10px 12px;outline:none}
.sbar input:focus{border-color:var(--cyan)}
.fam-checks{font-family:var(--font-mono);font-size:13px;color:var(--cyan);border-bottom:1px solid rgba(53,201,214,.3);padding-bottom:2px}
.fam-checks:hover{border-color:var(--cyan)}
.logo-wrap{margin:18px 0 6px;padding:12px;border:1px solid var(--line-soft);background:var(--ink-2);border-radius:10px;display:inline-block}
footer{border-top:1px solid var(--line-soft);padding:26px 0;color:var(--muted-2);font-size:13px}
@media(max-width:640px){.wrap{padding:0 16px}main{padding:26px 0 60px}}
`.replace('#2a3category', '#2a3550');

const HEAD = (title, desc, canonical) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:type" content="article"/>
<link rel="canonical" href="${canonical}"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
<style>${CSS}</style></head><body>
<header class="top"><div class="wrap">
<a class="brand" href="/"><span class="bars"><i style="background:var(--A)"></i><i style="background:var(--C)"></i><i style="background:var(--G)"></i><i style="background:var(--T)"></i></span>Motif Tools</a>
<nav><a href="/scan/">Scan</a><a href="/search/">Search</a><a href="/map/">Map</a><a href="/families/">Families</a><a href="/families/methods/">Methods</a><a href="/families/stats/">Stats</a></nav>
</div></header><main><div class="wrap">`;

// Readers who spot an error are the best reviewers this atlas will get. A prefilled
// GitHub issue is the lowest-friction route that leaves a public, trackable record.
const REPO = 'https://github.com/jzhoulab/motif-tools-web';
function feedbackBlock(f) {
    const where = f ? `${f.name} (${f.key})` : 'the family atlas';
    const url = f ? `https://motif.zhoulab.io/families/${f.key.toLowerCase()}/` : 'https://motif.zhoulab.io/families/';
    const body = [
        `**Page:** ${url}`,
        f ? `**Family:** ${f.name} (\`${f.key}\`)` : '',
        '',
        '**What is wrong**',
        '',
        '',
        '**What it should say**',
        '',
        '',
        '**Source** (PMID, DOI or link, if you have one)',
        '',
    ].filter((l) => l !== null).join('\n');
    const href = `${REPO}/issues/new?title=${encodeURIComponent(`Atlas correction: ${where}`)}`
        + `&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('family atlas')}`;
    return `<div class="feedback">
<div class="eyebrow">Spotted something wrong?</div>
<p>These entries are written from the primary literature and every citation is checked against PubMed, but ${f ? 'this one' : 'any of them'} can still be out of date, too confident, or simply wrong &mdash; especially where a motif&rsquo;s published site and its database matrices disagree. Corrections and additions are welcome, and they are the fastest way to make ${f ? 'this page' : 'the atlas'} better for everyone.</p>
<div class="rel"><a class="fb-btn" href="${href}" rel="noopener" target="_blank">Suggest a correction &rarr;</a><a href="${REPO}/issues" rel="noopener" target="_blank">See open corrections</a></div>
</div>`;
}

const FOOT = (extra = '') => `</div></main>
<footer><div class="wrap">Motif family atlas · <a href="/">Motif Tools</a> · Zhou Lab ·
<a href="https://github.com/jzhoulab/motif-tools-web">source</a>${extra}</div></footer></body></html>`;

// HOCOMOCO v14 encodes how a motif was measured in its id: one letter per assay type,
// then a quality grade where A means at least two assay types agreed. Spelling this out
// is the quickest way for a reader to see whether a matrix rests on in vitro binding or
// only on ChIP, where the motif may belong to a partner factor.
const EVIDENCE = { P: 'ChIP-seq', S: 'HT-SELEX', M: 'methyl-HT-SELEX', G: 'GHT-SELEX', I: 'SMiLE-seq', B: 'PBM' };
const evidenceTitle = (letters, grade) => {
    const named = [...String(letters || '')].map((c) => EVIDENCE[c]).filter(Boolean);
    const how = named.length ? named.join(' + ') : 'unspecified assay';
    const g = grade ? `, quality grade ${grade}${grade === 'A' ? ' (two or more assay types)' : ''}` : '';
    return `${how}${g}`;
};

// Every entry here was drafted by a language model reading the primary literature, then
// checked mechanically. Saying so on each page is the minimum a reader is owed; the
// methods page gives the full account.
const PROVENANCE = `<div class="prov"><span class="prov-tag">how this page was made</span>
Drafted by a language model reading the primary literature, then checked: every cited PMID
is resolved against PubMed and its citation text regenerated from PubMed's own record, and
every claim about the motifs themselves is checked against the matrices in the four source
databases. <a href="/families/methods/">Methods and limits &rarr;</a></div>`;

function memberRows(members) {
    return members.map((m) => {
        const flags = [];
        if (m.prov?.species) flags.push(`<span class="flag i" title="motif transferred from another species' protein with ${Math.round((m.prov.dbdIdentity || 0) * 100)}% DNA-binding-domain identity">${esc(m.prov.species)} ${m.prov.dbdIdentity ?? ''}</span>`);
        if (m.prov?.evidence) {
            const chip = `<span class="flag ${/^P+$/.test(m.prov.evidence) ? 'w' : 'i'}" title="${esc(evidenceTitle(m.prov.evidence, m.prov.grade))}">${esc(m.prov.evidence)}${esc(m.prov.grade || '')}</span>`;
            flags.push(chip);
        }
        if (m.prov?.dimer) flags.push('<span class="flag i" title="motif of a heterodimer">dimer</span>');
        if (m.suspect) flags.push(`<span class="flag x" title="this motif's closest relatives across all four databases belong to the ${esc(m.altFamily || 'another')} family, so the label and the matrix may disagree">looks like ${esc(m.altFamily || '?')}</span>`);
        return `<tr><td>${esc(m.id)}${flags.join('')}</td><td class="s">${esc(m.source)}</td><td class="c">${esc(m.consensus)}</td><td class="s">${m.bits ?? ''}</td></tr>`;
    }).join('\n');
}

export function buildFamilies(dist) {
    if (!existsSync(SRC)) { console.warn('! resources/motif-families.json not found - skipping /families/'); return 0; }
    const data = JSON.parse(readFileSync(SRC, 'utf8'));
    const fams = data.families.filter((f) => f.n > 0);
    const written = [];
    const nMotifsAll = fams.reduce((s, f) => s + f.n, 0);
    mkdirSync(resolve(dist, 'families'), { recursive: true });

    for (const f of fams) {
        const dir = resolve(dist, 'families', f.key.toLowerCase());
        mkdirSync(dir, { recursive: true });
        const related = fams.filter((g) => g.class === f.class && g.key !== f.key).slice(0, 12);
        const bySrc = Object.entries(f.bySource || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
        const title = `${f.name} — motif family`;
        const desc = (f.short || f.def || '').replace(/\s+/g, ' ').slice(0, 195);
        const logo = f.repPwm ? `<div class="logo-wrap">${logoSvg(f.repPwm, { height: 74, colW: 16 })}</div>` : '';
        // What the matrices say about this entry, independently of what it says about itself.
        const ev = { chip: 0, vitro: 0, transfer: 0, suspect: 0 };
        for (const m of f.members || []) {
            if (m.prov?.evidence) { if (/^P+$/.test(m.prov.evidence)) ev.chip++; else ev.vitro++; }
            if (m.prov?.species) ev.transfer++;
            if (m.suspect) ev.suspect++;
        }
        const cohesionWord = f.cohesion == null ? null
            : f.cohesion >= 0.75 ? ['tight', 'ok'] : f.cohesion >= 0.5 ? ['loose', 'warn'] : ['not one motif', 'bad'];
        const checks = [
            cohesionWord && `<span class="chk ${cohesionWord[1]}" title="median similarity of members to the family's representative motif">members ${cohesionWord[0]} · ${f.cohesion}</span>`,
            f.consensusChip && f.dataConsensus
                ? `<span class="chk ok" title="the consensus this entry states, next to the one computed from the member matrices">stated ${esc(f.consensusChip)} · data ${esc(f.dataConsensus)}</span>`
                : `<span class="chk warn" title="this entry declines to state a single consensus">no single consensus</span>`,
            ev.vitro ? `<span class="chk ok" title="HOCOMOCO matrices with in vitro support (HT-SELEX, methyl-HT-SELEX, PBM, SMiLE-seq)">${ev.vitro} in vitro</span>` : '',
            ev.chip ? `<span class="chk warn" title="ChIP-only matrices: they record where the protein was crosslinked, not necessarily a sequence it binds">${ev.chip} ChIP-only</span>` : '',
            ev.transfer ? `<span class="chk warn" title="motifs measured on a non-human protein and transferred by DNA-binding-domain similarity">${ev.transfer} cross-species</span>` : '',
            ev.suspect ? `<span class="chk bad" title="their nearest relatives across all four databases belong to another family"><a href="/families/label-checks/">${ev.suspect} label conflict${ev.suspect === 1 ? '' : 's'}</a></span>` : '',
            `<span class="chk">${(f.refs || []).length} references, all PMIDs verified</span>`,
        ].filter(Boolean).join('');
        const html = HEAD(title, desc, `https://motif.zhoulab.io/families/${f.key.toLowerCase()}/`)
            + `<div class="crumb"><a href="/families/">Family atlas</a> / ${esc(f.class)}</div>`
            + `<h1>${esc(f.name)}</h1>`
            + `<div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">`
            + `<span class="chip">${esc(f.class)}</span>`
            + (f.consensusChip ? `<span class="cons">${esc(f.consensusChip)}</span>` : '')
            + `<span class="chip">${f.n} motifs</span>`
            + (f.aka?.length ? `<span class="chip">aka ${esc(f.aka.slice(0, 3).join(', '))}</span>` : '')
            + `</div>`
            + logo
            + (f.repPwm ? `<div class="eyebrow" style="margin-bottom:6px">representative: ${esc(f.representative)} · data consensus ${esc(f.dataConsensus || '')}</div>` : '')
            + (f.consensus && !f.consensusChip ? `<p class="lead" style="font-size:15px"><b>Consensus:</b> ${esc(f.consensus)}</p>` : '')
            + `<div class="checks">${checks}</div>`
            + (f.short ? `<p class="lead">${esc(f.short)}</p>` : `<p class="lead">${esc(f.def)}</p>`)
            + `<div class="prose">${md(f.long || '')}</div>`
            + (f.caveats ? `<div class="caveat"><div class="eyebrow">How much to trust a hit</div><p style="margin-top:8px">${esc(f.caveats)}</p></div>` : '')
            + (f.refs?.length ? `<h2 style="font-size:19px;margin-top:30px">References</h2><ul class="refs">`
                + f.refs.map((r) => `<li>${esc(r.cite)}${r.url ? ` <a href="${esc(r.url)}" rel="noopener nofollow">${r.pmid ? 'PMID ' + esc(r.pmid) : 'link'}</a>` : ''}</li>`).join('') + `</ul>` : '')
            + `<details><summary>${f.n} motifs in this family — ${esc(bySrc)}</summary>`
            + `<table class="mem"><thead><tr><th>motif</th><th>database</th><th>consensus</th><th>bits</th></tr></thead><tbody>`
            + memberRows(f.members || []) + `</tbody></table>`
            + `<p class="evkey">HOCOMOCO tags read as assay + quality grade: <b>P</b> ChIP-seq, <b>S</b> HT-SELEX, <b>M</b> methyl-HT-SELEX, <b>G</b> GHT-SELEX, <b>I</b> SMiLE-seq, <b>B</b> PBM; grade <b>A</b> means two or more assay types agreed. A <b>P</b>-only matrix is a record of where the protein was crosslinked, which need not be a sequence it binds itself.</p>`
            + `</details>`
            + (f.symbols?.length ? `<h2 style="font-size:19px;margin-top:30px">The factors, elsewhere</h2>`
                + `<div class="rel">` + f.symbols.slice(0, 40).map((g) =>
                    `<a href="https://www.genenames.org/tools/search/#!/?query=${encodeURIComponent(g)}" rel="noopener nofollow" title="HGNC, UniProt and linked records for ${esc(g)}">${esc(g)}</a>`).join('')
                + (f.symbols.length > 40 ? `<span class="chk">+${f.symbols.length - 40} more</span>` : '')
                + `</div>` : '')
            + `<div class="rel" style="margin-top:10px">`
            + `<a href="https://jaspar.elixir.no/search?q=${encodeURIComponent((f.symbols || [])[0] || f.name)}" rel="noopener nofollow">Find these in JASPAR →</a>`
            + `<a href="https://hocomoco14.autosome.org/search?query=${encodeURIComponent((f.symbols || [])[0] || '')}" rel="noopener nofollow">in HOCOMOCO →</a>`
            + `<a href="/families/${f.key.toLowerCase()}.json">this entry as JSON →</a>`
            + `</div>`
            + PROVENANCE
            + feedbackBlock(f)
            + (related.length ? `<h2 style="font-size:19px;margin-top:30px">Other ${esc(f.class)} families</h2><div class="rel">`
                + related.map((g) => `<a href="/families/${g.key.toLowerCase()}/">${esc(g.name)}</a>`).join('') + `</div>` : '')
            + `<div class="rel" style="margin-top:26px"><a href="/map/">See this family on the motif map →</a><a href="/search/">Search your motif against the databases →</a></div>`
            + FOOT();
        writeFileSync(resolve(dir, 'index.html'), html);
        // the same record as data: everything the page shows, minus the HTML
        writeFileSync(resolve(dist, 'families', `${f.key.toLowerCase()}.json`), JSON.stringify({
            key: f.key, name: f.name, class: f.class, aka: f.aka, definition: f.def,
            consensus: f.consensus || null, dataConsensus: f.dataConsensus || null,
            motifCount: f.n, bySource: f.bySource, symbols: f.symbols,
            representative: f.representative, cohesion: f.cohesion,
            short: f.short, long: f.long, caveats: f.caveats, references: f.refs,
            members: f.members,
            url: `https://motif.zhoulab.io/families/${f.key.toLowerCase()}/`,
            generated: data.generated,
            provenance: 'Entry text drafted by a language model reading the primary literature; every cited PMID verified against PubMed. Computed fields derive from JASPAR 2024, HOCOMOCO v14, CIS-BP and the Vierstra archetypes. See https://motif.zhoulab.io/families/methods/',
        }, null, 1));
        written.push(f.key);
    }

    writeFileSync(resolve(dist, 'families', 'index.json'), JSON.stringify({
        generated: data.generated,
        families: fams.length,
        motifs: fams.reduce((a, f) => a + f.n, 0),
        methods: 'https://motif.zhoulab.io/families/methods/',
        entries: fams.map((f) => ({
            key: f.key, name: f.name, class: f.class, motifCount: f.n,
            consensus: f.consensus || null, cohesion: f.cohesion,
            url: `https://motif.zhoulab.io/families/${f.key.toLowerCase()}/`,
            json: `https://motif.zhoulab.io/families/${f.key.toLowerCase()}.json`,
        })),
    }, null, 1));

    // ---- methods and limits ----
    const stat = {
        families: fams.length,
        motifs: fams.reduce((a, f) => a + f.n, 0),
        classes: new Set(fams.map((f) => f.class)).size,
        refs: fams.reduce((a, f) => a + (f.refs || []).length, 0),
        pmids: new Set(fams.flatMap((f) => (f.refs || []).map((r) => r.pmid).filter(Boolean).map(String))).size,
        noConsensus: fams.filter((f) => !f.consensusChip).length,
        lowCohesion: fams.filter((f) => f.cohesion != null && f.cohesion < 0.5).length,
    };
    const counts = { suspect: 0, transfer: 0, resembles: 0, inferred: 0, generic: 0, chipOnly: 0, withEvidence: 0 };
    for (const f of fams) for (const m of f.members || []) {
        if (m.suspect) counts.suspect++;
        if (m.prov?.species) counts.transfer++;
        if (m.resembles) counts.resembles++;
        if (m.familyFromData) counts.inferred++;
        if (m.genericLabel) counts.generic++;
        if (m.prov?.evidence) { counts.withEvidence++; if (/^P+$/.test(m.prov.evidence)) counts.chipOnly++; }
    }
    const methods = HEAD('How the motif family atlas was made — Motif Tools',
        `How the ${stat.families} family entries were written and checked, what was verified mechanically, and what was not.`,
        'https://motif.zhoulab.io/families/methods/')
        + `<div class="crumb"><a href="/families/">Family atlas</a> / methods</div>`
        + `<h1>How this atlas was made</h1>`
        + `<p class="lead">The ${stat.families} entries here were <b>drafted by language models reading the primary literature</b>, then checked mechanically against PubMed and against the motif matrices themselves. This page says exactly what that means, what is verified and what is not, and where the weak points are. Read any entry with that in mind.</p>`

        + `<div class="prose">`
        + md(`
## What is generated and what is computed

Two different things sit on every family page, and they have different reliability.

**Computed from the matrices** — the member list, the data consensus, the representative motif, the cohesion value, the evidence tags, the cross-species transfer flags, and every entry on the [label checks](/families/label-checks/) page. These are arithmetic over the ${stat.motifs.toLocaleString()} motifs in JASPAR 2024, HOCOMOCO v14, CIS-BP and the Vierstra archetypes. They are reproducible from the repository and do not involve a language model.

**Written by a model** — the short summary, the long entry, the caveats, and the choice of which papers to cite. Each family was written by an agent that read its computed data file first, then searched the literature and wrote from what it retrieved.

## What is checked

- **Every citation.** All ${stat.pmids.toLocaleString()} distinct PMIDs behind the ${stat.refs.toLocaleString()} references resolve against PubMed, and each one names an author the citation claims. The printed citation text is then *regenerated from PubMed's own record*, so what you read cannot drift from the identifier beside it. A wrong identifier surfaces as a mismatch rather than sitting there looking plausible.
- **Structure.** Every entry carries the five required sections in order, within set word budgets, with at least six references.
- **Claims about the motifs.** Where an entry states a consensus, it is compared with the consensus computed from the member matrices. ${stat.noConsensus} families state that they have **no single consensus** rather than being given one, and the pages and the map show that instead of substituting the medoid.

## What is not checked

- **Whether a sentence is a fair reading of the paper it cites.** The citation is verified to exist and to be the paper named. That it supports the specific claim is not mechanically verified.
- **Claims with no citation.** Several entries state textbook background without a reference, because the reference list is capped at twelve. Those sentences rest on the model's training, not on a retrieved source.
- **Completeness.** No claim is made that an entry covers the important literature for its family, only that what it cites is real.

## Known weak points

- **${stat.lowCohesion} families are buckets, not motifs.** Their members do not resemble one another (cohesion below 0.5), and the KRAB zinc-finger, unnamed-archetype and "other" entries say so in their first sentence. A hit to one of these identifies a kind of thing, not a site.
- **${counts.chipOnly} of ${counts.withEvidence} HOCOMOCO matrices are ChIP-only.** A ChIP-derived matrix records where a protein was crosslinked, which need not be a sequence it binds itself. Those are flagged in amber in every member table.
- **${counts.transfer} CIS-BP entries are inherited from a non-human protein**, down to 55% DNA-binding-domain identity — the human RFX8 motif comes from a louse. Each is labelled with its species and identity.
- **${counts.suspect} motifs sit under a label their own matrix contradicts**, and ${counts.resembles} uncharacterised zinc-finger motifs are essentially a known family's motif. Both are listed on the [label checks](/families/label-checks/) page rather than quietly corrected.
- **Family assignment is from the label, not the matrix.** A motif's family comes from the protein name it carries, routed through a curated gene-symbol table. Only ${counts.inferred} of the ${stat.motifs.toLocaleString()} were assigned from similarity instead, and a further ${counts.generic} carry a label so generic ("ZNF") that they are grouped as unnamed archetypes rather than placed. That independence from the matrices is what makes the label checks possible — but it also means a mislabelled matrix lands in the wrong family until someone notices.

## Reproducing it

Everything is in [the repository](https://github.com/jzhoulab/motif-tools-web): the family ontology, the gene-symbol assignment tables, the written entries as JSON, and the scripts. \`npm run families\` rebuilds the assignment and the merged atlas, \`npm test\` runs the integrity checks, and \`verify-refs.mjs\` re-checks every citation against PubMed.

## Corrections

If something here is wrong, it probably is somewhere. Corrections are the fastest way to fix it, and they are public.
`)
        + `</div>`
        + feedbackBlock(null)
        + `<div class="rel" style="margin-top:26px"><a href="/families/">Back to the family atlas →</a><a href="/families/label-checks/">Label checks →</a></div>`
        + FOOT();
    mkdirSync(resolve(dist, 'families', 'methods'), { recursive: true });
    writeFileSync(resolve(dist, 'families', 'methods', 'index.html'), methods);

    // ---- label checks: where the data disagrees with the name on a motif ----
    const conflicts = [], transfers = [], resembles = [];
    for (const f of fams) for (const m of f.members || []) {
        if (m.suspect && m.altFamily) conflicts.push({ ...m, fam: f });
        if (m.prov?.species) transfers.push({ ...m, fam: f });
        if (m.resembles) resembles.push({ ...m, fam: f });
    }
    const nameOf = (key) => fams.find((g) => g.key === key)?.name || key;
    const linkOf = (key) => `<a href="/families/${String(key).toLowerCase()}/">${esc(nameOf(key))}</a>`;
    transfers.sort((a, b) => (a.prov.dbdIdentity || 1) - (b.prov.dbdIdentity || 1));
    // A homeodomain matrix filed under one position-50 class matching another is
    // expected - those families are split on a specificity that many matrices sit
    // between. Cross-class disagreements are the interesting ones, so lead with them.
    // Treat the whole homeodomain superfamily as one class here: POU, TALE, CUT, SIX,
    // paired and Prospero domains all read a TAAT-type core, so a swap between them is
    // the ordinary blurriness of the split, not a surprise.
    const classOf = (key) => {
        const c = fams.find((g) => g.key === key)?.class || '';
        return /homeodomain|^POU|Paired box|Prospero/i.test(c) ? 'homeodomain' : c;
    };
    const crossClass = (m) => classOf(m.fam.key) !== classOf(m.altFamily);
    conflicts.sort((a, b) => (crossClass(b) ? 1 : 0) - (crossClass(a) ? 1 : 0));
    const nCross = conflicts.filter(crossClass).length;
    const checks = HEAD('When a motif\u2019s name and its matrix disagree — Motif Tools',
        `Every motif compared against all ${nMotifsAll - 1} others: ${conflicts.length} whose closest relatives contradict the factor name they carry, and ${transfers.length} inherited from a non-human protein.`,
        'https://motif.zhoulab.io/families/label-checks/')
        + `<div class="crumb"><a href="/families/">Family atlas</a> / label checks</div>`
        + `<h1>When the name and the matrix disagree</h1>`
        + `<p class="lead">The factor name attached to a motif is a claim about what binds it, and the claim is only as good as the experiment behind it. Comparing every one of the ${nMotifsAll.toLocaleString()} motifs in this atlas against all the others makes three kinds of disagreement visible. None of them means a database is wrong — a ChIP experiment faithfully reports what was crosslinked, which is not always the tagged protein.</p>`

        + `<h2 style="font-size:21px;margin-top:34px">Closest relatives contradict the label</h2>`
        + `<p class="lead" style="font-size:15px;color:var(--muted)">${conflicts.length} motifs whose nearest matches across all four databases belong to a different family than their own name, while nothing in their own family comes close. Frequently these are composite elements or indirect binding: a factor recruited to another factor's site reports that site's motif. The ${nCross} that cross a structural class are listed first and are the interesting ones; the rest are mostly homeodomain matrices sitting between two specificity classes, which the atlas splits on the single residue at homeodomain position 50.</p>`
        + `<table class="mem"><thead><tr><th>motif</th><th>database</th><th>filed under</th><th>looks like</th><th>consensus</th></tr></thead><tbody>`
        + conflicts.map((m) => `<tr><td>${esc(m.id)}</td><td class="s">${esc(m.source)}</td><td class="s">${linkOf(m.fam.key)}</td><td class="s">${linkOf(m.altFamily)}</td><td class="c">${esc(m.consensus || '')}</td></tr>`).join('')
        + `</tbody></table>`

        + `<h2 style="font-size:21px;margin-top:34px">Motifs inherited from another species</h2>`
        + `<p class="lead" style="font-size:15px;color:var(--muted)">${transfers.length} CIS-BP entries carry a human gene name but were measured on a different organism's protein, and transferred on DNA-binding-domain similarity. The weakest transfers are listed first; a value of 1.00 means an identical DBD.</p>`
        + `<table class="mem"><thead><tr><th>motif</th><th>filed under</th><th>measured in</th><th>DBD identity</th><th>consensus</th></tr></thead><tbody>`
        + transfers.map((m) => `<tr><td>${esc(m.id)}</td><td class="s">${linkOf(m.fam.key)}</td><td class="s">${esc(m.prov.species)}</td><td class="s">${m.prov.dbdIdentity ?? ''}</td><td class="c">${esc(m.consensus || '')}</td></tr>`).join('')
        + `</tbody></table>`

        + `<h2 style="font-size:21px;margin-top:34px">Uncharacterised motifs that match a known family</h2>`
        + `<p class="lead" style="font-size:15px;color:var(--muted)">${resembles.length} motifs from the zinc-finger buckets — where the label says little more than "a zinc finger" — are essentially the motif of a well-defined family. Read these as a lead, not a conclusion: two proteins can share a site.</p>`
        + `<table class="mem"><thead><tr><th>motif</th><th>database</th><th>filed under</th><th>matches</th><th>consensus</th></tr></thead><tbody>`
        + resembles.map((m) => `<tr><td>${esc(m.id)}</td><td class="s">${esc(m.source)}</td><td class="s">${linkOf(m.fam.key)}</td><td class="s">${linkOf(m.resembles)}</td><td class="c">${esc(m.consensus || '')}</td></tr>`).join('')
        + `</tbody></table>`
        + feedbackBlock(null)
        + `<div class="rel" style="margin-top:30px"><a href="/families/">Back to the family atlas →</a></div>`
        + FOOT();
    mkdirSync(resolve(dist, 'families', 'label-checks'), { recursive: true });
    writeFileSync(resolve(dist, 'families', 'label-checks', 'index.html'), checks);

    // ---- stats: the atlas's own numbers, including the unflattering ones ----
    const bar = (label, n, total, tone='') => {
        const pct = total ? (100 * n / total) : 0;
        return `<div class="sbar-row"><span class="sbar-l">${esc(label)}</span>`
            + `<span class="sbar-track"><span class="sbar-fill ${tone}" style="width:${pct.toFixed(1)}%"></span></span>`
            + `<span class="sbar-n">${n.toLocaleString()}<i>${pct.toFixed(1)}%</i></span></div>`;
    };
    const srcCounts = {};
    for (const f of fams) for (const [k, v] of Object.entries(f.bySource || {})) srcCounts[k] = (srcCounts[k] || 0) + v;
    const cohesionBuckets = { 'tight (>=0.75)': 0, 'loose (0.5-0.75)': 0, 'not one motif (<0.5)': 0 };
    for (const f of fams) {
        if (f.cohesion == null) continue;
        if (f.cohesion >= 0.75) cohesionBuckets['tight (>=0.75)']++;
        else if (f.cohesion >= 0.5) cohesionBuckets['loose (0.5-0.75)']++;
        else cohesionBuckets['not one motif (<0.5)']++;
    }
    const refCounts = fams.map((f) => (f.refs || []).length).sort((a, b) => a - b);
    const wordsOf = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
    const longWords = fams.map((f) => wordsOf(f.long));
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const statsPage = HEAD('Motif family atlas — coverage and quality',
        `What the atlas covers, how well, and where it is weakest: ${stat.families} families over ${stat.motifs.toLocaleString()} motifs, ${stat.pmids.toLocaleString()} verified PMIDs.`,
        'https://motif.zhoulab.io/families/stats/')
        + `<div class="crumb"><a href="/families/">Family atlas</a> / coverage and quality</div>`
        + `<h1>Coverage and quality</h1>`
        + `<p class="lead">Every number here is computed from the published atlas by <code>npm test</code> and the build, not quoted from memory. The unflattering ones are included on purpose: an atlas that only reports what it does well is not telling you how much to trust it.</p>`

        + `<h2 style="font-size:20px;margin-top:34px">Coverage</h2>`
        + `<div class="sbars">`
        + bar('motifs with a curated family', stat.motifs, stat.motifs, 'ok')
        + bar('families with a written entry', stat.families, stat.families, 'ok')
        + Object.entries(srcCounts).map(([k, v]) => bar(k, v, stat.motifs)).join('')
        + `</div>`
        + `<p class="note">${stat.families} families across ${stat.classes} DNA-binding-domain classes. Total written text: ${sum(longWords).toLocaleString()} words in the long entries, median ${longWords.sort((a, b) => a - b)[Math.floor(longWords.length / 2)]} per family.</p>`

        + `<h2 style="font-size:20px;margin-top:34px">How cohesive the families are</h2>`
        + `<p class="note">Median similarity of a family's members to its representative motif. A family below 0.5 is a bucket of unrelated matrices, not one motif — and its entry says so.</p>`
        + `<div class="sbars">`
        + bar('tight — one motif', cohesionBuckets['tight (>=0.75)'], stat.families, 'ok')
        + bar('loose', cohesionBuckets['loose (0.5-0.75)'], stat.families, 'warn')
        + bar('not one motif', cohesionBuckets['not one motif (<0.5)'], stat.families, 'bad')
        + `</div>`

        + `<h2 style="font-size:20px;margin-top:34px">Evidence behind the matrices</h2>`
        + `<p class="note">HOCOMOCO records how each matrix was measured. In vitro evidence supports "this protein binds this sequence"; a ChIP-only matrix records where the protein was crosslinked, which need not be a sequence it binds itself.</p>`
        + `<div class="sbars">`
        + bar('in vitro support (SELEX, PBM, SMiLE-seq)', counts.withEvidence - counts.chipOnly, counts.withEvidence, 'ok')
        + bar('ChIP-only', counts.chipOnly, counts.withEvidence, 'warn')
        + `</div>`

        + `<h2 style="font-size:20px;margin-top:34px">Where the data and the labels disagree</h2>`
        + `<div class="sbars">`
        + bar('motifs whose matrix contradicts its label', counts.suspect, stat.motifs, 'bad')
        + bar('motifs inherited from a non-human protein', counts.transfer, stat.motifs, 'warn')
        + bar('uncharacterised motifs matching a known family', counts.resembles, stat.motifs, 'warn')
        + bar('family inferred from similarity, not the label', counts.inferred, stat.motifs)
        + `</div>`
        + `<p class="note">All of these are listed individually on the <a href="/families/label-checks/">label checks</a> page.</p>`

        + `<h2 style="font-size:20px;margin-top:34px">Citations</h2>`
        + `<div class="sbars">`
        + bar('PMIDs that resolve and name the author cited', stat.pmids, stat.pmids, 'ok')
        + `</div>`
        + `<p class="note">${stat.refs.toLocaleString()} references across ${stat.families} entries, ${stat.pmids.toLocaleString()} of them distinct; median ${refCounts[Math.floor(refCounts.length / 2)]} per family, minimum ${refCounts[0]}. Citation text is regenerated from PubMed's own record, so it cannot drift from the identifier beside it. What is <em>not</em> checked is whether each sentence is a fair reading of the paper it cites — see <a href="/families/methods/">methods</a>.</p>`

        + `<h2 style="font-size:20px;margin-top:34px">Entries that decline to answer</h2>`
        + `<p class="note">${stat.noConsensus} of ${stat.families} families state that they have <b>no single consensus</b> rather than being given one. That is a result, not a gap: a KRAB zinc-finger hit identifies a kind of protein, not a site.</p>`
        + `<div class="rel" style="margin-top:26px"><a href="/families/">Back to the atlas →</a><a href="/families/methods/">Methods and limits →</a><a href="/families/index.json">All of this as JSON →</a></div>`
        + FOOT();
    mkdirSync(resolve(dist, 'families', 'stats'), { recursive: true });
    writeFileSync(resolve(dist, 'families', 'stats', 'index.html'), statsPage);

    // ---- index ----
    const classes = [...new Set(fams.map((f) => f.class))]
        .sort((a, b) => fams.filter((f) => f.class === b).reduce((s, f) => s + f.n, 0) - fams.filter((f) => f.class === a).reduce((s, f) => s + f.n, 0));
    const firstSentence = (s) => { const m = String(s || '').match(/^.*?[.!?](\s|$)/); return (m ? m[0] : String(s || '')).trim(); };
    const cards = classes.map((c) => {
        const group = fams.filter((f) => f.class === c).sort((a, b) => b.n - a.n);
        const total = group.reduce((s, f) => s + f.n, 0);
        return `<div class="classhead"><h2>${esc(c)}</h2><span class="n">${group.length} famil${group.length === 1 ? 'y' : 'ies'} · ${total} motifs</span></div>`
            + `<div class="grid">` + group.map((f) => `<a class="card" href="/families/${f.key.toLowerCase()}/" data-t="${esc((f.name + ' ' + f.key + ' ' + (f.aka || []).join(' ') + ' ' + (f.symbols || []).slice(0, 60).join(' ') + ' ' + (f.consensus || '') + ' ' + (f.class || '')).toLowerCase())}">`
                + `<span class="n">${f.n}</span><div class="nm">${esc(f.name)}</div>`
                + (f.consensusChip ? `<div class="cs">${esc(f.consensusChip)}</div>` : (f.dataConsensus ? `<div class="cs">${esc(f.dataConsensus)}</div>` : ''))
                + `<div class="ct">${esc(firstSentence(f.short || f.def))}</div></a>`).join('') + `</div>`;
    }).join('\n');
    const nMotifs = fams.reduce((s, f) => s + f.n, 0);
    const index = HEAD('Motif family atlas — Motif Tools',
        `Short, referenced summaries of ${fams.length} DNA motif families covering ${nMotifs} motifs from JASPAR, HOCOMOCO, CIS-BP and the Vierstra archetypes.`,
        'https://motif.zhoulab.io/families/')
        + `<div class="eyebrow">Motif family atlas</div>`
        + `<h1 style="font-size:40px;margin-top:10px">What binds this motif?</h1>`
        + `<p class="lead">${fams.length} families, ${nMotifs} motifs, four databases. A family here is a set of motifs it is reasonable to treat as <em>the same motif</em> — usually one DNA-binding-domain family whose members cannot be told apart from sequence alone. Each page says what binds the site, what the sequence means structurally, and what a hit does and does not let you conclude.</p>`
        + `<p class="lead" style="font-size:15px;color:var(--muted)">The factor name attached to a motif is a claim, not a fact: ChIP-derived motifs can belong to a partner protein, some database entries are inherited from a non-human orthologue, and paralogues in one family are usually indistinguishable. Every page is explicit about which of these applies.</p>`
        + `<p style="margin-top:18px"><a class="fam-checks" href="/families/label-checks/">See where the data disagrees with the label →</a></p>`
        + `<div class="sbar"><input id="q" type="search" placeholder="filter families — name, consensus, gene symbol" autocomplete="off"/><span class="eyebrow" id="cnt"></span></div>`
        + `<div id="all">${cards}</div>`
        + PROVENANCE
        + feedbackBlock(null)
        + `<script>
const q=document.getElementById('q'),cnt=document.getElementById('cnt');
const cards=[...document.querySelectorAll('.card')];
function run(){const t=q.value.trim().toLowerCase();let n=0;
for(const c of cards){const hit=!t||c.dataset.t.includes(t);c.style.display=hit?'':'none';if(hit)n++;}
for(const h of document.querySelectorAll('.classhead')){const g=h.nextElementSibling;
h.style.display=[...g.children].some(c=>c.style.display!=='none')?'':'none';g.style.display=h.style.display;}
cnt.textContent=t?n+' of '+cards.length:'';}
q.addEventListener('input',run);</script>`
        + FOOT();
    writeFileSync(resolve(dist, 'families', 'index.html'), index);
    console.log(`  /families/   ${written.length} family pages + index`);
    return written.length;
}

if (process.argv[1] && process.argv[1].endsWith('build-families.mjs')) {
    const dist = process.argv[2] || resolve(root, 'site/dist');
    mkdirSync(dist, { recursive: true });
    buildFamilies(dist);
}
