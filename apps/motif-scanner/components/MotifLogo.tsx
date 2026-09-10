
import React, { useMemo } from 'react';

interface MotifLogoProps {
  logoCols: number[][];
  rna?: boolean;
  height?: number;
  glyphWidth?: number;
  trimLeft?: number;
  trimRight?: number;
}

const MotifLogo: React.FC<MotifLogoProps> = ({ 
  logoCols, 
  height = 40, 
  glyphWidth = 12,
  trimLeft = 0,
  trimRight = 0,
  rna = false
}) => {
  const dnaColors = ["#109648", "#255C99", "#F7B32B", "#D62828"]; // A, C, G, T
  
  const glyphs = {
    A: `M 0 100 L 33 0 L 66 0 L 100 100 L 75 100 L 66 75 L 33 75 L 25 100 Z M 41 55 L 50 25 L 58 55 Z`,
    C: `M 100 28 C 100 -13 0 -13 0 50 C 0 113 100 113 100 72 L 75 72 C 75 90 30 90 30 50 C 30 10 75 10 75 28 L 100 28`,
    G: `M 100 28 C 100 -13 0 -13 0 50 C 0 113 100 113 100 72 L 100 48 L 55 48 L 55 72 L 75 72 C 75 90 30 90 30 50 C 30 10 75 5 75 28 L 100 28`,
    T: `M 0 0 L 0 20 L 35 20 L 35 100 L 65 100 L 65 20 L 100 20 L 100 0 L 0 0`,
    U: `M 0 0 L 25 0 L 25 60 C 25 80 75 80 75 60 L 75 0 L 100 0 L 100 60 C 100 105 0 105 0 60 Z`
  };

  const glyphPaths = [glyphs.A, glyphs.C, glyphs.G, rna ? glyphs.U : glyphs.T];

  const paths = useMemo(() => {
    const renderedCols: React.ReactNode[] = [];
    
    const posSums = logoCols.map(col => col.reduce((a, v) => a + Math.max(0, v), 0));
    const negSums = logoCols.map(col => col.reduce((a, v) => a + Math.min(0, v), 0));
    const posMax = Math.max(1e-9, ...posSums);
    const negMin = Math.min(0, ...negSums);
    const totalRange = posMax + Math.abs(negMin);
    const ppu = height / (totalRange || 1);
    const posPix = posMax * ppu;

    logoCols.forEach((col, colIdx) => {
      // Sort indices by absolute value magnitude
      const sortedIdxs = [0, 1, 2, 3].sort((a, b) => Math.abs(col[a]) - Math.abs(col[b]));
      
      let posY = 0;
      let negY = 0;

      const letterGroup = sortedIdxs.map((baseIdx) => {
        const val = col[baseIdx];
        if (Math.abs(val) < 0.001) return null;

        const hPx = Math.abs(val) * ppu;
        const scaleY = hPx / 100; 
        
        let ty;
        if (val < 0) {
           ty = negY;
           negY += hPx;
        } else {
           ty = -(posY + hPx);
           posY += hPx;
        }

        // Base paths are 100x100. Transform puts them in place.
        return (
          <g key={baseIdx} transform={`translate(0, ${ty})`}>
            <g transform={`scale(${glyphWidth/100}, ${scaleY})`}>
               <path 
                 fill={dnaColors[baseIdx]} 
                 fillOpacity={val < 0 ? 0.5 : 1} 
                 d={glyphPaths[baseIdx]} 
               />
            </g>
          </g>
        );
      });

      renderedCols.push(
        <g key={colIdx} transform={`translate(${colIdx * glyphWidth}, ${posPix})`}>
          {letterGroup}
        </g>
      );
    });

    return renderedCols;
  }, [logoCols, height, glyphWidth, rna]);

  const totalWidth = logoCols.length * glyphWidth;

  return (
    <svg width={totalWidth} height={height} className="overflow-visible block">
      {paths}
      {/* Overlay for trimmed regions - using slate-950 (background color) with lower opacity to let bases show through */}
      {trimLeft > 0 && (
         <rect 
           x={0} y={0} width={trimLeft * glyphWidth} height={height} 
           fill="#020617" fillOpacity="0.5"
         />
      )}
      {trimRight > 0 && (
         <rect 
           x={(logoCols.length - trimRight) * glyphWidth} y={0} 
           width={trimRight * glyphWidth} height={height} 
           fill="#020617" fillOpacity="0.5"
         />
      )}
    </svg>
  );
};

export default MotifLogo;
