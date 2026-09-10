export interface MotifInputData {
  name: string;
  motifs: any[];
}

export function parseMeme(text: string): MotifInputData {
  const lines = text.split(/\r?\n/);
  const motifs: any[] = [];
  
  let currentId: string | null = null;
  let currentName: string | null = null;
  let matrixRows: number[][] = [];
  let inMatrix = false;

  const finalizeMotif = () => {
      if (!currentId || matrixRows.length === 0) return;

      // Transpose L x 4 (MEME) -> 4 x L (App internal)
      const L = matrixRows.length;
      const pwm: number[][] = [[], [], [], []]; // A, C, G, T
      let consensus = "";
      const bases = ['A', 'C', 'G', 'T'];

      for (let i = 0; i < L; i++) {
          let maxVal = -1;
          let maxIdx = 0;
          // MEME standard alphabet is ACGT
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
          pwm: pwm,
          consensus: consensus
      });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip comments
    if (trimmed.startsWith('#')) continue;

    // Detect Motif Header
    // Format: MOTIF <id> [name]
    if (trimmed.startsWith("MOTIF")) {
      if (currentId) {
        finalizeMotif();
      }
      
      const parts = trimmed.split(/\s+/);
      currentId = parts[1];
      // Name is optional (rest of line)
      currentName = parts.slice(2).join(" ") || parts[1];
      matrixRows = [];
      inMatrix = false;
      continue;
    }

    // Detect Matrix Start
    if (trimmed.startsWith("letter-probability matrix")) {
      inMatrix = true;
      continue;
    }

    if (inMatrix) {
       // Parse numbers: e.g. 0.1 0.2 0.3 0.4
       // Some MEME files have data after the 4th column or URLs, ignore those.
       const parts = trimmed.split(/\s+/);
       // Check if line starts with a number
       if (!/^[0-9.]/.test(parts[0])) {
           // If line doesn't start with number, we might have exited the matrix (e.g. URL line)
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

  // Finalize last motif
  if (currentId) {
    finalizeMotif();
  }

  if (motifs.length === 0) {
     throw new Error("No valid motifs found. Ensure file contains 'MOTIF' definitions and 'letter-probability matrix'.");
  }

  return {
    name: "Imported MEME",
    motifs
  };
}
