
export interface MotifDefinition {
  id: string;
  name?: string;
  len: number;
  consensus: string;
  logoCols: number[][]; // 4xL matrix of log-odds or weights for visualization
  pssm: Float64Array | number[]; // Flattened PSSM for Forward score breakdown
  pssmRC: Float64Array | number[]; // Flattened PSSM for Reverse score breakdown
  maxScore: number;
  minScore: number;
  trimLeft: number;  // Visual trimming offset
  trimRight: number; // Visual trimming offset
}

export interface MotifHit {
  motifId: string;
  start: number; // 0-based index in query (Visual Start)
  end: number;   // exclusive (Visual End)
  score: number; // normalized 0-1
  rawScore?: number; // Actual bit score sum (Full PSSM)
  pvalue?: number; // FIMO-style p-value (Full PSSM)
  strand: '+' | '-';
  sequence: string; // The actual sequence matched (useful for debugging/display)
}

export interface MotifInputData {
  name?: string;
  motifs: any[];
  alphabet?: 'dna' | 'rna';
}

export interface WorkerResponse {
  type: 'loaded' | 'results' | 'error';
  name?: string;
  count?: number;
  motifs?: MotifDefinition[];
  hits?: MotifHit[];
  message?: string;
}

export interface HighlightMatch {
  id: string;
  start: number;
  end: number;
  score: number;
  rawScore?: number;
  pvalue?: number;
  ori: string;
  color: string;
}
