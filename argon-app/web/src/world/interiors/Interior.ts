// OWNER: mahin
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
    this.npcs = new NpcManager({
      scene: this.group,
      manifest,
      buildingId: building.building_id,
      slots,
      assetManifest: assets,
    });
    this.colliders = movementColliders(this.build.recording);
    this.colliders.push(
      { kind: "obb", x: -9, z: 0, hw: 0.1, hd: 7, rotY: 0 },
      { kind: "obb", x: 9, z: 0, hw: 0.1, hd: 7, rotY: 0 },
      { kind: "obb", x: 0, z: -7, hw: 9, hd: 0.1, rotY: 0 },
      { kind: "obb", x: 0, z: 7, hw: 9, hd: 0.1, rotY: 0 },
    );
    for (const n of this.npcs.entries.values())
      this.colliders.push({
        kind: "circle",
        x: n.position.x,
        z: n.position.z,
        r: 0.35,
      });
  }
  dispose() {
    this.npcs.dispose();
    this.build.dispose();
    this.materials.dispose();
    this.group.clear();
  }
}
