export interface MemeFile {
  name?: string;
  motifs: Array<{
    id: string;
    name: string;
    pwm: number[][];
    consensus: string;
  }>;
  alphabet?: 'dna' | 'rna';
}

export function parseMeme(text: string): MemeFile {
  const lines = text.split(/\r?\n/);
  const motifs: MemeFile['motifs'] = [];

  let alphabet: 'dna' | 'rna' = 'dna';
  let currentId: string | null = null;
  let currentName: string | null = null;
  let matrixRows: number[][] = [];
  let inMatrix = false;

  const finalizeMotif = () => {
    if (!currentId || matrixRows.length === 0) return;
    const L = matrixRows.length;
    const pwm: number[][] = [[], [], [], []];
    const bases = ['A', 'C', 'G', 'T'];
    let consensus = '';
    for (let i = 0; i < L; i++) {
      let maxVal = -1;
      let maxIdx = 0;
      for (let b = 0; b < 4; b++) {
        const val = matrixRows[i][b];
        pwm[b].push(val);
        if (val > maxVal) {
          maxVal = val;
          maxIdx = b;
        }
      }
      consensus += bases[maxIdx];
    }
    motifs.push({
      id: currentId,
      name: currentName || currentId,
      pwm,
      consensus
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.toUpperCase().startsWith('ALPHABET')) {
      if (trimmed.toUpperCase().replace('ALPHABET', '').includes('U')) alphabet = 'rna';
      continue;
    }
    if (trimmed.startsWith('MOTIF')) {
      if (currentId) finalizeMotif();
      const parts = trimmed.split(/\s+/);
      currentId = parts[1];
      currentName = parts.slice(2).join(' ') || parts[1];
      matrixRows = [];
      inMatrix = false;
      continue;
    }
    if (trimmed.startsWith('letter-probability matrix')) {
      inMatrix = true;
      continue;
    }
    if (inMatrix) {
      const parts = trimmed.split(/\s+/);
      if (!/^[0-9.]/.test(parts[0])) {
        inMatrix = false;
        continue;
      }
      const nums = parts.slice(0, 4).map(parseFloat);
      if (nums.length >= 4 && !nums.some(isNaN)) {
        matrixRows.push(nums);
      } else {
        inMatrix = false;
      }
    }
  }

  if (currentId) finalizeMotif();

  if (motifs.length === 0) {
    throw new Error("No valid motifs found in MEME file.");
  }

  return { name: 'Imported MEME', motifs };
}

