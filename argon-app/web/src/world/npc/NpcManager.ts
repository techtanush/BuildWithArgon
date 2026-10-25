// OWNER: mahin
import { Group, Object3D, Vector3 } from "three";
import type { Manifest, ManifestNpc } from "../../shared/contracts";
import type { AssetManifest } from "../assets/manifest.contract";
import { Character, type CharacterMood } from "./Character";
import { faceForNpc } from "./faces";
import { pickAvatar } from "./avatars";
import type { Collider } from "../player/Collision";
import { clearSegment, type ActualStatusMap, type ActualNpcActivity, type Walkable } from "./activity";
import { departmentLeads, executivePlacements, isExecutiveBuilding, type ExecutiveMeetingOptions } from "./executive";
export type { ActualNpcActivity, ActualStatusMap } from "./activity";
export interface NpcSlot {
  position: [number, number, number];
  facingY?: number;
  seated?: boolean;
}
export interface ManagedNpc {
  npc: ManifestNpc;
  character: Character;
  group: Group;
  position: Vector3;
  /** Live scene-local collision circle; consumers should retain this object, not copy x/z. */
  collider: Extract<Collider, { kind: "circle" }>;
}
export interface NpcManagerOptions {
  scene: Object3D;
  manifest: Manifest;
  slots?: Record<string, NpcSlot>;
  assetManifest?: AssetManifest;
  buildingId?: string | null;
  filter?: (npc: ManifestNpc) => boolean;
  /** Scene-local static furniture/wall colliders, excluding NPC self-colliders. */
  colliders?: readonly Collider[];
  walkable?: Walkable;
  /** Maximum distance from a recorded slot. Zero explicitly disables roaming. */
  roamRadius?: number;
  executiveMeeting?: boolean | ExecutiveMeetingOptions;
}
/** Slot keys: `${building_id}:${slot}`, then agent_id, then slot. Positions are scene-local. */
export class NpcManager {
  readonly entries = new Map<string, ManagedNpc>();
  readonly ready: Promise<void>;
  private activeId: string | null = null;
  private disposed = false;
  private walks = new Map<string, { home: Vector3; goal: Vector3 | null; wait: number; phase: number }>();
  constructor(private options: NpcManagerOptions) {
    const used = new Map<string, Set<string>>();
    const meeting = !!options.executiveMeeting && isExecutiveBuilding(options.manifest, options.buildingId);
    // Automatic gathering requires actual room colliders, even an explicitly empty room ([]).
    const leads = meeting && options.colliders ? departmentLeads(options.manifest) : [];
    const leadIds = new Set(leads.map(n => n.agent_id));
    const occupied: Collider[] = [...(options.colliders ?? [])];
    for (const npc of options.manifest.npcs) {
      if (npc.building_id !== options.buildingId || leadIds.has(npc.agent_id)) continue;
      const slot = options.slots?.[`${npc.building_id}:${npc.slot}`] ?? options.slots?.[npc.agent_id] ?? options.slots?.[npc.slot];
      if (slot) occupied.push({ kind: "circle", x: slot.position[0], z: slot.position[2], r: 0.4 });
    }
    const meetingSlots = executivePlacements(leads, occupied, typeof options.executiveMeeting === "object" ? options.executiveMeeting : {}, options.walkable);
    for (const npc of options.manifest.npcs) {
      if (options.filter && !options.filter(npc)) continue;
      if (this.entries.has(npc.agent_id)) continue;
      const meetingSlot = meetingSlots.get(npc.agent_id);
      if (!meetingSlot && options.buildingId !== undefined &&
        (options.buildingId === null ? npc.agent_id !== options.manifest.plaza.concierge.agent_id : npc.building_id !== options.buildingId)) continue;
      const concierge = npc.agent_id === options.manifest.plaza.concierge.agent_id;
      const slot = meetingSlot ?? options.slots?.[`${npc.building_id}:${npc.slot}`] ?? options.slots?.[npc.agent_id] ?? options.slots?.[npc.slot];
      // No guessed placement inside buildings: modules must supply recorded slots.
      if (!concierge && !slot) continue;
      const face = faceForNpc(npc, concierge ? "#C6A34B" : options.manifest.buildings.find(b => b.building_id === npc.building_id)?.color);
      const seen = used.get(npc.building_id) ?? new Set<string>();
      used.set(npc.building_id, seen);
      const avatar = pickAvatar(face, options.assetManifest?.characters ?? [], seen);
      if (avatar) seen.add(avatar.id);
      const character = new Character(face, { avatar });
      character.setSeated(slot?.seated ?? false);
      character.group.position.fromArray(slot?.position ?? options.manifest.plaza.concierge.pos);
      character.group.rotation.y = slot?.facingY ?? (concierge ? options.manifest.plaza.concierge.facing_y : 0);
      if (meetingSlot) character.group.userData.executiveMeeting = true;
      character.group.userData.presentationBuildingId = options.buildingId ?? npc.building_id;
      options.scene.add(character.group);
      this.walks.set(npc.agent_id, { home: character.group.position.clone(), goal: null, wait: 2 + this.entries.size * 0.71, phase: this.entries.size * 2.399 });
      const position = character.group.position;
      const collider: Extract<Collider, { kind: "circle" }> = {
        kind: "circle", get x() { return position.x; }, get z() { return position.z; }, r: 0.35 * face.build,
      };
      this.entries.set(npc.agent_id, { npc, character, group: character.group, position, collider });
    }
    this.ready = Promise.all([...this.entries.values()].map(n => n.character.ready)).then(() => {});
  }
  get(agentId: string): ManagedNpc | undefined { return this.entries.get(agentId); }
  nearest(position: Vector3, maxDistance = 2.5): ManagedNpc | undefined {
    let found: ManagedNpc | undefined;
    for (const entry of this.entries.values()) {
      if (!entry.group.visible) continue;
      const d = entry.group.getWorldPosition(new Vector3()).distanceTo(position);
      if (d < maxDistance) { found = entry; maxDistance = d; }
    }
    return found;
  }
  /** Complete snapshot: absent agents reset idle instead of retaining stale work. */
  applyActivity(actualStatusMap: ActualStatusMap): void {
    if (this.disposed) return;
    for (const [id, entry] of this.entries) {
      const state = typeof (actualStatusMap as ReadonlyMap<string, ActualNpcActivity>).get === "function"
        ? (actualStatusMap as ReadonlyMap<string, ActualNpcActivity>).get(id)
        : (actualStatusMap as Readonly<Record<string, ActualNpcActivity | undefined>>)[id];
      entry.character.setActivity(state);
    }
  }
  update(dt: number, player: Vector3): void {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    for (const n of this.entries.values()) {
      if (!n.group.visible) continue;
      this.updateWalk(n, dt);
      n.character.update(dt, player);
    }
  }
  private updateWalk(n: ManagedNpc, dt: number): void {
    const walk = this.walks.get(n.npc.agent_id)!;
    const radius = Math.min(2, Math.max(0, this.options.roamRadius ?? 1.2));
    const canRoam = this.options.colliders !== undefined && this.options.walkable && radius > 0 && !n.character.isSeated && n.character.activity.status === "idle" && n.npc.agent_id !== this.activeId;
    n.character.setWalking(false);
    if (!canRoam || dt <= 0) { walk.goal = null; return; }
    const colliders: Collider[] = [...this.options.colliders!];
    for (const other of this.entries.values()) if (other !== n && other.group.visible)
      colliders.push({ kind: "circle", x: other.position.x, z: other.position.z, r: 0.36 });
    const bodyRadius = 0.35 * n.character.face.build;
    const clear = (x: number, z: number) => clearSegment(n.position.x, n.position.z, x, z, bodyRadius, colliders, this.options.walkable!);
    if (!walk.goal) {
      walk.wait -= dt;
      if (walk.wait > 0) return;
      walk.phase += 2.399;
      const goal = walk.home.clone().add(new Vector3(Math.sin(walk.phase) * radius * 0.8, 0, Math.cos(walk.phase) * radius * 0.8));
      walk.wait = 3 + (Math.sin(walk.phase) + 1) * 2;
      if (clear(goal.x, goal.z)) walk.goal = goal;
      return;
    }
    const dx = walk.goal.x - n.position.x, dz = walk.goal.z - n.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.025) { walk.goal = null; return; }
    const step = Math.min(distance, 0.5 * dt);
    const x = n.position.x + dx / distance * step, z = n.position.z + dz / distance * step;
    if (!clear(x, z)) { walk.goal = null; return; }
    n.position.x = x; n.position.z = z;
    n.group.rotation.y = Math.atan2(dx, dz);
    n.character.setWalking(true);
  }
  setActive(agentId: string | null, mood: CharacterMood = "listening"): void {
    if (this.disposed) return;
    for (const [id, n] of this.entries) {
      n.character.mood = id === agentId ? mood : "idle";
      if (id === agentId && id !== this.activeId) n.character.greet();
    }
    this.activeId = agentId;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.walks.clear();
    this.activeId = null;
    for (const n of this.entries.values()) n.character.dispose();
    this.entries.clear();
  }
}
