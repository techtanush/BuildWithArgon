// OWNER: mahin
import { Group, Object3D, Vector3 } from "three";
import type { Manifest, ManifestNpc } from "../../shared/contracts";
import type { AssetManifest } from "../assets/manifest.contract";
import { Character, type CharacterMood } from "./Character";
import { faceForNpc } from "./faces";
import { pickAvatar } from "./avatars";
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
}
export interface NpcManagerOptions {
  scene: Object3D;
  manifest: Manifest;
  slots?: Record<string, NpcSlot>;
  assetManifest?: AssetManifest;
  buildingId?: string | null;
  filter?: (npc: ManifestNpc) => boolean;
}
/** Slot keys: `${building_id}:${slot}`, then agent_id, then slot. Positions are scene-local. */
export class NpcManager {
  readonly entries = new Map<string, ManagedNpc>();
  readonly ready: Promise<void>;
  private activeId: string | null = null;
  constructor(private options: NpcManagerOptions) {
    const used = new Map<string, Set<string>>();
    for (const npc of options.manifest.npcs) {
      if (options.filter && !options.filter(npc)) continue;
      if (
        options.buildingId !== undefined &&
        (options.buildingId === null
          ? npc.agent_id !== options.manifest.plaza.concierge.agent_id
          : npc.building_id !== options.buildingId)
      )
        continue;
      const concierge =
        npc.agent_id === options.manifest.plaza.concierge.agent_id;
      const slot =
        options.slots?.[`${npc.building_id}:${npc.slot}`] ??
        options.slots?.[npc.agent_id] ??
        options.slots?.[npc.slot];
      // No guessed placement inside buildings: modules must supply recorded slots.
      if (!concierge && !slot) continue;
      const face = faceForNpc(
        npc,
        concierge
          ? "#C6A34B"
          : options.manifest.buildings.find(
              (b) => b.building_id === npc.building_id,
            )?.color,
      );
      const seen = used.get(npc.building_id) ?? new Set<string>();
      used.set(npc.building_id, seen);
      const avatar = pickAvatar(
        face,
        options.assetManifest?.characters ?? [],
        seen,
      );
      if (avatar) seen.add(avatar.id);
      const character = new Character(face, { avatar });
      character.setSeated(slot?.seated ?? false);
      character.group.position.fromArray(
        slot?.position ?? options.manifest.plaza.concierge.pos,
      );
      character.group.rotation.y =
        slot?.facingY ??
        (concierge ? options.manifest.plaza.concierge.facing_y : 0);
      options.scene.add(character.group);
      this.entries.set(npc.agent_id, {
        npc,
        character,
        group: character.group,
        position: character.group.position,
      });
    }
    this.ready = Promise.all(
      [...this.entries.values()].map((n) => n.character.ready),
    ).then(() => {});
  }
  get(agentId: string): ManagedNpc | undefined {
    return this.entries.get(agentId);
  }
  nearest(position: Vector3, maxDistance = 2.5): ManagedNpc | undefined {
    let found: ManagedNpc | undefined;
    for (const entry of this.entries.values()) {
      if (!entry.group.visible) continue;
      const d = entry.group
        .getWorldPosition(new Vector3())
        .distanceTo(position);
      if (d < maxDistance) {
        found = entry;
        maxDistance = d;
      }
    }
    return found;
  }
  update(dt: number, player: Vector3): void {
    for (const n of this.entries.values())
      if (n.group.visible) n.character.update(dt, player);
  }
  setActive(agentId: string | null, mood: CharacterMood = "listening"): void {
    for (const [id, n] of this.entries) {
      n.character.mood = id === agentId ? mood : "idle";
      if (id === agentId && id !== this.activeId) n.character.greet();
    }
    this.activeId = agentId;
  }
  dispose(): void {
    for (const n of this.entries.values()) n.character.dispose();
    this.entries.clear();
  }
}
