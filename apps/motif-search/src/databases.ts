import vierstraRaw from '@resources/vierstra_clustered_motif_v2.json?raw';
import jasparRaw from '@resources/JASPAR2024_CORE_vertebrates.json?raw';
import h14Raw from '@resources/H14CORE_meme_format.meme?raw';
import cisbpRaw from '@resources/CISBP_Homo_sapiens.meme?raw';
import cisbpRnaRaw from '@resources/CISBP-RNA_Homo_sapiens.meme?raw';

export interface DbEntry {
  name: string;
  short: string;
  data: any;
  type: 'json' | 'meme';
  alphabet: 'dna' | 'rna';
}

export const DATABASES: Record<string, DbEntry> = {
  jaspar: { name: 'JASPAR 2024 CORE Vertebrates', short: 'JASPAR 2024', data: JSON.parse(jasparRaw), type: 'json', alphabet: 'dna' },
  h14: { name: 'HOCOMOCO H14 CORE', short: 'HOCOMOCO', data: h14Raw, type: 'meme', alphabet: 'dna' },
  cisbp: { name: 'CIS-BP 2.0 Human', short: 'CIS-BP', data: cisbpRaw, type: 'meme', alphabet: 'dna' },
  vierstra: { name: 'Vierstra Clustered Motifs', short: 'Vierstra', data: JSON.parse(vierstraRaw), type: 'json', alphabet: 'dna' },
  'cisbp-rna': { name: 'CIS-BP-RNA Human RBPs', short: 'CIS-BP-RNA', data: cisbpRnaRaw, type: 'meme', alphabet: 'rna' },
};

export const DB_ORDER = ['jaspar', 'h14', 'cisbp', 'vierstra', 'cisbp-rna'];

export type DatabaseKey = keyof typeof DATABASES;
