import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: '.',
  resolve: {
    alias: {
      '@resources': path.resolve(__dirname, '../../resources')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
