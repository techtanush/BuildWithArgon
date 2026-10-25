import { describe, it, expect } from "vitest";
import { Group, Vector3 } from "three";
import {
  fallbackFace,
  faceForNpc,
  validFace,
} from "../../../src/world/npc/faces";
import { Character } from "../../../src/world/npc/Character";
import { NpcManager } from "../../../src/world/npc/NpcManager";
import manifestJson from "../../../src/world/data/manifest.fallback.json";
import type { Manifest } from "../../../src/shared/contracts";
const manifest = manifestJson as unknown as Manifest;
describe("deterministic human NPCs", () => {
  it("generates valid stable faces with diversity", () => {
    const a = fallbackFace("eng.builder");
    expect(a).toEqual(fallbackFace("eng.builder"));
    expect(validFace(a)).toBe(true);
    expect(a).not.toEqual(fallbackFace("qa.tester"));
    expect(faceForNpc({ agent_id: "x", face: null })).toEqual(
      fallbackFace("x"),
    );
  });
  it("rejects malformed generated faces", () => {
    expect(validFace({ ...fallbackFace("x"), height: 99 })).toBe(false);
    expect(validFace({ ...fallbackFace("x"), hair_color: "red" })).toBe(false);
  });
  it("builds and animates a human fallback without WebGL or assets", () => {
    const c = new Character(fallbackFace("x"));
    expect(c.head.position.y).toBe(1.64);
    expect(c.group.children.length).toBeGreaterThan(0);
    c.update(0.1, new Vector3(2, 1.6, 1));
    expect(c.head.rotation.y).toBeGreaterThan(0);
    expect(c.head.rotation.y).toBeLessThan(Math.PI / 3);
    c.dispose();
    expect(c.group.parent).toBeNull();
  });
  it("filters city NPCs and finds proximity", () => {
    const manager = new NpcManager({
      scene: new Group(),
      manifest,
      buildingId: null,
    });
    expect(manager.entries.size).toBe(1);
    expect(
      manager.nearest(new Vector3(...manifest.plaza.concierge.pos))?.npc
        .agent_id,
    ).toBe("concierge");
    manager.dispose();
    expect(manager.entries.size).toBe(0);
  });
  it("places building NPCs from recorded scoped slots only", () => {
    const npc = manifest.npcs.find((n) => n.agent_id !== "concierge")!;
    const manager = new NpcManager({
      scene: new Group(),
      manifest,
      buildingId: npc.building_id,
      slots: {
        [`${npc.building_id}:${npc.slot}`]: {
          position: [1, 0, 2],
          facingY: 0.3,
        },
      },
    });
    expect(manager.get(npc.agent_id)?.position.toArray()).toEqual([1, 0, 2]);
    manager.dispose();
  });
});
