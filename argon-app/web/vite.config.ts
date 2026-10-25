// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

export function createWebConfig(env: Record<string, string | undefined>) {
  const port = env.KERNEL_PORT || '8787';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('KERNEL_PORT must be an integer between 1 and 65535');
  const target = 'http://127.0.0.1:' + Number(port);
  return defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/v1': { target, changeOrigin: true, ...(env.KERNEL_TOKEN ? { headers: { Authorization: `Bearer ${env.KERNEL_TOKEN}` } } : {}) },
      '/health': { target, changeOrigin: true },
      '/preview': { target, changeOrigin: true },
      '/media': { target, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'], environment: 'node' },
});
}

export default defineConfig(({ mode }) => createWebConfig(loadEnv(mode, fileURLToPath(new URL('../', import.meta.url)), 'KERNEL_')));
