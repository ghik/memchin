import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/audio': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
    allowedHosts: ['m2.taila53100.ts.net'],
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
