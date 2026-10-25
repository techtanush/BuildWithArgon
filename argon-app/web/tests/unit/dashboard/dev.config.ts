// OWNER: tanush
// Isolated browser verification without changing the frozen dev-server contract.
import { defineConfig, mergeConfig } from 'vitest/config';
import { createWebConfig } from '../../../vite.config';

export default mergeConfig(createWebConfig({}), defineConfig({
  server: {
    host: '127.0.0.1', port: 15173, strictPort: true,
    proxy: Object.fromEntries(['/v1', '/health', '/preview', '/media'].map((path) => [path, {
      target: 'http://127.0.0.1:18787', changeOrigin: true,
    }])),
  },
}));
