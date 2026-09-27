#!/usr/bin/env node
// Check every PMID the family atlas cites against PubMed, and (with --fix) rewrite the
// citation text from PubMed's own record so the whole atlas reads in one style and no
// printed citation can drift from the identifier next to it.
//
//   node verify-refs.mjs         check only
//   node verify-refs.mjs --fix   check, then rewrite resources/families/*.json
//
// The check that matters is the first-author surname: a PMID that resolves but whose
// first author is not the one the writer named is a citation pointing at the wrong paper.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(import.meta.dirname, '../../../../resources/families');
const FIX = process.argv.includes('--fix');
if (!existsSync(DIR)) { console.error('no resources/families directory'); process.exit(1); }

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const docs = files.map((f) => ({ f, d: JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) }));
const ids = [...new Set(docs.flatMap(({ d }) => (d.refs || []).map((r) => r.pmid).filter(Boolean).map(String)))];
console.log(`${files.length} entries, ${ids.length} distinct PMIDs`);

// NCBI eutils is the primary source; Europe PMC mirrors the same records and is used
// when eutils is unavailable, which it intermittently is.
async function fromEutils(chunk) {
    const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${chunk.join(',')}`);
    if (!res.ok) throw new Error(`eutils ${res.status}`);
    const j = await res.json();
    const out = [];
    for (const uid of j.result?.uids || []) {
        const r = j.result[uid];
        out.push([uid, { title: r.title, source: r.source, pubdate: r.pubdate, volume: r.volume, pages: r.pages, authors: r.authors }]);
    }
    return out;
}
async function fromEuropePmc(chunk) {
    const q = chunk.map((id) => `EXT_ID:${id}`).join(' OR ');
    const res = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=(SRC:MED) AND (${q})&format=json&pageSize=${chunk.length}&resultType=core`);
    if (!res.ok) throw new Error(`europepmc ${res.status}`);
    const j = await res.json();
    return (j.resultList?.result || []).map((r) => [String(r.pmid), {
        title: r.title, source: r.journalInfo?.journal?.medlineAbbreviation || r.journalInfo?.journal?.title,
        pubdate: String(r.pubYear || ''), volume: r.journalInfo?.volume, pages: r.pageInfo,
        authors: (r.authorList?.author || []).map((a) => ({ name: a.fullName || `${a.lastName || ''} ${a.initials || ''}`.trim() })),
    }]);
}
const rec = new Map();
let source = 'eutils';
for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    let rows = null;
    if (source === 'eutils') {
        try { rows = await fromEutils(chunk); }
        catch (e) { console.warn(`\n  eutils unavailable (${e.message}); falling back to Europe PMC`); source = 'europepmc'; }
    }
    if (!rows) rows = await fromEuropePmc(chunk);
    for (const [uid, r] of rows) rec.set(uid, r);
    process.stdout.write(`  fetched ${Math.min(i + 100, ids.length)}/${ids.length} via ${source}\r`);
    await new Promise((r) => setTimeout(r, 400));
}
console.log(`  fetched ${rec.size}/${ids.length} records via ${source}      `);

// Compare names without diacritics and with the German transliterations folded
// together, so "Labbé"/"Labbe" and "Gröschel"/"Groeschel" both match.
const plain = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/([aou])e/g, '$1');
const surnames = (cite) => String(cite).split(/[.;:]/)[0].split(/,|\band\b/).map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
const citeOf = (r) => {
    const a = (r.authors || []).map((x) => x.name);
    const who = (a.length > 3 ? `${a.slice(0, 3).join(", ")}, et al` : a.join(", ")).replace(/\.$/, "");
    const year = (r.pubdate || '').split(' ')[0];
    const vol = r.volume ? `;${r.volume}` : '';
    const pages = r.pages ? `:${r.pages}` : '';
    const title = String(r.title || '').replace(/\.$/, '');
    return `${who ? who + '. ' : ''}${title}. ${r.source} ${year}${vol}${pages}.`;
};

const bad = [];
let fixed = 0;
for (const { f, d } of docs) {
    let touched = false;
    for (const r of d.refs || []) {
        if (!r.pmid) continue;
        const p = rec.get(String(r.pmid));
        if (!p || p.error) { bad.push(`${d.key || f}: PMID ${r.pmid} did not resolve — ${r.cite}`); continue; }
        // Does anyone the writer named appear in PubMed's author list? Comparing only
        // the first author would flag book chapters, where PubMed lists the volume
        // editor ahead of the chapter's own authors.
        const theirs = (p.authors || []).map((a) => plain(String(a.name).split(/\s+/)[0])).filter(Boolean);
        // Some citations (retraction notices, book chapters) carry no author list at all;
        // there is nothing to cross-check, and the title already identifies the record.
        const head = String(r.cite).split(/[.;:]/)[0];
        if (!/[A-Z][a-z]+ [A-Z]{1,3}\b|et al/.test(head)) continue;
        const named = surnames(r.cite).map(plain);
        const hit = (n, t) => n === t || n.startsWith(t) || t.startsWith(n);
        if (theirs.length && named.length && !named.some((n) => theirs.some((t) => hit(n, t)))) {
            bad.push(`${d.key || f}: PMID ${r.pmid} is "${p.title}" by ${p.authors?.[0]?.name} — cited as "${r.cite}"`);
            continue;
        }
        if (FIX) {
            const canon = citeOf(p);
            if (canon !== r.cite) { r.cite = canon; touched = true; fixed++; }
            if (!r.url) { r.url = `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`; touched = true; }
        }
    }
    if (touched) writeFileSync(resolve(DIR, f), JSON.stringify(d, null, 1));
}

if (bad.length) {
    console.log(`\n${bad.length} citation(s) to check by hand:`);
    for (const b of bad) console.log(`  ${b}`);
    process.exitCode = 1;
} else console.log('every cited PMID resolves and names the author it claims');
if (FIX) console.log(`rewrote ${fixed} citation(s) from PubMed metadata`);
