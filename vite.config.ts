import { defineConfig } from 'vite';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERTS_DIR = path.join(__dirname, 'certs');

export default defineConfig({
  root: 'src/client',
  appType: 'spa',
  server: {
    host: true,
    port: 5173,
    https: {
      key: fs.readFileSync(path.join(CERTS_DIR, 'key.pem')),
      cert: fs.readFileSync(path.join(CERTS_DIR, 'cert.pem')),
    },
    proxy: {
      '/api': {
        target: 'https://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/audio': {
        target: 'https://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
    allowedHosts: ['m2.taila53100.ts.net'],
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
