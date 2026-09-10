export const BASES = ["A", "C", "G", "T"] as const;
export const BASE_IDX: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 };
export const COMP: Record<string, string> = { A: "T", C: "G", G: "C", T: "A" };

export const IUPAC: Record<string, string[]> = {
  A: ["A"], C: ["C"], G: ["G"], T: ["T"], U: ["T"],
  R: ["A", "G"], Y: ["C", "T"], S: ["G", "C"], W: ["A", "T"],
  K: ["G", "T"], M: ["A", "C"], B: ["C", "G", "T"], D: ["A", "G", "T"],
  H: ["A", "C", "T"], V: ["A", "C", "G"], N: ["A", "C", "G", "T"]
};

export const BG = [0.295, 0.205, 0.205, 0.295];
export const LOGO_LIMIT = 60;


