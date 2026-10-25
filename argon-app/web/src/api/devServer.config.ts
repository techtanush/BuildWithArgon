// OWNER: tanush
// Server-only adapter: pnpm dev --config src/api/devServer.config.ts
// Keep credentials in proxy headers; never export them through define or envPrefix.
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vite.config';

export function createDevConfig(env: Record<string, string | undefined>) {
  const value = env.KERNEL_PORT || '8787';
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('KERNEL_PORT must be an integer between 1 and 65535');
  }
  const target = `http://127.0.0.1:${Number(value)}`;
  const token = env.KERNEL_TOKEN;
  return mergeConfig(base, defineConfig({
    server: {
      host: '127.0.0.1',
      proxy: Object.fromEntries(['/v1', '/health', '/preview', '/media'].map(path => [path, {
        target,
        changeOrigin: true,
        ...(path === '/v1' && token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      }])),
    },
  }));
}

export default defineConfig(({ mode }) => {
  const appDirectory = fileURLToPath(new URL('../../../', import.meta.url));
  return createDevConfig(loadEnv(mode, appDirectory, 'KERNEL_'));
});
