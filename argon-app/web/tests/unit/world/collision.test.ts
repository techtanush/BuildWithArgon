// OWNER: mahin
import { describe, it, expect } from "vitest";
import {
  resolveCircle,
  SpatialHash,
  moveCircle,
  type Collider,
} from "../../../src/world/player/Collision";
describe("circle and OBB collision", () => {
  it("resolves coincident circles without NaN", () => {
    const p = resolveCircle(0, 0, 0.35, [{ kind: "circle", x: 0, z: 0, r: 1 }]);
    expect(p.hit).toBe(true);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(1.35);
  });
  it("pushes out of an OBB interior and respects rotation", () => {
    const c: Collider = {
      kind: "obb",
      x: 0,
      z: 0,
      hw: 2,
      hd: 1,
      rotY: Math.PI / 4,
    };
    const p = resolveCircle(0, 0, 0.35, [c]);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(1.35);
    expect(resolveCircle(p.x, p.z, 0.349, [c]).hit).toBe(false);
  });
  it("handles corner contact", () => {
    const p = resolveCircle(1.1, 1.1, 0.5, [
      { kind: "obb", x: 0, z: 0, hw: 1, hd: 1, rotY: 0 },
    ]);
    expect(Math.hypot(p.x - 1, p.z - 1)).toBeCloseTo(0.5);
  });
  it("indexes rotated bounds, deduplicates and rebuilds", () => {
    const c: Collider = {
      kind: "obb",
      x: -1,
      z: -1,
      hw: 12,
      hd: 1,
      rotY: Math.PI / 4,
    };
    const grid = new SpatialHash(8, [c]);
    expect(grid.query(-9, 7, 1)).toContain(c);
    expect(grid.query(0, 0, 20)).toHaveLength(1);
    grid.rebuild([]);
    expect(grid.query(0, 0, 20)).toEqual([]);
  });
  it("prevents tunnelling and enforces circular containment", () => {
    const p = moveCircle(-10, 0, 20, 0, 0.35, [
      { kind: "obb", x: 0, z: 0, hw: 0.05, hd: 20, rotY: 0 },
    ]);
    expect(p.x).toBeLessThan(-0.39);
    expect(p.hit).toBe(true);
    const edge = moveCircle(309, 0, 5, 0, 0.35, [], 310);
    expect(edge.x).toBeCloseTo(309.65);
  });
});
