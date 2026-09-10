import React, { useMemo } from 'react';

interface HeatmapProps {
  matrix: number[][]; // rows x cols
  rowLabels: string[];
  colLabels: string[];
  title?: string;
  transposed?: boolean;
  onSwapAxes?: () => void;
}

function interpolateColor(t: number, minColor: number[], maxColor: number[]) {
    const r = Math.round(minColor[0] + (maxColor[0] - minColor[0]) * t);
    const g = Math.round(minColor[1] + (maxColor[1] - minColor[1]) * t);
    const b = Math.round(minColor[2] + (maxColor[2] - minColor[2]) * t);
    return `rgb(${r},${g},${b})`;
}

const Heatmap: React.FC<HeatmapProps> = ({
  matrix,
  rowLabels,
  colLabels,
  title,
  transposed = false,
  onSwapAxes
}) => {
  const { mat, rows, cols } = useMemo(() => {
    if (transposed) {
      // Transpose matrix: R x C -> C x R
      const R = matrix.length;
      const C = R > 0 ? matrix[0].length : 0;
      const newMat = Array(C).fill(0).map(() => Array(R).fill(0));
      for (let i = 0; i < R; i++) {
        for (let j = 0; j < C; j++) {
          newMat[j][i] = matrix[i][j];
        }
      }
      return { mat: newMat, rows: colLabels, cols: rowLabels };
        }
        return { mat: matrix, rows: rowLabels, cols: colLabels };
  }, [matrix, rowLabels, colLabels, transposed]);

  const { min, max } = useMemo(() => {
      let min = Infinity;
      let max = -Infinity;
      for (const row of mat) {
          for (const val of row) {
              if (val < min) min = val;
              if (val > max) max = val;
          }
      }
      // If empty or uniform
      if (min === Infinity) return { min: 0, max: 1 };
      if (max === min) return { min: max - 0.1, max: max + 0.1 };
      return { min, max };
  }, [mat]);

  const getColor = (val: number) => {
      // Normalize to 0-1 based on current range
      // Or use a fixed high-range if values are always high?
      // Dynamic range is better for visibility.
      const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
      
      // White to Green
      const colorLow = [255, 255, 255];
      const colorHigh = [16, 185, 129]; // Emerald 500
      
      return interpolateColor(t, colorLow, colorHigh);
  };

  const cellSize = useMemo(() => {
    const m = Math.max(rows.length, cols.length);
    if (m >= 60) return 10;
    if (m >= 45) return 12;
    if (m >= 32) return 14;
    if (m >= 22) return 16;
    if (m >= 14) return 18;
    return 22;
  }, [rows.length, cols.length]);

  const width = cols.length * cellSize + 150; // Rough estimate for margin
  const height = rows.length * cellSize + 150;

  if (mat.length === 0) return null;

  return (
    <div className="heatmap-container bg-slate-900 border border-slate-800 rounded p-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {title || (transposed ? 'DB rows × Query columns' : 'Query rows × DB columns')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div 
                    style={{ 
                        width: '120px', 
                        height: '12px', 
                        background: 'linear-gradient(to right, white, #10b981)',
                        borderRadius: '2px',
                        border: '1px solid #334155'
                    }}
                ></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>
                    <span>{min.toFixed(2)}</span>
                    <span>{max.toFixed(2)}</span>
                </div>
            </div>
            {onSwapAxes && (
            <button 
                onClick={onSwapAxes}
                className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors h-8"
            >
                Swap Axes
            </button>
            )}
        </div>
      </div>
      
      <div className="overflow-auto max-h-[600px] border border-slate-800 rounded bg-slate-950">
        <svg width={width} height={height} style={{ fontSize: '12px', minWidth: '100%' }}>
          <g transform={`translate(120, 100)`}>
            {/* Columns (Top) */}
            {cols.map((label, j) => (
              <text 
                key={`c-${j}`} 
                x={j * cellSize + cellSize / 2} 
                y={-8} 
                transform={`rotate(-90, ${j * cellSize + cellSize / 2}, -8)`}
                textAnchor="start" 
                dominantBaseline="middle"
                fill="#94a3b8"
                fontSize="11"
              >
                {label.length > 30 ? label.slice(0, 29) + '…' : label}
                <title>{label}</title>
              </text>
            ))}

            {/* Rows (Left) */}
            {rows.map((label, i) => (
              <text 
                key={`r-${i}`} 
                x={-8} 
                y={i * cellSize + cellSize / 2} 
                textAnchor="end" 
                dominantBaseline="middle"
                fill="#94a3b8"
                fontSize="11"
              >
                {label.length > 20 ? label.slice(0, 19) + '…' : label}
                <title>{label}</title>
              </text>
            ))}

            {/* Cells */}
            {mat.map((row, i) => (
              <g key={`row-${i}`}>
                {row.map((val, j) => (
                  <rect
                    key={`cell-${i}-${j}`}
                    x={j * cellSize}
                    y={i * cellSize}
                    width={cellSize - 1}
                    height={cellSize - 1}
                    fill={getColor(val)}
                  >
                    <title>{`Score: ${val.toFixed(3)}\nRow: ${rows[i]}\nCol: ${cols[j]}`}</title>
                  </rect>
                ))}
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
};

export default Heatmap;
