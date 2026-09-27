# Motif Tools

### → Use it now at **[motif.zhoulab.io](https://motif.zhoulab.io)**

Browser-based tools for DNA/RNA sequence motif analysis from the
[Zhou Lab](https://zhoulab.io). Everything runs client-side — no server, no
installation. Each tool builds to a **single self-contained HTML file** you can
download and open locally, and all analysis happens in your browser.

| | |
|---|---|
| **Scan** a sequence | [motif.zhoulab.io/scan](https://motif.zhoulab.io/scan/) |
| **Search** a motif | [motif.zhoulab.io/search](https://motif.zhoulab.io/search/) |
| **Map** of all known DNA motifs | [motif.zhoulab.io/match](https://motif.zhoulab.io/match/) |

## Tools

| Tool | What it does |
|---|---|
| [`apps/motif-scanner`](apps/motif-scanner) | FIMO-style scanning of a sequence against motif databases, with exact p-values, interactive highlighting, and [Seqstr](https://github.com/jzhoulab/Seqstr) genomic-interval input |
| [`apps/motif-search`](apps/motif-search) | Type a sequence (IUPAC codes OK) and rank database motifs by FFT normalized cross-correlation, log-likelihood ratio, or Tomtom p-values |
| [`apps/motif-match`](apps/motif-match) | Explore a **network map of all known DNA motifs** and place your own motifs onto it — upload a MEME/JSON motif set or an ONNX model (its first Conv1d filters), which are clustered and matched to the nearest known motifs. Also has a cluster/heatmap detail view. |

## Motif databases

Bundled databases, selectable in each tool (see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for sources and citations):

- **JASPAR 2024 CORE vertebrates** (DNA, 879 motifs)
- **HOCOMOCO H14CORE** (DNA, 1595)
- **CIS-BP 2.0 Homo sapiens** (DNA, 1065)
- **Vierstra clustered motifs v2** (DNA, 693)
- **CIS-BP-RNA Homo sapiens** (RNA, 98) — RNA-binding protein motifs. RNA
  motifs are displayed with U in logos and alignments; input sequences may use
  U or T interchangeably.

**Combining databases:** select any number of DNA databases at once to scan or
search against them together. RNA uses a different alphabet, so CIS-BP-RNA is
scanned on its own (selecting it clears the DNA selection and disables
reverse-complement).

Custom databases can be uploaded as MEME-format files (DNA `ACGT` or RNA
`ACGU` alphabets) or as JSON (`{"name": ..., "motifs": [{"id", "pwm"}]}`).

## Development

Requires Node.js ≥ 20. This is an npm-workspaces monorepo:

```bash
npm install          # once, at the repo root
npm test             # run all test suites
npm run build        # build all three standalone HTML files
```

Per-app (from the repo root):

```bash
npm run dev -w motif-scanner     # dev server for one tool
npm run build -w motif-search    # build one tool
```

Built files land in `apps/<tool>/dist/`:
`motif-scanner.html`, `motif-search.html`, `motif-match.html`. Each is fully
self-contained (databases embedded, no CDN dependencies) and can be opened
directly from disk.

### Regenerating the motif network map

The Motif Match "network" view renders a precomputed 2-D similarity map of every
DNA motif across all bundled databases (`resources/motif-network.json`). It is
generated offline so the browser renders it instantly and only the user's
uploaded motifs are compared at runtime. Regenerate it after changing the DNA
databases:

```bash
node apps/motif-match/scripts/build-network.mjs   # ~15s; writes resources/motif-network.json
```

### Motif family atlas

Every bundled DNA motif is assigned to one of ~165 curated **motif families** — a
family being a set of matrices it is reasonable to treat as *the same motif*,
usually one DNA-binding-domain family whose paralogues cannot be separated by
sequence. Each family has a short referenced entry published at
[motif.zhoulab.io/families/](https://motif.zhoulab.io/families/), and the Match
map colours, labels and searches by these families.

The pipeline is offline and reproducible:

```bash
npm run families:neighbors   # ~20s; caches each motif's nearest relatives
npm run families:assign      # ontology + per-symbol tables -> motif-family-assignment.json
npm run families:build       # + resources/families/*.json -> motif-families{,.app}.json
npm run build:network        # rebuild the map so it carries the new families
```

| file | what it is |
| --- | --- |
| `apps/motif-match/scripts/families/ontology.json` | the family list: key, display name, DBD class, definition |
| `apps/motif-match/scripts/families/assign-p*.json` | curated gene symbol → family tables (1,455 symbols) |
| `apps/motif-match/scripts/families/aliases.mjs` | normalises HOCOMOCO/Vierstra shorthands to HGNC symbols |
| `resources/families/<KEY>.json` | the written entry: short paragraph, long review, caveats, references |
| `resources/motif-family-assignment.json` | per-motif family + label-quality flags (generated) |
| `resources/motif-families.json` | merged atlas used by the site generator (generated) |

**Labels are claims, not facts.** The factor name on a motif is an assertion
about what binds it, and it can be wrong: ChIP-derived matrices may belong to a
partner protein, 83 CIS-BP entries are inherited from a non-human orthologue
(down to 55% DNA-binding-domain identity), and Vierstra archetype names describe
the majority of a cluster rather than one protein. `assign.mjs` therefore
compares every motif with all 4,231 others and records where the evidence and
the label disagree — those flags are carried into both the map and the atlas
pages rather than being smoothed over.

### Tests

The numerical implementations are validated against reference implementations:

- `apps/motif-scanner/tests/fimo.test.ts` — FIMO-style scanning checked
  against canonical hits and p-values from FIMO fixtures (MEOX1/FOXQ1).
- `apps/motif-search/src/tomtom.test.ts` — Tomtom port checked for parity
  with [memesuite-lite](https://github.com/jmschrei/memesuite-lite) test
  vectors.
- `apps/motif-scanner/verify_seqstr.ts` — Seqstr parsing checked against the
  reference test cases from
  [jzhoulab/Seqstr](https://github.com/jzhoulab/Seqstr) (hits the live UCSC
  API, so it is a manual script: `npm run verify:seqstr -w motif-scanner`).

### Tomtom CLI

Match a query sequence against a MEME database from the command line:

```bash
npm run tomtom -w motif-search -- --db apps/motif-search/tests/data/test.meme \
  --query ATGCGTA --max-pvalue 0.001 --top 5
```

## Website & deployment

The public site (landing page + all three tools + downloads) is served at
**[motif.zhoulab.io](https://motif.zhoulab.io)**. It is a static site:

```bash
npm run build          # build the three tools
npm run build:site     # assemble site/dist (landing + /scan /search /match /downloads)
npx wrangler deploy    # deploy to Cloudflare (config in wrangler.jsonc)
# or: npm run deploy   # does all three
```

`site/src/index.html` is the landing page; `site/build.mjs` copies the built
tool HTML into `site/dist/` at clean routes. The site is plain static files, so
it can also be hosted on GitHub Pages, Netlify, or any static host — point it at
`site/dist/`. The custom domain is attached in the Cloudflare dashboard after
the first deploy (see `wrangler.jsonc`).

## Privacy

All motif scanning, searching, and matching runs locally in your browser;
sequences you paste never leave your machine. The one exception: if you enter
genomic coordinates in Seqstr format in the scanner, the coordinates (not
sequences you typed) are sent to the UCSC Genome Browser API to retrieve the
reference sequence.

## License

MIT — see [LICENSE](LICENSE). Third-party code and data notices:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
