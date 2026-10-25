import { describe, expect, it } from "vitest";
import { Mesh } from "three";
import profile from "../../../src/world/npc/argon-head-profile.json";
import { createHeadGeometry, headFrontZ, headProfile, jawTaper } from "../../../src/world/npc/headGeometry";
import { Character } from "../../../src/world/npc/Character";
import { fallbackFace } from "../../../src/world/npc/faces";

describe("Argon-generated fallback head profile", () => {
  it("retains non-photoreal provenance and generated dimensions", () => {
    expect(profile.generator_model).toBe("gemini-4-argon");
    expect(profile.photorealistic).toBe(false);
    expect(headProfile).toEqual(profile.profile);
    expect(jawTaper(-1)).toBe(0.76);
    expect(jawTaper(0)).toBe(1);
  });

  it("has finite 48x48 vertices, normals and profile bounds", () => {
    const g = createHeadGeometry();
    expect(g.parameters.widthSegments).toBe(48);
    expect(g.parameters.heightSegments).toBe(48);
    for (const key of ["position", "normal"]) {
      expect(Array.from(g.getAttribute(key).array).every(Number.isFinite)).toBe(true);
    }
    expect(g.boundingBox!.min.y).toBeCloseTo(-headProfile.head_height);
    expect(g.boundingBox!.max.y).toBeCloseTo(headProfile.head_height);
    expect(g.boundingBox!.max.x).toBeCloseTo(headProfile.head_width);
    expect(g.boundingBox!.max.z).toBeCloseTo(headProfile.head_depth);
    expect(Number.isFinite(g.boundingSphere!.radius)).toBe(true);
    expect(headFrontZ(headProfile.eye_spacing, 0.024)).toBeGreaterThan(0);
    g.dispose();
  });

  it("is a single connected surface after welding sphere seam duplicates", () => {
    const g = createHeadGeometry();
    const positions = g.getAttribute("position");
    const welded = new Map<string, number>();
    const ids: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      const key = [positions.getX(i), positions.getY(i), positions.getZ(i)]
        .map((n) => Math.round(n * 1e7)).join(",");
      if (!welded.has(key)) welded.set(key, welded.size);
      ids.push(welded.get(key)!);
    }
    const links = Array.from({ length: welded.size }, () => new Set<number>());
    const indices = g.index!;
    for (let i = 0; i < indices.count; i += 3) {
      const triangle = [0, 1, 2].map((j) => ids[indices.getX(i + j)]);
      for (const a of triangle) for (const b of triangle) links[a].add(b);
    }
    const visited = new Set<number>();
    const pending = [0];
    while (pending.length) {
      const next = pending.pop()!;
      if (visited.has(next)) continue;
      visited.add(next);
      for (const neighbor of links[next]) if (!visited.has(neighbor)) pending.push(neighbor);
    }
    expect(visited.size).toBe(welded.size);
    g.dispose();
  });

  it("installs one continuous head while preserving identity and animation", () => {
    const face = fallbackFace("concierge");
    const c = new Character(face);
    const heads = c.head.children.filter((o) => o.name === "argon-continuous-head");
    expect(heads).toHaveLength(1);
    expect((heads[0] as Mesh).geometry.getAttribute("position").count).toBe(49 * 49);
    expect(c.face).toBe(face);
    expect(c.head.position.y).toBe(1.64);
    c.setSeated(true);
    c.update(0.1);
    c.setSeated(false);
    c.dispose();
    expect(c.group.children).toHaveLength(0);
  });
});
