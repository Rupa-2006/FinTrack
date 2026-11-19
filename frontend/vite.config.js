import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    // The browser only ever talks to its own origin; Vite forwards /api to the backend.
    // Production does the same with a hosting rewrite, which keeps the refresh cookie first-party.
    proxy: { '/api': { target: 'http://127.0.0.1:5000', changeOrigin: false } },
  },
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
    testTimeout: 15000,
    fileParallelism: false,
  },
});
