// OWNER: mahin
import type { Manifest, ManifestBuilding, XZ } from "../../shared/contracts";
import fallback from "../data/manifest.fallback.json";
export const N = 13,
  PLOT_R = 132,
  PLAZA_R = 30,
  RING_R = 92,
  DOOR_R = 110,
  WORLD_RADIUS = 310;
const round = (v: number, places = 2) => Number(v.toFixed(places)) + 0;
export const theta = (i: number) => (i * 2 * Math.PI) / N;
export const at = (radius: number, angle: number): XZ => [
  round(radius * Math.sin(angle)),
  round(-radius * Math.cos(angle)),
];
export function roadGraph(): Manifest["roads"] {
  const nodes: Manifest["roads"]["nodes"] = [],
    edges: [string, string][] = [];
  for (let i = 0; i < N; i++) {
    const t = theta(i);
    nodes.push(
      { id: `E${i}`, pos: at(PLAZA_R, t) },
      { id: `R${i}`, pos: at(RING_R, t) },
      { id: `M${i}`, pos: at(RING_R, t + Math.PI / N) },
      { id: `D${i}`, pos: at(DOOR_R, t) },
    );
    const j = (i + 1) % N;
    edges.push(
      [`E${i}`, `R${i}`],
      [`R${i}`, `D${i}`],
      [`R${i}`, `M${i}`],
      [`M${i}`, `R${j}`],
      [`E${i}`, `E${j}`],
    );
  }
  return {
    ring: { radius: RING_R, width: 10 },
    spoke_width: 8,
    driveway_width: 6,
    nodes,
    edges,
  };
}
export function createLayout(
  source: Manifest = fallback as Manifest,
): Manifest {
  return {
    ...structuredClone(source),
    roads: roadGraph(),
    buildings: source.buildings.map((b): ManifestBuilding => ({
      ...b,
      theta: round(theta(b.index), 6),
      plot_center: at(PLOT_R, theta(b.index)),
      rotation_y: round(-theta(b.index), 6),
      footprint: [28, 28],
      door_node: `D${b.index}`,
    })),
  };
}
export const layout = createLayout();
export const buildings = layout.buildings;
export const roads = layout.roads;
export function localToWorld(local: XZ, plot: XZ, rotationY: number): XZ {
  const c = Math.cos(rotationY),
    s = Math.sin(rotationY);
  return [
    plot[0] + c * local[0] + s * local[1],
    plot[1] - s * local[0] + c * local[1],
  ];
}
export function isOnRoad(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r <= 30 || (r >= 87 && r <= 97)) return true;
  for (let i = 0; i < N; i++) {
    const t = theta(i),
      along = x * Math.sin(t) - z * Math.cos(t),
      across = x * Math.cos(t) + z * Math.sin(t);
    if (
      (along >= 30 && along <= 87 && Math.abs(across) <= 4) ||
      (along >= 97 && along <= 118 && Math.abs(across) <= 3)
    )
      return true;
  }
  return false;
}
export function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
