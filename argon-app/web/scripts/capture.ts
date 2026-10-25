// OWNER: ayan — seed version; replace/extend freely but keep the exported names.

// Headless capture + probes for worldgen (05-world/10-render-critique-loop.md §2).
//   pnpm capture --run <run_id> --iter <n> --source staging|generated|fallback [--only a,b] [--url http://...]
// Seed: prints usage. Contract with the page: window.__foundryProbe (src/world/probes/types.ts).
import type { BuildingProbeReport } from '../src/world/probes/types';

const usage = 'pnpm capture --run <run_id> --iter <n> --source staging|generated|fallback [--only a,b] [--url URL]';
const _report: BuildingProbeReport | null = null;
console.log(`capture not implemented yet (owner: ayan). Usage: ${usage}`, _report);
