// OWNER: mahin
import { describe, it, expect } from "vitest";
import fallback from "../../../src/world/data/manifest.fallback.json";
import {
  createLayout,
  isOnRoad,
  localToWorld,
  theta,
  at,
} from "../../../src/world/city/layout";
describe("deterministic frozen layout", () => {
  it("matches every frozen manifest number, edge and building", () => {
    expect(createLayout()).toEqual(fallback);
  });
  it("has 52 unique nodes and 65 edges", () => {
    const m = createLayout();
    expect(new Set(m.roads.nodes.map((n) => n.id)).size).toBe(52);
    expect(m.roads.edges).toHaveLength(65);
  });
  it("rotates building fronts toward the plaza", () => {
    for (let i = 0; i < 13; i++) {
      const front = localToWorld([0, 14], at(132, theta(i)), -theta(i));
      expect(Math.hypot(...front)).toBeCloseTo(118, 1);
    }
  });
  it("recognizes road widths and offroad gaps", () => {
    expect(isOnRoad(0, -60)).toBe(true);
    expect(isOnRoad(4.1, -60)).toBe(false);
    expect(isOnRoad(0, -115)).toBe(true);
    expect(isOnRoad(3.1, -115)).toBe(false);
    expect(isOnRoad(92, 0)).toBe(true);
  });
});
