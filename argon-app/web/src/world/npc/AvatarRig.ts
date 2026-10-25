// OWNER: mahin
import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { CharacterAsset } from "../assets/manifest.contract";
import type { FaceSpec } from "./FaceSpec";
import { VISEMES, type MouthShape } from "./visemes";
/** GLTFLoader creates resources per load. Release each unique owned resource exactly once. */
export function disposeNpcObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>(),
    skeletons = new Set<THREE.Skeleton>();
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      geometries.add(obj.geometry);
      for (const material of Array.isArray(obj.material)
        ? obj.material
        : [obj.material])
        materials.add(material);
    }
    if (obj instanceof THREE.SkinnedMesh) skeletons.add(obj.skeleton);
  });
  for (const material of materials)
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  const closed = new Set<unknown>();
  for (const texture of textures) {
    texture.dispose();
    const image = texture.source?.data;
    if (
      typeof ImageBitmap !== "undefined" &&
      image instanceof ImageBitmap &&
      !closed.has(image)
    ) {
      image.close();
      closed.add(image);
    }
  }
}
export class AvatarRig {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  private head?: THREE.Object3D;
  private jaw?: THREE.Object3D;
  private headRest?: THREE.Quaternion;
  private jawRest?: THREE.Quaternion;
  private meshes: THREE.Mesh[] = [];
  private idle?: THREE.AnimationAction;
  private talk?: THREE.AnimationAction;
  private sit?: THREE.AnimationAction;
  private action?: THREE.AnimationAction;
  private disposed = false;
  constructor(
    gltf: GLTF,
    readonly asset: CharacterAsset,
    face: FaceSpec,
  ) {
    this.root = gltf.scene;
    this.root.scale.multiplyScalar(1.78 / Math.max(0.1, asset.heightM));
    this.mixer = new THREE.AnimationMixer(this.root);
    // Do not convert a single material to an array: ungrouped geometry would disappear.
    const tinted = new Set<THREE.Material>();
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        this.meshes.push(obj);
        for (const material of Array.isArray(obj.material)
          ? obj.material
          : [obj.material]) {
          if (
            material.name === asset.outfitMaterial &&
            !tinted.has(material) &&
            "color" in material
          ) {
            (material as THREE.MeshStandardMaterial).color.multiply(
              new THREE.Color(face.outfit_color),
            );
            tinted.add(material);
          }
        }
      }
    });
    this.head = this.root.getObjectByName(asset.bones.head);
    this.jaw = asset.bones.jaw
      ? this.root.getObjectByName(asset.bones.jaw)
      : undefined;
    this.headRest = this.head?.quaternion.clone();
    this.jawRest = this.jaw?.quaternion.clone();
    const idle = gltf.animations.find((a) => /idle/i.test(a.name));
    const talk = gltf.animations.find((a) => /talk|speak/i.test(a.name));
    const sit = gltf.animations.find((a) => /sit/i.test(a.name));
    if (idle) this.idle = this.mixer.clipAction(idle);
    if (talk) this.talk = this.mixer.clipAction(talk);
    if (sit) this.sit = this.mixer.clipAction(sit);
  }
  get supportsSitting(): boolean {
    return !!this.sit;
  }
  update(
    dt: number,
    headRotation: THREE.Euler,
    mouth: MouthShape,
    blink: number,
    speaking: boolean,
    seated: boolean,
  ): void {
    if (this.disposed) return;
    const action = seated
      ? this.sit
      : speaking
        ? (this.talk ?? this.idle)
        : this.idle;
    if (action !== this.action) {
      this.action?.fadeOut(0.15);
      action?.reset().fadeIn(0.15).play();
      this.action = action;
    }
    // Reset before mixer evaluation; then compose offsets, not Euler replacement or cumulative drift.
    if (this.head && this.headRest) this.head.quaternion.copy(this.headRest);
    if (this.jaw && this.jawRest) this.jaw.quaternion.copy(this.jawRest);
    this.mixer.update(dt);
    if (this.head)
      this.head.quaternion.multiply(
        new THREE.Quaternion().setFromEuler(headRotation),
      );
    if (this.jaw)
      this.jaw.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          (THREE.MathUtils.clamp(mouth.open / 0.07, 0, 1) * Math.PI) / 10,
        ),
      );
    const open = THREE.MathUtils.clamp(mouth.open, 0, 0.07),
      width = THREE.MathUtils.clamp(mouth.width, 0.05, 0.1);
    const weights = new Map<string, number>();
    const candidates = Object.entries(this.asset.visemes ?? {})
      .flatMap(([key, name]) => {
        const v = VISEMES[key as keyof typeof VISEMES];
        return v && name
          ? [{ name, d: (v.open - open) ** 2 + (v.width - width) ** 2 }]
          : [];
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    // Closed M remains available while speaking; all morphs relax fully after speech ends.
    const sum = candidates.reduce(
      (total, c) => total + 1 / (c.d + 0.000001),
      0,
    );
    for (const c of candidates)
      weights.set(c.name, speaking ? 1 / (c.d + 0.000001) / sum : 0);
    for (const mesh of this.meshes) {
      const dict = mesh.morphTargetDictionary,
        influences = mesh.morphTargetInfluences;
      if (!dict || !influences) continue;
      for (const name of Object.values(this.asset.visemes ?? {})) {
        if (!name || dict[name] === undefined) continue;
        const i = dict[name];
        influences[i] = THREE.MathUtils.damp(
          influences[i],
          weights.get(name) ?? 0,
          25,
          dt,
        );
      }
      for (const name of Object.values(this.asset.blink ?? {})) {
        const i = dict[name];
        if (i !== undefined) influences[i] = blink;
      }
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    disposeNpcObject(this.root);
    this.root.removeFromParent();
  }
}
