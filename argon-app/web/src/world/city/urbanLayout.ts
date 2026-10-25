// OWNER: mahin
// Presentation adapter requested by Mahin: preserve backend IDs and frozen contracts,
// replace only world-space placement and navigation in the browser.
import type { Manifest, XZ } from '../../shared/contracts';
export const STREET_COORDS = [-216, -144, -72, 0, 72, 144, 216];
export const BLOCK_SIZE = 72;
export const ROAD_WIDTH = 14;
export const CITY_LIMIT = 430;
export const SQUARE: XZ = [36, 36];
export const STREET_NAMES = ['Pacific', 'California', 'Foundry', 'Market', 'Mission', 'Bay'];
const PLOTS: {
    center: XZ;
    rotation: number;
    road: XZ;
}[] = [
    { center: [-36, -36], rotation: 0, road: [-36, 0] },
    { center: [36, -36], rotation: 0, road: [36, 0] },
    { center: [108, -36], rotation: 0, road: [108, 0] },
    { center: [-108, -36], rotation: 0, road: [-108, 0] },
    { center: [-36, 36], rotation: Math.PI / 2, road: [0, 36] },
    { center: [108, 36], rotation: -Math.PI / 2, road: [72, 36] },
    { center: [-36, 108], rotation: Math.PI, road: [-36, 72] },
    { center: [36, 108], rotation: Math.PI, road: [36, 72] },
    { center: [108, 108], rotation: Math.PI, road: [108, 72] },
    { center: [-108, 108], rotation: Math.PI, road: [-114, 72] },
    { center: [-108, 36], rotation: 0, road: [-102, 72] },
    { center: [36, -108], rotation: 0, road: [36, -72] },
    { center: [108, -108], rotation: 0, road: [108, -72] },
];
function hill(x: number, z: number) { const nx = (x + 144) / 160, nz = (z + 75) / 210; const fx = Math.max(0, 1 - nx * nx), fz = Math.max(0, 1 - nz * nz); return 21 * fx * fx * fz * fz; }
export function cityHeight(x: number, z: number): number { let height = hill(x, z); for (const p of PLOTS) {
    const d = Math.max(Math.abs(x - p.center[0]), Math.abs(z - p.center[1]));
    if (d < 25) {
        const weight = d <= 15 ? 1 : 1 - (d - 15) / 10;
        const smooth = weight * weight * (3 - 2 * weight);
        height = height * (1 - smooth) + hill(...p.center) * smooth;
        break;
    }
} return height; }
export function cityOnRoad(x: number, z: number): boolean { return x >= -226 && x <= 226 && z >= -226 && z <= 226 && (STREET_COORDS.some(c => Math.abs(x - c) <= 7) || STREET_COORDS.some(c => Math.abs(z - c) <= 7)); }
export function cityDistrict(x: number, z: number): string { if (x > 165)
    return 'The Embarcadero'; if (x < -75 && z < 0)
    return 'Pacific Heights'; if (z < -90)
    return 'Financial District'; if (z > 90)
    return 'Foundry Quarter'; return 'Founders Square'; }
export function createUrbanManifest(source: Manifest): Manifest {
    const out = structuredClone(source);
    const nodes: Manifest['roads']['nodes'] = [], edges: Manifest['roads']['edges'] = [];
    const jid = (i: number, j: number) => `J:${i}:${j}`;
    for (let i = 0; i < STREET_COORDS.length; i++)
        for (let j = 0; j < STREET_COORDS.length; j++) {
            nodes.push({ id: jid(i, j), pos: [STREET_COORDS[i], STREET_COORDS[j]] });
            if (i < 6)
                edges.push([jid(i, j), jid(i + 1, j)]);
            if (j < 6)
                edges.push([jid(i, j), jid(i, j + 1)]);
        }
    out.buildings = out.buildings.map((b, i) => { const p = PLOTS[i % PLOTS.length]; const door = `D${b.index}`; nodes.push({ id: door, pos: [...p.road] }); const near = nodes.filter(n => n.id.startsWith('J:') && (n.pos[0] === p.road[0] || n.pos[1] === p.road[1])).sort((a, b) => Math.hypot(a.pos[0] - p.road[0], a.pos[1] - p.road[1]) - Math.hypot(b.pos[0] - p.road[0], b.pos[1] - p.road[1])).slice(0, 2); near.forEach(n => edges.push([door, n.id])); return { ...b, plot_center: [...p.center], rotation_y: p.rotation, theta: -p.rotation, footprint: [28, 28], door_node: door }; });
    // Schema-compatible roads: ring metadata retained only for legacy clients; the engine
    // and map render the actual node/edge graph and city street definitions.
    out.roads = { ...out.roads, nodes, edges, spoke_width: ROAD_WIDTH, driveway_width: ROAD_WIDTH };
    out.plaza = { ...out.plaza, radius: 27, fountain: { pos: [36, 0, 36], radius: 4.5 }, concierge: { ...out.plaza.concierge, pos: [36, 0, 47.5], facing_y: 0 }, spawn: { pos: [65, 1.65, 60], yaw: 0 }, car: { pos: [72, 0, 53], heading: 0 } };
    return out;
}
export const urbanEnabled = () => typeof location === 'undefined' || new URLSearchParams(location.search).get('layout') !== 'campus';
