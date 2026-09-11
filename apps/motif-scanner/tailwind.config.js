/** @type {import('tailwindcss').Config} */
// Palette remapped to the shared "Motif Tools" brand (see the landing page):
// ink #0B1220 / panel #121C2E / line #23324A / text #E7EDF5 / muted #8FA3BC,
// cyan accent, and the nucleotide colors. The slate/primary scales are reused
// so existing utility classes pick up the brand without per-component edits.
export default {
  content: ['./index.html', './App.tsx', './components/**/*.tsx'],
  theme: {
    extend: {
      colors: {
        slate: {
          200: '#E7EDF5',
          300: '#D3DEEC',
          400: '#A9BAD0',
          500: '#8FA3BC',
          600: '#5D7189',
          700: '#33465F',
          800: '#23324A',
          850: '#17233A',
          900: '#121C2E',
          950: '#0B1220',
        },
        primary: {
          300: '#8FE0EA',
          400: '#35C9D6',
          500: '#1FB4C2',
        },
        emerald: {
          400: '#22C08A',
          500: '#12A56F',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
};
