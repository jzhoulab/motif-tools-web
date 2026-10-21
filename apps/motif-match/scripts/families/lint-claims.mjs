#!/usr/bin/env node
// Catch prose that states a fact about the atlas's own data and gets it wrong.
// These are checkable mechanically, and writers kept finding them by hand:
//   - a HOCOMOCO id called "ChIP-derived" when its id says HT-SELEX (or the reverse)
//   - a quoted cohesion value that is not the family's computed cohesion
//   - a quoted information content for a named motif that does not match that motif
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDnaMotifs, infoContent } from '../lib/motifs.mjs';

const ROOT = resolve(import.meta.dirname, '../../../..');
const assign = JSON.parse(readFileSync(resolve(ROOT, 'resources/motif-family-assignment.json'), 'utf8'));
const cohesion = new Map(assign.families.map((f) => [f.key, f.cohesion]));
const bits = new Map(loadDnaMotifs().map((n) => [n.id, infoContent(n.pwm)]));
const EV = { P: 'ChIP-seq', S: 'HT-SELEX', M: 'methyl-HT-SELEX', G: 'GHT-SELEX', I: 'SMiLE-seq', B: 'PBM' };
const strip = (s) => String(s || '').replace(/\s*\[PMID:[\d,\s]+\]/g, '');
const sentences = (t) => strip(t).split(/(?<=[.!?])\s+(?=[A-Z(])/);

const out = [];
for (const file of readdirSync(resolve(ROOT, 'resources/families')).filter((f) => f.endsWith('.json')).sort()) {
    const key = file.replace(/\.json$/, '');
    const d = JSON.parse(readFileSync(resolve(ROOT, 'resources/families', file), 'utf8'));
    const texts = [['long', d.long], ['caveats', d.caveats], ['short', d.short],
        ...(d.open || []).map((q, i) => [`open[${i}]`, q]),
        ...(d.timeline || []).map((t, i) => [`timeline[${i}]`, t.finding])];
    for (const [field, text] of texts) for (const s of sentences(text)) {
        // 1. evidence type stated for a named HOCOMOCO model
        for (const m of s.matchAll(/\b([A-Z0-9]+)\.H14CORE\.(\d+)\.([A-Z]+)\.([A-D])\b/g)) {
            const letters = m[3], id = m[0];
            const chipOnly = /^P+$/.test(letters);
            // look only at the words just before the id, so a sentence that contrasts
            // two models is judged per model
            // ...and only within the same clause: "not a ChIP-only inference; the weakest,
            // OSR2.H14CORE.1.M.C" must not read as calling OSR2's model ChIP-only
            const before = s.slice(Math.max(0, m.index - 60), m.index).split(/[;:]|\s[\u2014-]\s|, (?:while|whereas|but) /).pop().toLowerCase();
            const saysChip = /chip[- ](?:derived|only|seq)|from chip/.test(before);
            const saysVitro = /(ht-?selex|in vitro|selex)[- ](?:derived|model)|in vitro/.test(before);
            if (saysChip && !letters.includes('P')) out.push(`${key}.${field}: calls ${id} ChIP-derived, but its id says ${[...letters].map((c) => EV[c] || c).join(' + ')}`);
            if (saysVitro && chipOnly) out.push(`${key}.${field}: calls ${id} in vitro, but its id says ChIP-seq only`);
        }
        // 2. a quoted cohesion value for this family
        for (const m of s.matchAll(/cohesion(?: value)?(?: of| is| at|,)?\s*(?:about |only |just |around |~)?(0\.\d{2})/gi)) {
            const said = parseFloat(m[1]), real = cohesion.get(key);
            // only this family's own figure: skip sentences comparing to other families
            if (real != null && Math.abs(said - real) > 0.015 && !/\b(other|versus|vs\.?|compared|than)\b/i.test(s)) {
                out.push(`${key}.${field}: quotes cohesion ${said}, computed ${real}`);
            }
        }
        // 3. a quoted bit value for a named motif
        for (const m of s.matchAll(/([A-Za-z0-9:_.()-]+?(?:\(MA\d{4}\.\d\)|H14CORE\.\d+\.[A-Z]+\.[A-D]|M\d{5}_\d\.\d{2}))[^.]{0,40}?(\d+(?:\.\d)?)[- ]bits?/g)) {
            let id = m[1].replace(/^\(/, '');
            const hit = [...bits.keys()].find((k) => k === id || k.endsWith(id) || (id.includes('(MA') && k.includes(id.match(/MA\d{4}\.\d/)[0])));
            if (!hit) continue;
            const said = parseFloat(m[2]), real = bits.get(hit);
            if (Math.abs(said - real) > Math.max(0.6, real * 0.06)) out.push(`${key}.${field}: says ${hit} is ${said} bits, computed ${real.toFixed(1)}`);
        }
    }
}
if (out.length) { console.log(`${out.length} claim(s) about the data that the data contradicts:`); for (const x of out) console.log(`  ${x}`); process.exitCode = 1; }
else console.log('no checkable claims about the data are contradicted by it');
