# Third-party code and data

## Code

### memesuite-lite (Tomtom port)

`apps/motif-search/src/tomtom.ts` is a TypeScript port of the Tomtom
implementation in [memesuite-lite](https://github.com/jmschrei/memesuite-lite)
by Jacob Schreiber, used under the MIT license:

```
MIT License

Copyright (c) 2025 Jacob Schreiber

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Algorithms

- FIMO-style scanning and exact p-value computation follow Grant, Bailey &
  Noble, *FIMO: scanning for occurrences of a given motif*, Bioinformatics
  (2011).
- Tomtom motif comparison follows Gupta, Stamatoyannopoulos, Bailey & Noble,
  *Quantifying similarity between motifs*, Genome Biology (2007).
- Seqstr input format: [jzhoulab/Seqstr](https://github.com/jzhoulab/Seqstr).
  Genomic sequences for Seqstr intervals are fetched from the
  [UCSC Genome Browser REST API](https://genome.ucsc.edu/goldenPath/help/api.html).

## Motif databases

The following motif collections are redistributed (embedded in the built HTML
files) for convenience. Please cite the original sources when you use results
based on them, and consult each source for its terms of use.

- **JASPAR 2024 CORE vertebrates** — <https://jaspar.elixir.no>.
  Rauluseviciute et al., *JASPAR 2024: 20th anniversary of the open-access
  database of transcription factor binding profiles*, Nucleic Acids Research
  (2024).
- **HOCOMOCO H14CORE** — <https://hocomoco14.autosome.org>.
  Vorontsov et al., HOCOMOCO motif collection (autosome.org).
- **Vierstra clustered motifs v2** —
  <https://www.vierstra.org/resources/motif_clustering>.
  Vierstra et al., *Global reference mapping of human transcription factor
  footprints*, Nature (2020).
- **CIS-BP-RNA (Homo sapiens, build 0.6)** —
  <http://cisbp-rna.ccbr.utoronto.ca>.
  Ray et al., *A compendium of RNA-binding motifs for decoding gene
  regulation*, Nature (2013). MEME-format file taken from the MEME Suite
  motif database bundle (v12.25).
