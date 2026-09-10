export interface LogoProps {
  values: number[][];
  rna?: boolean;
  glyphWidth?: number;
  stackHeight?: number;
  negativealpha?: number;
  outsideAlpha?: number;
  highlightStart?: number;
  highlightLen?: number;
}

const glyphs = {
  A: (p: { fill: string; fillOpacity?: number }) => `<path fill="${p.fill}" fill-opacity="${p.fillOpacity || 1}" fill-rule="evenodd"
               d="M 0 100 L 33 0 L 66 0 L 100 100 L 75 100 L 66 75 L 33 75 L 25 100 Z
                  M 41 55 L 50 25 L 58 55 Z"></path>`,
  C: (p: { fill: string; fillOpacity?: number }) => `<path fill="${p.fill}" fill-opacity="${p.fillOpacity || 1}" d="M 100 28 C 100 -13 0 -13 0 50 C 0 113 100 113 100 72 L 75 72 C 75 90 30 90 30 50 C 30 10 75 10 75 28 L 100 28"></path>`,
  G: (p: { fill: string; fillOpacity?: number }) => `<path fill="${p.fill}" fill-opacity="${p.fillOpacity || 1}" d="M 100 28 C 100 -13 0 -13 0 50 C 0 113 100 113 100 72 L 100 48 L 55 48 L 55 72 L 75 72 C 75 90 30 90 30 50 C 30 10 75 5 75 28 L 100 28"></path>`,
  T: (p: { fill: string; fillOpacity?: number }) => `<path fill="${p.fill}" fill-opacity="${p.fillOpacity || 1}" d="M 0 0 L 0 20 L 35 20 L 35 100 L 65 100 L 65 20 L 100 20 L 100 0 L 0 0"></path>`,
  U: (p: { fill: string; fillOpacity?: number }) => `<path fill="${p.fill}" fill-opacity="${p.fillOpacity || 1}" d="M 0 0 L 25 0 L 25 60 C 25 80 75 80 75 60 L 75 0 L 100 0 L 100 60 C 100 105 0 105 0 60 Z"></path>`
};

const defaultDnaAlphabet = [
  { component: glyphs.A, color: "#109648" },
  { component: glyphs.C, color: "#255C99" },
  { component: glyphs.G, color: "#F7B32B" },
  { component: glyphs.T, color: "#D62828" }
];

const rnaAlphabet = [
  defaultDnaAlphabet[0],
  defaultDnaAlphabet[1],
  defaultDnaAlphabet[2],
  { component: glyphs.U, color: "#D62828" }
];

export function embedLogo(targetElement: HTMLElement, props: LogoProps): void {
  const {
    values,
    glyphWidth = 16,
    stackHeight = 40,
    negativealpha = 0.25,
    outsideAlpha = 0.25,
    highlightStart = 0,
    highlightLen = 0,
    rna = false
  } = props;

  const alphabet = rna ? rnaAlphabet : defaultDnaAlphabet;

  if (!values || !values.length) {
    targetElement.innerHTML = "";
    return;
  }

  const posSums = values.map(col => col.reduce((a, v) => a + Math.max(0, v), 0));
  const negSums = values.map(col => col.reduce((a, v) => a + Math.min(0, v), 0));
  const posMax = Math.max(1e-9, ...posSums);
  const negMin = Math.min(0, ...negSums);
  const negMaxAbs = Math.max(1e-9, Math.abs(negMin));
  const ppu = stackHeight / (posMax + negMaxAbs);
  const posPix = posMax * ppu;
  const sx = glyphWidth / 100;

  const renderCol = (col: number[], alpha: number) => {
    const idxs = [0, 1, 2, 3].sort((a, b) => Math.abs(col[a]) - Math.abs(col[b]));
    let posY = 0;
    let negY = 0;
    const parts: string[] = [];
    for (const i of idxs) {
      const v = col[i];
      if (!v) continue;
      const a = ((v < 0) ? negativealpha : 1.0) * alpha;
      const hPx = Math.abs(v) * ppu;
      const ty = (v < 0)
        ? (negY += 0, negY += hPx, negY - hPx)
        : -(posY + hPx);
      if (v >= 0) posY += hPx;
      else negY += 0;
      const sy = hPx / 100;
      parts.push(`<g transform="translate(0, ${ty})"><g transform="scale(${sx},${sy})">${alphabet[i]
        .component({ fill: alphabet[i].color, fillOpacity: a })}</g></g>`);
    }
    return parts.join("");
  };

  const stacks = values.map((col, i) => {
    const inHL = (highlightLen > 0) && (i >= highlightStart && i < highlightStart + highlightLen);
    const alpha = inHL ? 1.0 : outsideAlpha;
    return `<g transform="translate(${i * glyphWidth}, ${posPix})">${renderCol(col, alpha)}</g>`;
  }).join("");

  const totalWidth = values.length * glyphWidth;
  const totalHeight = stackHeight;
  const svg = `<svg width="100%" height="100%" viewBox="0 0 ${totalWidth} ${totalHeight}">${stacks}</svg>`;
  targetElement.innerHTML = svg;
}


