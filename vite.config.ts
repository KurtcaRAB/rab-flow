import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode preview` builds one self-contained HTML file running on demo data.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'preview' ? [react(), viteSingleFile()] : [react()],
  build: { outDir: mode === 'preview' ? 'dist-preview' : 'dist' },
}));
