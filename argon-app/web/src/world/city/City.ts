// OWNER: mahin
import * as THREE from "three";
import type { Manifest, ManifestBuilding } from "../../shared/contracts";
import { MaterialLibrary } from "../kit/materials";
import { buildBuilding } from "../buildings";
import { buildRoads } from "./roads";
import { buildPlaza } from "./plaza";
import { buildScenery } from "./props";
import { textSign } from "./signage";
import {buildUrbanRoads} from "./UrbanRoads";
import {buildUrbanBlocks} from "./UrbanBlocks";
import leafCardUrl from "../assets/original/coastal-leaf-card.webp";
import {batchExteriors} from "./batchExteriors";
import {buildStreetLife} from "./StreetLife";
import {buildWaterfront} from "./Waterfront";
import {cityHeight,urbanEnabled} from "./urbanLayout";
import {
  EMPTY_MANIFEST,
  type AssetManifest,
} from "../assets/manifest.contract";
import type { Collider } from "../player/Collision";
export interface CityDoor {
  building: ManifestBuilding;
  position: THREE.Vector3;
}
export class City {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [
    { kind: "circle", x: 0, z: 0, r: 4.8 },
    { kind: "obb", x: 0, z: 9.6, hw: 1.3, hd: 0.5, rotY: 0 },
  ];
  readonly doors: CityDoor[] = [];
  readonly plaza: ReturnType<typeof buildPlaza>;
  readonly scenery?: ReturnType<typeof buildScenery>;
  private streets?:ReturnType<typeof buildUrbanRoads>;
  private streetLife?:ReturnType<typeof buildStreetLife>;
  private foliageTexture?:THREE.Texture;
  private blocks?:ReturnType<typeof buildUrbanBlocks>;
  private waterfront?:ReturnType<typeof buildWaterfront>;
  private builds: ReturnType<typeof buildBuilding>[] = [];
  private exteriorBatch?:ReturnType<typeof batchExteriors>;
  private libraries: MaterialLibrary[] = [];
  constructor(
    readonly manifest: Manifest,
    readonly materials: MaterialLibrary,
    readonly assets: AssetManifest = EMPTY_MANIFEST,
  ) {
    const urban=urbanEnabled();
    this.group.name=urban?"Foundry City":"Foundry Town";
    if(urban){this.streets=buildUrbanRoads(materials);this.group.add(this.streets.group);this.blocks=buildUrbanBlocks(materials,manifest,cityHeight);this.group.add(this.blocks.group);this.colliders.push(...this.blocks.colliders);this.waterfront=buildWaterfront(materials,cityHeight);this.group.add(this.waterfront.group);this.colliders.push(...this.waterfront.colliders);this.foliageTexture=new THREE.TextureLoader().load(leafCardUrl);this.foliageTexture.colorSpace=THREE.SRGBColorSpace;this.foliageTexture.anisotropy=8;this.streetLife=buildStreetLife(materials,cityHeight,this.foliageTexture);this.group.add(this.streetLife.group);this.colliders.push(...this.streetLife.colliders);this.colliders[0]={kind:"circle",x:36,z:36,r:4.8};this.colliders[1]={kind:"obb",x:36,z:45.6,hw:1.3,hd:.5,rotY:0};this.colliders.push({kind:"obb",x:-234,z:0,hw:2,hd:236,rotY:0},{kind:"obb",x:0,z:-234,hw:236,hd:2,rotY:0},{kind:"obb",x:0,z:234,hw:236,hd:2,rotY:0});}
    else this.group.add(buildRoads(manifest, materials));
    this.plaza = buildPlaza(materials);
    if(urban){this.plaza.group.position.set(36,.19,36);for(const child of [...this.plaza.group.children]){if(child instanceof THREE.Mesh&&((child.geometry instanceof THREE.CircleGeometry&&child.geometry.parameters.radius>20)||(child.geometry instanceof THREE.RingGeometry&&child.geometry.parameters.outerRadius>6))){child.geometry.dispose();child.removeFromParent();}}}
    this.group.add(this.plaza.group);
    if(!urban){this.scenery = buildScenery(manifest, materials);this.group.add(this.scenery.group);}
    const welcome = textSign("FOUNDRY", "A company you can walk into", 2.2);
    welcome.position.set(urban?36:0,1.45,urban?46.03:10.03);
    this.group.add(welcome);
    for (const b of manifest.buildings) {
      const library = new MaterialLibrary(
        {
          accent: b.color,
          accentDark: new THREE.Color(b.color).multiplyScalar(0.55).getStyle(),
        },
        materials.tier,
      );
      this.libraries.push(library);
      void library.load(assets);
      const built = buildBuilding(b.department_id, "exterior", {
        materials: library,
      });
      this.builds.push(built);
      const group = built.group;
      group.position.set(b.plot_center[0], urban?cityHeight(...b.plot_center):0, b.plot_center[1]);
      group.rotation.y = b.rotation_y;
      this.group.add(group);
      group.updateMatrixWorld(true);
      const record = built.recording as any;
      const z = (record.entrances?.[0]?.z ?? 10.5) + 1.5;
      const position = new THREE.Vector3(0, 0, z).applyMatrix4(
        group.matrixWorld,
      );
      this.doors.push({ building: b, position });
      for (const c of (record.colliders ?? []).filter(
        (c: any) => c.yMax > 0.15 && c.yMin < 1.75,
      )) {
        const center = new THREE.Vector3(c.x, 0, c.z).applyMatrix4(
          group.matrixWorld,
        );
        this.colliders.push(
          c.kind === "circle"
            ? { kind: "circle", x: center.x, z: center.z, r: c.radius ?? c.r }
            : {
                kind: "obb",
                x: center.x,
                z: center.z,
                hw: c.halfX ?? c.hw,
                hd: c.halfZ ?? c.hd,
                rotY: (c.rotY ?? 0) + b.rotation_y,
              },
        );
      }
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 0.91, 48),
        new THREE.MeshBasicMaterial({
          color: "#e2c887",
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(position);
      ring.position.y = (urban?cityHeight(position.x,position.z):0)+0.21;
      this.group.add(ring);
    }
    if(urban){this.exteriorBatch=batchExteriors(this.builds.map(b=>b.group),materials);this.group.add(this.exteriorBatch.group);}
  }
  setQuality(tier:"high"|"medium"|"low"){this.scenery?.setQuality(tier);this.blocks?.setQuality(tier);}
  update(t: number) {
    this.plaza.update(t);this.waterfront?.update(t);
  }
  dispose() {
    this.exteriorBatch?.dispose();
    this.builds.forEach((b) => b.dispose());
    this.libraries.forEach((m) => m.dispose());
    this.plaza.dispose();
    this.scenery?.dispose();this.streets?.dispose();this.blocks?.dispose();this.waterfront?.dispose();this.streetLife?.dispose();this.foliageTexture?.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o.userData.ownedTexture) o.userData.ownedTexture.dispose();
      }
    });
    this.group.clear();
  }
}
