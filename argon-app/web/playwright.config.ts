// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

import { defineConfig } from '@playwright/test';

// e2e specs: tests/e2e/dashboard.spec.ts (tanush), tests/e2e/world.spec.ts (mahin).
// Run `make dev` first, or set E2E_BASE_URL.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});
