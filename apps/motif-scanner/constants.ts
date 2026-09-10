export const BG = [0.295, 0.205, 0.205, 0.295] as const;
export const LOG2 = Math.log(2);

export const CHAR_TO_CODE = (() => {
  const arr = new Int8Array(256).fill(4);
  arr[65] = 0; arr[97] = 0;   // A
  arr[67] = 1; arr[99] = 1;   // C
  arr[71] = 2; arr[103] = 2;  // G
  arr[84] = 3; arr[116] = 3;  // T
  arr[85] = 3; arr[117] = 3;  // U (RNA, treated as T)
  return arr;
})();

export const IUPAC: Record<string, string[]> = {
  A: ["A"], C: ["C"], G: ["G"], T: ["T"], U: ["T"],
  R: ["A", "G"], Y: ["C", "T"], S: ["G", "C"], W: ["A", "T"],
  K: ["G", "T"], M: ["A", "C"], B: ["C", "G", "T"], D: ["A", "G", "T"],
  H: ["A", "C", "T"], V: ["A", "C", "G"], N: ["A", "C", "G", "T"]
};

export const BASE_IDX: Record<string, number> = {
  A: 0, C: 1, G: 2, T: 3,
  a: 0, c: 1, g: 2, t: 3,
};

