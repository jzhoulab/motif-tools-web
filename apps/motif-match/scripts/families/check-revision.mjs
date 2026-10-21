#!/usr/bin/env node
// After a revision pass that is meant to ADD fields (anchors, timeline, open questions)
// without rewriting the entries, prove that it did. Compares every entry with the
// committed version in git:
//   - `long` with its [PMID:...] markers stripped must equal the committed `long`
//     (or be flagged for review where a writer split a sentence to attach a paper)
//   - short, caveats, aka, consensus and key must be untouched
//   - no existing reference may have been dropped
//   - every anchored PMID must be in the entry's refs
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../..');
const DIR = resolve(ROOT, 'resources/families');
const REV = process.argv[2] || 'HEAD';
const strip = (s) => String(s || '').replace(/\s*\[PMID:[\d,\s]+\]/g, '');
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean).length;

const report = { ok: 0, proseEdited: [], fieldChanged: [], refsDropped: [], badAnchor: [], incomplete: [] };
let anchors = 0, steps = 0, opens = 0, refsAdded = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
    const key = file.replace(/\.json$/, '');
    const now = JSON.parse(readFileSync(resolve(DIR, file), 'utf8'));
    let then;
    try { then = JSON.parse(execFileSync('git', ['show', `${REV}:resources/families/${file}`], { cwd: ROOT, encoding: 'utf8' })); }
    catch { report.fieldChanged.push(`${key}: not in ${REV}`); continue; }

    let clean = true;
    for (const f of ['key', 'short', 'caveats', 'consensus']) {
        if (norm(now[f]) !== norm(then[f])) { report.fieldChanged.push(`${key}.${f}`); clean = false; }
    }
    if (JSON.stringify(now.aka || []) !== JSON.stringify(then.aka || [])) { report.fieldChanged.push(`${key}.aka`); clean = false; }

    if (norm(strip(now.long)) !== norm(then.long)) {
        // measure how much moved, so a split sentence is distinguishable from a rewrite
        const a = norm(strip(now.long)).split(' '), b = norm(then.long).split(' ');
        const setB = new Set(b);
        const novel = a.filter((w) => !setB.has(w)).length;
        report.proseEdited.push(`${key}: ${words(then.long)} -> ${words(strip(now.long))} words, ${novel} new word tokens`);
        clean = false;
    }
    const oldIds = new Set((then.refs || []).map((r) => String(r.pmid || r.cite)));
    const newIds = new Set((now.refs || []).map((r) => String(r.pmid || r.cite)));
    const dropped = [...oldIds].filter((x) => !newIds.has(x));
    if (dropped.length) { report.refsDropped.push(`${key}: ${dropped.join(', ')}`); clean = false; }
    refsAdded += [...newIds].filter((x) => !oldIds.has(x)).length;

    const cited = new Set((now.refs || []).map((r) => String(r.pmid)).filter(Boolean));
    const ids = [...String(now.long || '').matchAll(/\[PMID:([\d,\s]+)\]/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()).filter(Boolean));
    anchors += ids.length;
    for (const id of ids) if (!cited.has(id)) { report.badAnchor.push(`${key}: ${id}`); clean = false; }
    for (const t of now.timeline || []) for (const id of t.pmids || []) if (!cited.has(String(id))) { report.badAnchor.push(`${key} timeline: ${id}`); clean = false; }
    steps += (now.timeline || []).length;
    opens += (now.open || []).length;
    if (!ids.length || !now.timeline?.length || !Array.isArray(now.open)) report.incomplete.push(key);
    if (clean) report.ok++;
}
console.log(`checked against ${REV}: ${report.ok} entries clean`);
console.log(`totals: ${anchors} inline anchors, ${steps} timeline steps, ${opens} open questions, ${refsAdded} references added`);
for (const [label, list] of [['prose changed beyond inserted markers', report.proseEdited], ['protected fields changed', report.fieldChanged],
    ['references dropped', report.refsDropped], ['anchors not in refs', report.badAnchor], ['still missing anchors/timeline/open', report.incomplete]]) {
    if (list.length) { console.log(`\n${label} (${list.length}):`); for (const x of list) console.log(`  ${x}`); }
}
process.exitCode = (report.fieldChanged.length || report.refsDropped.length || report.badAnchor.length) ? 1 : 0;
