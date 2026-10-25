// OWNER: mahin
import { describe, it, expect } from 'vitest';
import data from '../../../src/world/data/manifest.fallback.json';
import type { Manifest } from '../../../src/shared/contracts';
import { createUrbanManifest, cityHeight, cityOnRoad } from '../../../src/world/city/urbanLayout';
import { RoadGraph } from '../../../src/world/nav/RoadGraph';
describe('city presentation adapter', () => { const source = data as Manifest; const city = createUrbanManifest(source); it('preserves department and agent identities without mutating frozen input', () => { expect(city.buildings.map(b => b.department_id)).toEqual(source.buildings.map(b => b.department_id)); expect(city.npcs).toEqual(source.npcs); expect(city.buildings[0].plot_center).not.toEqual(source.buildings[0].plot_center); }); it('has navigable routes to all thirteen street-side stops', () => { const g = new RoadGraph(city.roads); for (const b of city.buildings) {
    const path = g.path([72, 53], b.door_node);
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual(g.nodes.get(b.door_node)?.pos);
} }); it('recognizes roads rather than lawns and circular rings', () => { expect(cityOnRoad(72, 45)).toBe(true); expect(cityOnRoad(36, 36)).toBe(false); expect(cityOnRoad(240, 0)).toBe(false); }); it('keeps waterfront flat and introduces western hills', () => { expect(cityHeight(220, 0)).toBe(0); expect(cityHeight(-144, -75)).toBeGreaterThan(19); expect(cityHeight(36, 36)).toBe(0); }); });
describe('urban route safety', () => { const city = createUrbanManifest(data as Manifest), g = new RoadGraph(city.roads); it('all 156 distinct department-to-department routes stay on streets and have no zero-length first step', () => { for (const from of city.buildings)
    for (const to of city.buildings) {
        if (from === to)
            continue;
        const start = g.nodes.get(from.door_node)!.pos, path = g.path(start, to.door_node);
        expect(path.length).toBeGreaterThan(1);
        expect(Math.hypot(path[1][0] - path[0][0], path[1][1] - path[0][1])).toBeGreaterThan(0);
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i];
            for (let t = 0; t <= 1; t += .1)
                expect(cityOnRoad(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)).toBe(true);
        }
    } }); });
