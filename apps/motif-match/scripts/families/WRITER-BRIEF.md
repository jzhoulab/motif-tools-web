# Motif family atlas — writer brief

The spec the entries in `resources/families/*.json` were written to. Keep it with the
pipeline: it is what makes a new or revised entry match the ones already published.

Each entry is a short encyclopedia article about one **motif family**, published at
motif.zhoulab.io/families/ next to the three browser motif tools. The audience is
working molecular biologists, genomicists and students who just got a motif hit and
want to know what it means. Wikipedia-quality, not review-article length.

A **family** here is a set of motifs it is reasonable to believe are *the same motif* —
usually one DNA-binding-domain family whose members cannot be told apart from sequence
alone. The family list is fixed (`ontology.json`); a writer never invents, splits or
merges families.

## Inputs

- `ontology.json` — `{key, name, class, def}` for every family.
- `.cache/family-data/<KEY>.json` — the motifs assigned to that family across JASPAR
  2024, HOCOMOCO v14, CIS-BP and the Vierstra 2020 archetypes: gene symbols, per-motif
  consensus strings, the medoid ("representative") motif, how cohesive the family is,
  and which members the data flags as possibly mislabelled. Read it before writing; the
  text must be consistent with it. Rebuild it with `npm run families:assign`.

## Output schema (exact)

```json
{
  "key": "AP1",
  "aka": ["AP-1 site", "TRE", "TPA response element"],
  "consensus": "TGASTCA",
  "short": "one paragraph, 90-150 words",
  "long": "markdown, 550-900 words, using the section headings below",
  "caveats": "60-150 words: how much to trust a hit for THIS family",
  "refs": [
    {"cite": "Glover JN, Harrison SC. Crystal structure of the heterodimeric bZIP transcription factor c-Fos-c-Jun bound to DNA. Nature 1995;373:257-61.",
     "pmid": "7816143", "url": "https://pubmed.ncbi.nlm.nih.gov/7816143/"}
  ]
}
```

- `consensus`: the consensus as the **literature** writes it (IUPAC, upper case). If it
  disagrees with `dataConsensus` in the family data, say why in `long` — do not silently
  pick one. **Omit the field** when the family genuinely has no single consensus; the
  page and the app then say "no single consensus" instead of inventing one.
- `aka`: names a reader might search for (site names, older nomenclature, TFClass name).
- `short` is what appears on hover and at the top of the page: what binds this motif,
  what the motif is, and why anyone cares. No citations in `short`.

## `long` — exactly these headings, in this order

```
## The factors
## The motif
## Where it acts
## Biology and disease
## Reading a hit
```

- **The factors** — which proteins, the DNA-binding domain and fold, how they dimerise
  or assemble, how many paralogues, which are broadly expressed vs restricted.
- **The motif** — the consensus and its length, which positions carry the information
  and *why* structurally, half-sites, spacing rules, common variants, and which
  paralogues are or are not distinguishable from sequence.
- **Where it acts** — promoters vs enhancers, CpG islands, cell-type specificity,
  typical number of genomic occurrences, chromatin context, and the partners it
  co-occurs with (composite elements by name where they exist).
- **Biology and disease** — the processes it controls, knockout/mutant phenotypes,
  human disease and cancer links. Concrete, not a list of adjectives.
- **Reading a hit** — what a match does and does not license you to conclude: the
  paralogue problem, whether the site is common enough to occur by chance, and whether
  ChIP-derived versions of this motif are contaminated by indirect binding.

## Labels are claims, not facts

Every motif in these databases is labelled with a factor name, and that label can be
wrong or over-specific. Entries must be honest about it, in `caveats` and in **Reading
a hit**:

- **Indirect binding.** ChIP-derived motifs can be the motif of a *partner* protein.
  HOCOMOCO ids encode their evidence: the 4th field carries one letter per data type
  (`P` ChIP-seq, `S` HT-SELEX, `M` methyl-HT-SELEX, `G` GHT-SELEX, `I` SMiLE-seq,
  `B` PBM) and the 5th is a quality grade A-D, where A means the motif is supported by
  at least two assay types. In vitro evidence supports "this protein binds this
  sequence"; ChIP-only evidence (`P` alone) does not, on its own.
- **Cross-species transfer.** 83 of the 1065 CIS-BP human motifs are inherited from a
  non-human protein with a similar DNA-binding domain, sometimes very distant: the human
  *RFX8* motif comes from a louse protein at 55% DBD identity, *TRPS1* and *CREBL2* from
  *Drosophila*, *CDC5L* from *Arabidopsis*. The family data marks these
  (`prov.species`, `prov.dbdIdentity`).
- **Archetypes are named after a majority, not a protein.** A Vierstra id such as
  `AC0001:DLX/LHX:Homeodomain` names the factor groups whose motifs clustered together.
- **Paralogues are usually indistinguishable.** Where all members share one motif, say
  plainly that a hit identifies the family, not the member.
- **The data can contradict the label.** The family data lists members whose nearest
  neighbours across all four databases belong to a *different* family (`suspect: true`,
  with `altFamily`). Mention the pattern if it is systematic; do not assert that a
  specific database entry is wrong unless the literature says so.

## Citations

- 6-12 references per family: the primary paper that established the motif or the
  structure, plus a good recent review.
- **Only cite work actually retrieved**, via PubMed, Europe PMC, NCBI Gene, UniProt or
  JASPAR. Never invent or guess a PMID or DOI; give `cite` and `url` without a `pmid`
  rather than guessing one. `verify-refs.mjs` checks every PMID against PubMed and
  rewrites `cite` from the retrieved record, so a wrong identifier will surface.

## Register

Neutral, specific, American spelling. Define jargon on first use. No marketing language,
no "plays a crucial role", no "master regulator" unless attributed. Prefer numbers to
adjectives. Claim no novelty. Hedge only where the literature is genuinely unsettled,
and then say what the disagreement is.
