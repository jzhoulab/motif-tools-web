#!/usr/bin/env node
// Assemble the public site (site/dist) from the built tool HTMLs + the landing page.
// Run the app builds first: `npm run build` at the repo root.
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFamilies } from './build-families.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'site/dist');

const TOOLS = [
  { file: 'apps/motif-scanner/dist/motif-scanner.html', route: 'scan', download: 'motif-scanner.html' },
  { file: 'apps/motif-search/dist/motif-search.html', route: 'search', download: 'motif-search.html' },
  { file: 'apps/motif-match/dist/motif-match.html', route: 'match', download: 'motif-match.html' },
];

for (const t of TOOLS) {
  if (!existsSync(resolve(root, t.file))) {
    console.error(`Missing ${t.file}. Run \`npm run build\` at the repo root first.`);
    process.exit(1);
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
mkdirSync(resolve(dist, 'downloads'), { recursive: true });

// Landing page
copyFileSync(resolve(root, 'site/src/index.html'), resolve(dist, 'index.html'));
// SPA-less 404 -> send people home
copyFileSync(resolve(root, 'site/src/index.html'), resolve(dist, '404.html'));

for (const t of TOOLS) {
  const src = resolve(root, t.file);
  mkdirSync(resolve(dist, t.route), { recursive: true });
  copyFileSync(src, resolve(dist, t.route, 'index.html'));         // /scan/ , /search/ , /match/
  copyFileSync(src, resolve(dist, 'downloads', t.download));        // /downloads/motif-*.html
}

// The motif map is the part of Match most people want on its own — it is useful without
// having a model or a motif set to compare. Same build, its own address, and the app
// reads the route to present itself as the Map rather than as Match.
mkdirSync(resolve(dist, 'map'), { recursive: true });
copyFileSync(resolve(root, 'apps/motif-match/dist/motif-match.html'), resolve(dist, 'map', 'index.html'));
copyFileSync(resolve(root, 'apps/motif-match/dist/motif-match.html'), resolve(dist, 'downloads', 'motif-map.html'));

// Brand-mark favicon: four nucleotide-colored bars (A C G T)
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="6" fill="#0B1220"/>
<rect x="5"  y="7" width="4" height="18" rx="1.5" fill="#109648"/>
<rect x="12" y="7" width="4" height="18" rx="1.5" fill="#255C99"/>
<rect x="19" y="7" width="4" height="18" rx="1.5" fill="#F7B32B"/>
<rect x="26" y="7" width="1.5" height="18" rx="0.75" fill="#D62828"/>
</svg>`;
// (kept simple; the 4th bar is thin to fit)
writeFileSync(resolve(dist, 'favicon.svg'), favicon.replace('x="26" y="7" width="1.5"', 'x="25" y="7" width="4"'));

// Motif family atlas: one page per family, generated from resources/motif-families.json
const nFam = buildFamilies(dist);

console.log('Site assembled at site/dist/:');
console.log('  /            landing page');
console.log('  /scan/       motif scanner');
console.log('  /search/     motif search');
console.log('  /match/      motif match');
console.log('  /map/        motif map (same build, network view)');
console.log('  /downloads/  standalone HTML files');
if (nFam) console.log(`  /families/   ${nFam} motif family pages`);
