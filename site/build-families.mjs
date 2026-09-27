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
<nav><a href="/scan/">Scan</a><a href="/search/">Search</a><a href="/match/">Map</a><a href="/families/">Families</a></nav>
</div></header><main><div class="wrap">`;

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
            + (related.length ? `<h2 style="font-size:19px;margin-top:30px">Other ${esc(f.class)} families</h2><div class="rel">`
                + related.map((g) => `<a href="/families/${g.key.toLowerCase()}/">${esc(g.name)}</a>`).join('') + `</div>` : '')
            + `<div class="rel" style="margin-top:26px"><a href="/match/">See this family on the motif map →</a><a href="/search/">Search your motif against the databases →</a></div>`
            + FOOT();
        writeFileSync(resolve(dir, 'index.html'), html);
        written.push(f.key);
    }

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
        + `<div class="rel" style="margin-top:30px"><a href="/families/">Back to the family atlas →</a></div>`
        + FOOT();
    mkdirSync(resolve(dist, 'families', 'label-checks'), { recursive: true });
    writeFileSync(resolve(dist, 'families', 'label-checks', 'index.html'), checks);

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
