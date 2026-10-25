import { describe, it, expect } from "vitest";
import * as T from "three";
import {
  createKit,
  metreUV,
  transformCollider,
} from "../../../src/world/kit/primitives";
import {
  MaterialLibrary,
  MATERIAL_COLORS,
} from "../../../src/world/kit/materials";
import { createProp } from "../../../src/world/kit/props";
import { PROP_FOOTPRINTS } from "../../../src/world/kit/props.contract";
import {
  DEPARTMENTS,
  fallbackModule,
  SLOT_POSITIONS,
} from "../../../src/world/buildings/fallback/archetypes";
import {
  validateModule,
  validateRecording,
} from "../../../src/world/kit/validateModule";
import {
  proceduralTextures,
  seededRandom,
  textureUrl,
} from "../../../src/world/kit/textures";
import example from "../../../src/world/buildings/example/house.example";
import type { PropKind } from "../../../src/world/kit/types";
describe("PBR kit", () => {
  it("all material keys have deterministic PBR maps or deliberate glass", () => {
    const m = new MaterialLibrary();
    for (const key of Object.keys(
      MATERIAL_COLORS,
    ) as (keyof typeof MATERIAL_COLORS)[]) {
      const material = m.get(key);
      expect(material).toBeInstanceOf(T.MeshStandardMaterial);
      expect(m.get(key)).toBe(material);
      if (key !== "glass") {
        expect(material.map).toBeTruthy();
        expect(material.normalMap).toBeTruthy();
        expect(material.roughnessMap).toBeTruthy();
      }
    }
    m.dispose();
  });
  it("seeded randomness and procedural textures are reproducible", () => {
    const a = seededRandom(5),
      b = seededRandom(5);
    expect(Array.from({ length: 50 }, a)).toEqual(
      Array.from({ length: 50 }, b),
    );
    const x = proceduralTextures("brick", 16),
      y = proceduralTextures("brick", 16);
    expect(x.map.image.data).toEqual(y.map.image.data);
    Object.values(x).forEach((t) => t.dispose());
    Object.values(y).forEach((t) => t.dispose());
  });
  it("chooses tier resolutions without exceeding available assets", () => {
    expect(textureUrl("/{res}.webp", [1024, 2048], "high")).toBe("/2048.webp");
    expect(textureUrl("/{res}.webp", [2048], "low")).toBe("/2048.webp");
  });
  it("generates metre-scaled face UVs", () => {
    const g = metreUV(new T.BoxGeometry(4, 2, 6), 2);
    const uv = g.getAttribute("uv");
    let max = 0;
    for (let i = 0; i < uv.count; i++)
      max = Math.max(max, Math.abs(uv.getX(i)), Math.abs(uv.getY(i)));
    expect(max).toBe(1.5);
    g.dispose();
  });
  it("converts rotated local colliders to world positions", () => {
    const c = transformCollider(
      {
        kind: "obb",
        x: 2,
        z: 0,
        halfX: 1,
        halfZ: 0.5,
        rotY: 0,
        yMin: 0,
        yMax: 2,
      },
      [10, 3, 20],
      Math.PI / 2,
    );
    expect(c.x).toBeCloseTo(10);
    expect(c.z).toBeCloseTo(18);
    expect(c.yMin).toBe(3);
    expect(c.rotY).toBe(Math.PI / 2);
  });
  for (const kind of Object.keys(PROP_FOOTPRINTS) as PropKind[])
    it(`normalizes ${kind} to frozen footprint with floor origin`, () => {
      const m = new MaterialLibrary(),
        p = createProp(kind, m),
        b = new T.Box3().setFromObject(p),
        s = b.getSize(new T.Vector3()),
        f = PROP_FOOTPRINTS[kind];
      expect(s.x).toBeCloseTo(f.w, 4);
      expect(s.y).toBeCloseTo(f.h, 4);
      expect(s.z).toBeCloseTo(f.d, 4);
      expect(b.min.y).toBeCloseTo(0, 4);
      p.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      m.dispose();
    });
  it("records module calls, colliders, signs and slots", () => {
    const b = createKit({ mode: "exterior" });
    b.kit.box({
      size: [2, 3, 4],
      pos: [1, 1.5, 2],
      mat: "brick",
      collide: true,
      rotY: 0.3,
    });
    b.kit.entrance({ z: 7 });
    b.kit.sign({ pos: [0, 5, 7], width: 5 });
    b.finalize();
    expect(b.recording.colliders[0]).toMatchObject({
      halfX: 1,
      halfZ: 2,
      yMin: 0,
      yMax: 3,
      rotY: 0.3,
    });
    expect(b.recording.entrances).toHaveLength(1);
    expect(b.recording.signs[0].mesh.parent).toBe(b.group);
    expect(b.recording.triangles).toBeGreaterThan(0);
    b.dispose();
  });
  it("renders frozen example in both modes without throwing", () => {
    for (const mode of ["interior", "exterior"] as const) {
      const b = createKit({ mode });
      expect(() =>
        example[mode === "interior" ? "buildInterior" : "buildExterior"](b.kit),
      ).not.toThrow();
      b.finalize();
      expect(b.recording.triangles).toBeGreaterThan(0);
      b.dispose();
    }
  });
  it("rejects missing entrances and duplicate slots", () => {
    const e = createKit({ mode: "exterior" });
    expect(validateRecording(e.recording, "exterior").valid).toBe(false);
    e.dispose();
    const b = createKit({ mode: "interior" });
    for (let i = 0; i < 6; i++)
      b.kit.npcSlot({ id: "s1", pos: [0, 0, 0], facingY: 0 });
    expect(validateRecording(b.recording, "interior").valid).toBe(false);
    b.dispose();
  });
  for (const dept of DEPARTMENTS)
    it(`validates ${dept} exterior and exact slot positions`, () => {
      const module = fallbackModule(dept),
        r = validateModule(module);
      expect(r.errors).toEqual([]);
      const b = createKit({ mode: "interior" });
      module.buildInterior(b.kit);
      expect(b.recording.slots.map((s) => s.pos)).toEqual(SLOT_POSITIONS);
      expect(b.recording.slots.map((s) => s.id)).toEqual([
        "s1",
        "s2",
        "s3",
        "s4",
        "s5",
        "s6",
      ]);
      b.finalize();
      expect(b.recording.drawCalls).toBeLessThanOrEqual(150);
      b.dispose();
    });
});
