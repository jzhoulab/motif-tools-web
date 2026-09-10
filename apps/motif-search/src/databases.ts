import vierstraRaw from '@resources/vierstra_clustered_motif_v2.json?raw';
import jasparRaw from '@resources/JASPAR2024_CORE_vertebrates.json?raw';
import h14Raw from '@resources/H14CORE_meme_format.meme?raw';
import cisbpRnaRaw from '@resources/CISBP-RNA_Homo_sapiens.meme?raw';

export const DATABASES = {
  vierstra: { name: 'Vierstra Clustered Motifs', data: JSON.parse(vierstraRaw), type: 'json' as const, alphabet: 'dna' as const },
  jaspar: { name: 'JASPAR 2024 CORE Vertebrates', data: JSON.parse(jasparRaw), type: 'json' as const, alphabet: 'dna' as const },
  h14: { name: 'H14CORE MEME Format', data: h14Raw, type: 'meme' as const, alphabet: 'dna' as const },
  cisbprna: { name: 'CIS-BP-RNA Human RBPs (RNA)', data: cisbpRnaRaw, type: 'meme' as const, alphabet: 'rna' as const },
  custom: { name: 'Custom Upload', data: null, type: 'custom' as const, alphabet: 'dna' as const }
};

export type DatabaseKey = keyof typeof DATABASES;
