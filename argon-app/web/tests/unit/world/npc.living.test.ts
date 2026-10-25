import { describe, expect, it, vi } from "vitest";
import { Group, Mesh, Vector3, Bone, Quaternion } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { Character } from "../../../src/world/npc/Character";
import { NpcManager, type NpcManagerOptions } from "../../../src/world/npc/NpcManager";
import { activityFromActual, clearPosition, clearSegment, type ActualNpcActivity } from "../../../src/world/npc/activity";
import { departmentLeads, executivePlacements } from "../../../src/world/npc/executive";
import { fallbackFace } from "../../../src/world/npc/faces";
import { buildBuilding } from "../../../src/world/buildings";
import type { Manifest } from "../../../src/shared/contracts";
import type { CharacterAsset } from "../../../src/world/assets/manifest.contract";
import type { Collider } from "../../../src/world/player/Collision";
import manifestJson from "../../../src/world/data/manifest.fallback.json";
const manifest = manifestJson as unknown as Manifest;
const working: ActualNpcActivity = { status: "working", active_run_id: "run-real", run_status: "running" };
const player = new Vector3(100, 1.6, 100);
function makeManager(extra: Partial<NpcManagerOptions> = {}) {
  const npc = manifest.npcs.find(n => n.agent_id === "eng.tech-lead")!;
  return new NpcManager({ scene: new Group(), manifest, buildingId: npc.building_id, slots: { [npc.agent_id]: { position: [0, 0, 0] } }, ...extra });
}
function frames(manager: NpcManager, count = 500) { for (let i = 0; i < count; i++) manager.update(0.1, player); }
describe("grounded NPC work state", () => {
  it("requires a real active run or an in-progress ticket, never a work label alone", () => {
    expect(activityFromActual({ status: "working" }).status).toBe("idle");
    expect(activityFromActual({ status: "working", current_ticket_id: "ticket" }).status).toBe("idle");
    expect(activityFromActual({ ...working, run_status: "queued" }).status).toBe("idle");
    expect(activityFromActual({ ...working, run_status: "succeeded" }).status).toBe("idle");
    expect(activityFromActual({ ...working, active_run_id: " " }).status).toBe("idle");
    expect(activityFromActual(working)).toMatchObject({ status: "working", pose: "typing", runId: "run-real" });
    expect(activityFromActual({ status: "in_progress", current_ticket_id: "t-real", ticket_status: "in_progress", pose: "reviewing" })).toMatchObject({ status: "working", pose: "reviewing", ticketId: "t-real" });
  });
  it("keeps idle/blocked/offline agents non-working even with stale evidence", () => {
    for (const status of ["idle", "paused", "done", "offline", "blocked", "waiting_approval"])
      expect(activityFromActual({ ...working, status }).pose).toBe("idle");
  });
  it("applies Record and Map snapshots and clears omitted/stale agents", () => {
    const m = makeManager(); const c = m.get("eng.tech-lead")!.character;
    m.applyActivity({ "eng.tech-lead": working }); expect(c.activity.status).toBe("working");
    m.applyActivity(new Map([["eng.tech-lead", { status: "idle" }]])); expect(c.activity.status).toBe("idle");
    m.applyActivity(new Map([["eng.tech-lead", working]])); expect(c.activity.status).toBe("working");
    m.applyActivity({}); expect(c.activity.status).toBe("idle");
    m.dispose();
  });
});
describe("lifelike stationary work poses", () => {
  it("animates typing only during evidenced work and relaxes back to idle", () => {
    const c = new Character(fallbackFace("typist"));
    const arms = (c as unknown as { arms: Group[] }).arms;
    c.setSeated(true); c.setActivity(working);
    for (let i = 0; i < 20; i++) c.update(0.1);
    expect(arms[0].rotation.x).toBeLessThan(-0.8);
    expect(arms[1].rotation.x).toBeLessThan(-0.8);
    const before = arms[1].rotation.x; c.update(0.04);
    expect(arms[1].rotation.x).not.toBe(before);
    expect(c.head.rotation.x).toBeGreaterThan(0.1);
    c.setActivity({ status: "idle" });
    for (let i = 0; i < 30; i++) c.update(0.1);
    expect(arms[0].rotation.x).toBeCloseTo(0, 4);
    expect(arms[1].rotation.x).toBe(0);
    expect(c.group.position.toArray()).toEqual([0, 0, 0]); c.dispose();
  });
  it("preserves the Argon head profile and independent blinks/head turns while idle", () => {
    const c = new Character(fallbackFace("observer"));
    expect(c.group.getObjectByName("argon-continuous-head")).toBeDefined();
    const eyes = c.head.children.filter(n => n instanceof Group);
    let minimumEyeScale = 1, maximumYaw = 0;
    for (let i = 0; i < 600; i++) { c.update(0.025); minimumEyeScale = Math.min(minimumEyeScale, eyes[0].scale.y); maximumYaw = Math.max(maximumYaw, Math.abs(c.head.rotation.y)); }
    expect(minimumEyeScale).toBeLessThan(0.4); expect(maximumYaw).toBeGreaterThan(0.08);
    expect(c.activity.status).toBe("idle"); c.dispose();
  });
  it("never accepts seated walking, preserves floor origin, and handles invalid frame deltas", () => {
    const c = new Character(fallbackFace("seated")); c.setWalking(true); expect(c.isWalking).toBe(true);
    c.setSeated(true); c.setWalking(true); expect(c.isWalking).toBe(false);
    c.setActivity(working); c.setWalking(true); expect(c.isWalking).toBe(false);
    c.update(NaN); c.update(Infinity); c.update(-1);
    expect(Number.isFinite(c.head.rotation.x)).toBe(true); expect(c.group.position.y).toBe(0); c.dispose();
  });
  it("composes declared GLTF arm offsets without accumulating rotation drift", async () => {
    const root = new Group(), left = new Bone(), right = new Bone(), spine = new Bone();
    left.name = "leftArm"; right.name = "rightArm"; spine.name = "spine"; root.add(left, right, spine);
    const original = new Quaternion();
    const model = { scene: root, scenes: [root], animations: [], cameras: [], asset: { version: "2.0" }, parser: {}, userData: {} } as unknown as GLTF;
    const asset: CharacterAsset = { id: "pose-test", url: "/real.glb", lods: [], skinTone: 2, hair: "short", build: "average", heightM: 1.78, bones: { head: "head", neck: "neck", spine: "spine", armL: "leftArm", armR: "rightArm" }, animations: [], triangles: 0, credit: { source: "test", url: "https://example.test", license: "CC0" } };
    const load = vi.spyOn(GLTFLoader.prototype, "loadAsync").mockResolvedValue(model);
    try {
      const c = new Character(fallbackFace("rig-typist"), { avatar: asset }); await c.ready;
      // Loading now clones the shared source GLTF; procedural offsets must bind the live clone only.
      const runtimeLeft = c.group.getObjectByName("leftArm")!;
      c.setActivity(working);
      for (let i = 0; i < 100; i++) c.update(0.1);
      expect(left.quaternion.angleTo(original)).toBeCloseTo(0);
      expect(runtimeLeft.quaternion.angleTo(original)).toBeGreaterThan(0.3);
      expect(runtimeLeft.quaternion.angleTo(original)).toBeLessThan(0.4);
      c.setActivity({ status: "idle" }); c.update(0.1); expect(runtimeLeft.quaternion.angleTo(original)).toBeCloseTo(0);
      c.dispose(); expect(root.parent).toBeNull();
    } finally { load.mockRestore(); }
  });
});
describe("bounded collision-aware movement", () => {
  it("does not cross thin walls even with clear endpoints", () => {
    const wall: Collider[] = [{ kind: "obb", x: 0, z: 0, hw: 0.01, hd: 3, rotY: 0 }];
    expect(clearSegment(-1, 0, 1, 0, 0.35, wall, () => true)).toBe(false);
    expect(clearSegment(-1, -4, 1, -4, 0.35, wall, () => true)).toBe(true);
    expect(clearSegment(-1, -4, 1, -4, 0.35, [], x => x < 0)).toBe(false);
  });
  it("never roams without both colliders and a walkability callback", () => {
    for (const extra of [{}, { colliders: [] }, { walkable: () => true }, { colliders: [], walkable: () => true, roamRadius: 0 }]) {
      const m = makeManager(extra); frames(m); expect(m.get("eng.tech-lead")!.position.toArray()).toEqual([0, 0, 0]); m.dispose();
    }
  });
  it("moves within the recorded slot radius and stops for a real work snapshot", () => {
    const m = makeManager({ colliders: [], walkable: (x, z, r) => Math.abs(x) + r < 2 && Math.abs(z) + r < 2, roamRadius: 1 });
    let farthest = 0;
    for (let i = 0; i < 500; i++) { m.update(0.1, player); farthest = Math.max(farthest, m.get("eng.tech-lead")!.position.length()); }
    expect(farthest).toBeGreaterThan(0.2); expect(farthest).toBeLessThanOrEqual(1);
    const live = m.get("eng.tech-lead")!;
    expect(live.collider.x).toBe(live.position.x); expect(live.collider.z).toBe(live.position.z);
    m.applyActivity({ "eng.tech-lead": working }); const last = m.get("eng.tech-lead")!.position.clone(); frames(m, 100);
    expect(m.get("eng.tech-lead")!.position.equals(last)).toBe(true); m.dispose();
  });
  it("does not move seated agents or through blocking furniture", () => {
    const m = makeManager({ colliders: [], walkable: () => true, slots: { "eng.tech-lead": { position: [0, 0, 0], seated: true } } });
    frames(m); expect(m.get("eng.tech-lead")!.position.toArray()).toEqual([0, 0, 0]); m.dispose();
    const furniture: Collider[] = [{ kind: "obb", x: 0.8, z: 0, hw: 0.2, hd: 1.3, rotY: 0 }];
    const n = makeManager({ colliders: furniture, walkable: () => true });
    for (let i = 0; i < 500; i++) { n.update(0.1, player); const p = n.get("eng.tech-lead")!.position; expect(clearPosition(p.x, p.z, 0.35 * n.get("eng.tech-lead")!.character.face.build, furniture)).toBe(true); }
    n.dispose();
  });
});
describe("actual executive department leads", () => {
  it("selects all 13 real original department lead records, never concierge or invented people", () => {
    const leads = departmentLeads(manifest);
    expect(leads).toHaveLength(13); expect(new Set(leads.map(n => n.agent_id)).size).toBe(13);
    expect(new Set(leads.map(n => n.department_id)).size).toBe(13);
    for (const lead of leads) expect(manifest.npcs.includes(lead)).toBe(true);
    expect(leads.some(n => n.agent_id === "concierge")).toBe(false);
  });
  it("places 13 unique local lead presentations against actual Town Hall furniture/walls", () => {
    const built = buildBuilding("chief-of-staff", "interior", { source: "fallback" });
    try {
      const colliders: Collider[] = built.recording.colliders.filter(c => c.yMax > 0.15 && c.yMin < 1.75).map(c => c.kind === "circle" ? { kind: "circle", x: c.x, z: c.z, r: c.radius! } : { kind: "obb", x: c.x, z: c.z, hw: c.halfX!, hd: c.halfZ!, rotY: c.rotY ?? 0 });
      const before = JSON.stringify(manifest);
      const m = new NpcManager({ scene: new Group(), manifest, buildingId: "b-chief-of-staff", colliders, executiveMeeting: true });
      expect(m.entries.size).toBe(13);
      const seen: Collider[] = [...colliders];
      for (const e of m.entries.values()) {
        expect(e.npc).toBe(manifest.npcs.find(n => n.agent_id === e.npc.agent_id));
        expect(e.group.userData.executiveMeeting).toBe(true);
        expect(clearPosition(e.position.x, e.position.z, 0.4, seen, { minX: -8.3, maxX: 8.3, minZ: -6.3, maxZ: 5.5 })).toBe(true);
        seen.push({ kind: "circle", x: e.position.x, z: e.position.z, r: 0.48 });
      }
      expect(JSON.stringify(manifest)).toBe(before); m.dispose();
    } finally { built.dispose(); }
  });
  it("is opt-in, Town Hall only, and fails closed without navigation evidence or free space", () => {
    const ordinary = makeManager({ executiveMeeting: true, colliders: [] }); expect(ordinary.entries.size).toBe(1); ordinary.dispose();
    const none = new NpcManager({ scene: new Group(), manifest, buildingId: "b-chief-of-staff", executiveMeeting: true }); expect(none.entries.size).toBe(0); none.dispose();
    expect(executivePlacements(departmentLeads(manifest), [{ kind: "obb", x: 0, z: 0, hw: 100, hd: 100, rotY: 0 }]).size).toBe(0);
    expect(executivePlacements(departmentLeads(manifest), [], {}, () => false).size).toBe(0);
  });
  it("ignores duplicate manifest records and never creates duplicate scene groups", () => {
    const dup = { ...manifest, npcs: [...manifest.npcs, ...manifest.npcs] };
    const m = new NpcManager({ scene: new Group(), manifest: dup, buildingId: "b-chief-of-staff", colliders: [], executiveMeeting: true });
    expect(m.entries.size).toBe(13); m.dispose();
  });
});
describe("NPC activity teardown", () => {
  it("releases scene resources once and ignores later updates/status/greetings", () => {
    const scene = new Group(), m = makeManager({ scene, colliders: [], walkable: () => true });
    const c = m.get("eng.tech-lead")!.character;
    const mesh = c.group.getObjectByProperty("type", "Mesh") as Mesh;
    const release = vi.spyOn(mesh.geometry, "dispose");
    m.applyActivity({ "eng.tech-lead": working }); m.dispose(); m.dispose();
    m.applyActivity({ "eng.tech-lead": working }); m.setActive("eng.tech-lead"); m.update(0.1, player);
    c.setActivity(working); c.setWalking(true); c.greet(); c.update(0.1);
    expect(m.entries.size).toBe(0); expect(scene.children).toHaveLength(0); expect(c.activity.status).toBe("idle"); expect(c.isWalking).toBe(false); expect(release).toHaveBeenCalledTimes(1);
  });
});
