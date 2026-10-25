// OWNER: mahin
export type Collider =
  | { kind: "circle"; x: number; z: number; r: number }
  | { kind: "obb"; x: number; z: number; hw: number; hd: number; rotY: number };
export type CollisionSource = readonly Collider[] | SpatialHash;
export interface CollisionResult {
  x: number;
  z: number;
  hit: boolean;
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export class SpatialHash {
  private cells = new Map<string, Set<Collider>>();
  constructor(
    public readonly cellSize = 8,
    colliders: readonly Collider[] = [],
  ) {
    if (!(cellSize > 0)) throw new Error("cellSize must be positive");
    this.rebuild(colliders);
  }
  clear(): void {
    this.cells.clear();
  }
  rebuild(colliders: readonly Collider[]): void {
    this.clear();
    colliders.forEach((c) => this.insert(c));
  }
  private keys(x: number, z: number, hx: number, hz: number): string[] {
    const keys: string[] = [];
    for (
      let a = Math.floor((x - hx) / this.cellSize);
      a <= Math.floor((x + hx) / this.cellSize);
      a++
    )
      for (
        let b = Math.floor((z - hz) / this.cellSize);
        b <= Math.floor((z + hz) / this.cellSize);
        b++
      )
        keys.push(`${a},${b}`);
    return keys;
  }
  insert(c: Collider): void {
    const co = c.kind === "obb" ? Math.abs(Math.cos(c.rotY)) : 0,
      si = c.kind === "obb" ? Math.abs(Math.sin(c.rotY)) : 0;
    const hx = c.kind === "circle" ? c.r : co * c.hw + si * c.hd,
      hz = c.kind === "circle" ? c.r : si * c.hw + co * c.hd;
    for (const key of this.keys(c.x, c.z, hx, hz)) {
      if (!this.cells.has(key)) this.cells.set(key, new Set());
      this.cells.get(key)!.add(c);
    }
  }
  add(c: Collider): void {
    this.insert(c);
  }
  query(x: number, z: number, radius = 0): Collider[] {
    const out = new Set<Collider>();
    for (const key of this.keys(x, z, radius, radius))
      for (const c of this.cells.get(key) ?? []) out.add(c);
    return [...out];
  }
}
export function resolveCircle(
  px: number,
  pz: number,
  pr: number,
  colliders: CollisionSource,
): CollisionResult {
  let x = px,
    z = pz,
    hit = false;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const c of colliders instanceof SpatialHash
      ? colliders.query(x, z, pr)
      : colliders) {
      if (c.kind === "circle") {
        let dx = x - c.x,
          dz = z - c.z,
          d = Math.hypot(dx, dz),
          overlap = pr + c.r - d;
        if (overlap <= 0) continue;
        if (d < 1e-9) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        x += (dx / d) * overlap;
        z += (dz / d) * overlap;
      } else {
        const co = Math.cos(c.rotY),
          si = Math.sin(c.rotY),
          dx = x - c.x,
          dz = z - c.z;
        let lx = co * dx - si * dz,
          lz = si * dx + co * dz;
        const qx = clamp(lx, -c.hw, c.hw),
          qz = clamp(lz, -c.hd, c.hd),
          ex = lx - qx,
          ez = lz - qz,
          d = Math.hypot(ex, ez);
        if (d >= pr && d > 0) continue;
        if (d > 1e-9) {
          lx += (ex / d) * (pr - d);
          lz += (ez / d) * (pr - d);
        } else if (c.hw - Math.abs(lx) < c.hd - Math.abs(lz))
          lx = (lx >= 0 ? 1 : -1) * (c.hw + pr);
        else lz = (lz >= 0 ? 1 : -1) * (c.hd + pr);
        x = c.x + co * lx + si * lz;
        z = c.z - si * lx + co * lz;
      }
      changed = hit = true;
    }
    if (!changed) break;
  }
  return { x, z, hit };
}
/** Substeps prevent high-speed tunnelling through thin walls. Boundary is containment, not a solid circle. */
export function moveCircle(
  x: number,
  z: number,
  dx: number,
  dz: number,
  r: number,
  colliders: CollisionSource,
  boundaryRadius = Infinity,
): CollisionResult {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(dx, dz) / Math.max(r * 0.5, 0.05)),
  );
  let hit = false;
  for (let i = 0; i < steps; i++) {
    const p = resolveCircle(x + dx / steps, z + dz / steps, r, colliders);
    x = p.x;
    z = p.z;
    hit ||= p.hit;
    const d = Math.hypot(x, z),
      limit = Math.max(0, boundaryRadius - r);
    if (d > limit) {
      x *= limit / d;
      z *= limit / d;
      hit = true;
    }
  }
  return { x, z, hit };
}
