// OWNER: tanush; combined merge adapter delegates to the single default server-only proxy.
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { createWebConfig } from '../../vite.config';
export function createDevConfig(env: Record<string, string | undefined>) { return createWebConfig(env); }
export default defineConfig(({ mode }) => createDevConfig(loadEnv(mode, fileURLToPath(new URL('../../../', import.meta.url)), 'KERNEL_')));
