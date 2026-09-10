import React, { useMemo } from 'react';

interface MotifLogoProps {
  pwm: number[][]; // 4 x L (rows: A, C, G, T)
  height?: number;
  width?: number | string;
  glyphWidth?: number;
  negativeAlpha?: number;
  rc?: boolean;
  className?: string;
  fit?: 'fill' | 'contain';
}

const COLORS = ["#109648", "#255C99", "#F7B32B", "#D62828"]; // A, C, G, T

// Glyph paths (from notebook)
const GLYPHS = [
  // A
  "M 0 100 L 33 0 L 66 0 L 100 100 L 75 100 L 66 75 L 33 75 L 25 100 Z M 41 55 L 50 25 L 58 55 Z",
  // C
  "M 100 28 C 100 -13 0 -13 0 50 C 0 113 100 113 100 72 L 75 72 C 75 90 30 90 30 50 C 30 10 75 10 75 28 L 100 28",
  // G
  "M 100 28 C 100 -13 0 -13 0 50 C 0 113 100 113 100 72 L 100 48 L 55 48 L 55 72 L 75 72 C 75 90 30 90 30 50 C 30 10 75 5 75 28 L 100 28",
  // T
  "M 0 0 L 0 20 L 35 20 L 35 100 L 65 100 L 65 20 L 100 20 L 100 0 L 0 0"
];

const MotifLogo: React.FC<MotifLogoProps> = ({
  pwm,
  height = 100,
  width = '100%',
  glyphWidth = 16,
  negativeAlpha = 0.25,
  rc = false,
  className = '',
  fit = 'contain'
}) => {
  
  const rendered = useMemo(() => {
    if (!pwm || pwm.length !== 4 || pwm[0].length === 0) return null;

    const L = pwm[0].length;
    
    // Transpose to L x 4 for easier processing and handle RC
    let cols: number[][] = [];
    for (let i = 0; i < L; i++) {
      cols.push([pwm[0][i], pwm[1][i], pwm[2][i], pwm[3][i]]);
    }

    if (rc) {
      // Reverse columns and complement (A<->T, C<->G)
      // [A, C, G, T] -> [T, G, C, A] (swap 0-3, 1-2)
      cols = cols.reverse().map(c => [c[3], c[2], c[1], c[0]]);
    }

    // Calculate stacks
    const stacks = cols.map((col, i) => {
      const posSum = col.reduce((a, v) => a + Math.max(0, v), 0);
      const negSum = col.reduce((a, v) => a + Math.min(0, v), 0);
      return { col, posSum, negSum };
    });

    const posMax = Math.max(1e-9, ...stacks.map(s => s.posSum));
    const negAbs = Math.max(1e-9, ...stacks.map(s => Math.abs(s.negSum)));
    
    const ppu = height / (posMax + negAbs); // pixels per unit
    const posPix = posMax * ppu; // y-origin (baseline)
    const sx = glyphWidth / 100; // scale x (glyphs are defined in 100x100 box)

    const svgContent = stacks.map((stack, colIdx) => {
        const { col } = stack;
        // Sort by magnitude
        const idxs = [0, 1, 2, 3].sort((a, b) => Math.abs(col[a]) - Math.abs(col[b]));
        
        let posY = 0;
        let negY = 0;
        
        const glyphs = idxs.map(baseIdx => {
            const val = col[baseIdx];
            if (val === 0) return null;
            
            const isNeg = val < 0;
            const h = Math.abs(val) * ppu;
            const sy = h / 100;
            const opacity = isNeg ? negativeAlpha : 1.0;
            
            let ty = 0;
            if (isNeg) {
                ty = negY; // start at current negY
                negY += h; // increment for next
            } else {
                posY += h;
                ty = -posY; // go up from baseline
            }
            
            return (
                <g key={baseIdx} transform={`translate(0, ${ty})`}>
                    <g transform={`scale(${sx}, ${sy})`}>
                        <path 
                            d={GLYPHS[baseIdx]} 
                            fill={COLORS[baseIdx]} 
                            fillOpacity={opacity}
                            fillRule={baseIdx === 0 ? "evenodd" : undefined} // A needs evenodd
                        />
                    </g>
                </g>
            );
        });

        return (
            <g key={colIdx} transform={`translate(${colIdx * glyphWidth}, ${posPix})`}>
                {glyphs}
            </g>
        );
    });

    const totalW = L * glyphWidth;
    
    return (
        <svg 
            width={width} 
            height={height} 
            viewBox={`0 0 ${totalW} ${height}`} 
            preserveAspectRatio={fit === 'contain' ? "xMidYMid meet" : "none"}
            style={{ display: 'block', maxWidth: '100%', maxHeight: '100%' }}
        >
            {svgContent}
        </svg>
    );

  }, [pwm, height, width, glyphWidth, negativeAlpha, rc, fit]);

  return <div className={className} style={{ width: typeof width === 'number' ? width : undefined, height }}>{rendered}</div>;
};

export default MotifLogo;

