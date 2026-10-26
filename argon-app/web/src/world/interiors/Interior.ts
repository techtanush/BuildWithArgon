// OWNER: mahin
import { executiveSeats } from './executiveRoom';
import { departmentLeads } from '../npc/executive';
import * as THREE from "three";
import type { Manifest, ManifestBuilding } from "../../shared/contracts";
import type { AssetManifest } from "../assets/manifest.contract";
import { MaterialLibrary } from "../kit/materials";
import { buildBuilding } from "../buildings";
import { NpcManager, type NpcSlot } from "../npc/NpcManager";
import type { Collider } from "../player/Collision";
export function movementColliders(recording: any): Collider[] {
  return (recording.colliders ?? [])
    .filter((c: any) => c.yMax > 0.15 && c.yMin < 1.75)
    .map((c: any) =>
      c.kind === "circle"
        ? { kind: "circle", x: c.x, z: c.z, r: c.radius ?? c.r }
        : {
            kind: "obb",
            x: c.x,
            z: c.z,
            hw: c.halfX ?? c.hw,
            hd: c.halfZ ?? c.hd,
            rotY: c.rotY ?? 0,
          },
    );
}
export class Interior {
  readonly group = new THREE.Group();
  private materials: MaterialLibrary;
  readonly build: ReturnType<typeof buildBuilding>;
  readonly npcs: NpcManager;
  readonly colliders: Collider[];
  constructor(
    readonly building: ManifestBuilding,
    manifest: Manifest,
    assets?: AssetManifest,
  ) {
    this.group.name = `interior:${building.department_id}`;
    this.materials = new MaterialLibrary({
      accent: building.color,
      accentDark: new THREE.Color(building.color)
        .multiplyScalar(0.55)
        .getStyle(),
    });
    if (assets) void this.materials.load(assets);
    this.build = buildBuilding(building.department_id, "interior", {
      materials: this.materials,
    });
    this.group.add(this.build.group);
    const slots: Record<string, NpcSlot> = {};
    for (const s of this.build.recording.slots)
      slots[s.id] = { position: s.pos, facingY: s.facingY };
    const staticColliders = movementColliders(this.build.recording);
    staticColliders.push(
      {kind:"obb",x:-9,z:0,hw:.1,hd:7,rotY:0},
      {kind:"obb",x:9,z:0,hw:.1,hd:7,rotY:0},
      {kind:"obb",x:0,z:-7,hw:9,hd:.1,rotY:0},
      {kind:"obb",x:0,z:7,hw:9,hd:.1,rotY:0},
    );
    this.npcs = new NpcManager({
      scene: this.group,
      manifest,
      buildingId: building.building_id,
      slots,
      assetManifest: assets,
      colliders: staticColliders,
      walkable: (x:number,z:number,r:number) => x-r > -8.8 && x+r < 8.8 && z-r > -6.8 && z+r < 6.8,
      executiveMeeting: building.department_id === "chief-of-staff",
    });
    if (building.department_id === "chief-of-staff") {
      departmentLeads(manifest).forEach((lead, index) => {
        const actor = this.npcs.get(lead.agent_id), seat = executiveSeats[index];
        if (!actor || !seat) return;
        actor.position.fromArray(seat.position);
        actor.group.rotation.y = seat.facingY;
        // Existing procedural rig has a known static sitting pose. Imported avatars
        // keep their supplied rig, with no invented animation or bone-name guesses.
        actor.character.setSeated(true);
      });
    }
    this.colliders = movementColliders(this.build.recording);
    this.colliders.push(
      { kind: "obb", x: -9, z: 0, hw: 0.1, hd: 7, rotY: 0 },
      { kind: "obb", x: 9, z: 0, hw: 0.1, hd: 7, rotY: 0 },
      { kind: "obb", x: 0, z: -7, hw: 9, hd: 0.1, rotY: 0 },
      { kind: "obb", x: 0, z: 7, hw: 9, hd: 0.1, rotY: 0 },
    );
    for (const n of this.npcs.entries.values())
      this.colliders.push(n.collider);
  }
  dispose() {
    this.npcs.dispose();
    this.build.dispose();
    this.materials.dispose();
    this.group.clear();
  }
}
