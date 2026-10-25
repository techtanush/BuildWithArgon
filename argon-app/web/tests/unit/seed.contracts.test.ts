// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

// Seed contract tests — must stay green on every branch and after the merge.
import { describe, expect, it } from 'vitest';
import type { Manifest } from '../../src/shared/contracts';
import manifestJson from '../../src/world/data/manifest.fallback.json';
import house from '../../src/world/buildings/example/house.example';
import { CRITICAL_PROBES } from '../../src/world/probes/types';
import { mockApi } from '../../src/shared/worldApi';

const manifest = manifestJson as unknown as Manifest;

describe('fallback manifest (05-world/03-city-layout.md)', () => {
  it('has 13 buildings, 52 nodes, 65 edges, 29 NPCs', () => {
    expect(manifest.buildings).toHaveLength(13);
    expect(manifest.roads.nodes).toHaveLength(52);
    expect(manifest.roads.edges).toHaveLength(65);
    expect(manifest.npcs).toHaveLength(29);
  });
  it('matches the plot table', () => {
    const eng = manifest.buildings.find((b) => b.department_id === 'engineering')!;
    expect(eng.plot_center[0]).toBeCloseTo(31.59, 1);
    expect(eng.plot_center[1]).toBeCloseTo(128.16, 1);
    const m0 = manifest.roads.nodes.find((n) => n.id === 'M0')!;
    expect(m0.pos[0]).toBeCloseTo(22.02, 1);
    expect(m0.pos[1]).toBeCloseTo(-89.33, 1);
  });
});

describe('frozen world contracts', () => {
  it('example module exposes both builders', () => {
    expect(typeof house.buildExterior).toBe('function');
    expect(typeof house.buildInterior).toBe('function');
  });
  it('critical probes are P1-P5', () => {
    expect(CRITICAL_PROBES).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
  });
  it('mock world api answers with a route card', async () => {
    const res = await mockApi.concierge('ven_x', { text: 'who did pricing?' });
    expect(res.route_card?.building_id).toBe('b-market-research');
  });
});
