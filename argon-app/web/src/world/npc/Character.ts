// OWNER: mahin
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { CharacterAsset } from "../assets/manifest.contract";
import type { FaceSpec } from "./FaceSpec";
import { LipSync } from "./LipSync";
import { AvatarRig, disposeNpcObject } from "./AvatarRig";
import { hashSeed, mulberry32 } from "./faces";
import { createHeadGeometry, headFrontZ, headProfile } from "./headGeometry";
export type CharacterMood = "idle" | "listening" | "thinking" | "speaking";
export class Character {
  readonly group = new THREE.Group();
  readonly head = new THREE.Group();
  readonly lipSync = new LipSync();
  readonly ready: Promise<void>;
  readonly face: FaceSpec;
  mood: CharacterMood = "idle";
  assetError: string | null = null;
  private body = new THREE.Group();
  private torso!: THREE.Mesh;
  private eyes: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private mouth!: THREE.Mesh;
  private rigs: AvatarRig[] = [];
  private lodLoading = false;
  private seated = false;
  private upper = new THREE.Group();
  private hips: THREE.Group[] = [];
  private knees: THREE.Group[] = [];
  private elapsed = 0;
  private blinkAt: number;
  private blinkStart = -10;
  private rng: () => number;
  private disposed = false;
  private waveUntil = 0;
  constructor(
    face: FaceSpec,
    private options: { avatar?: CharacterAsset } = {},
  ) {
    this.face = face;
    this.rng = mulberry32(hashSeed(face.agent_id));
    this.blinkAt = 2.5 + this.rng() * 3;
    this.group.name = `npc:${face.agent_id}`;
    this.group.userData.agentId = face.agent_id;
    this.group.scale.set(face.build, face.height, face.build);
    this.group.add(this.body);
    this.body.add(this.upper);
    this.buildFallback();
    this.ready = options.avatar
      ? this.loadAvatar(options.avatar)
      : Promise.resolve();
  }
  private buildFallback(): void {
    const f = this.face;
    const skin = new THREE.MeshPhysicalMaterial({
      color: f.skin,
      roughness: 0.62,
      clearcoat: 0.06,
    });
    const cloth = new THREE.MeshPhysicalMaterial({
      color: f.outfit_color,
      roughness: 0.88,
      sheen: 0.35,
      sheenColor: new THREE.Color(f.outfit_color),
    });
    const pants = new THREE.MeshStandardMaterial({
      color: f.pants_color,
      roughness: 0.9,
    });
    const hair = new THREE.MeshStandardMaterial({
      color: f.hair_color,
      roughness: 0.84,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: "#191B20",
      roughness: 0.48,
    });
    const ellipsoid = (
      parent: THREE.Object3D,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
    ) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const limb = (
      parent: THREE.Object3D,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      r: number,
      len: number,
    ) => {
      const m = new THREE.Mesh(
        new THREE.CapsuleGeometry(r, len, 4, 10),
        material,
      );
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    for (const sign of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sign * 0.105, 0.87, 0);
      this.body.add(hip);
      this.hips.push(hip);
      limb(hip, pants, 0, -0.19, 0, 0.075, 0.23);
      const knee = new THREE.Group();
      knee.position.y = -0.38;
      hip.add(knee);
      this.knees.push(knee);
      limb(knee, pants, 0, -0.2, 0, 0.062, 0.27);
      ellipsoid(knee, dark, 0, -0.435, 0.045, 0.08, 0.055, 0.15);
      const arm = new THREE.Group();
      arm.position.set(sign * 0.225, 1.38, 0);
      arm.rotation.z = sign * 0.07;
      this.upper.add(arm);
      this.arms.push(arm);
      limb(arm, cloth, 0, -0.235, 0, 0.052, 0.37);
      ellipsoid(arm, skin, 0, -0.51, 0.005, 0.042, 0.084, 0.032);
    }
    this.torso = ellipsoid(this.upper, cloth, 0, 1.15, 0, 0.23, 0.31, 0.135);
    ellipsoid(this.upper, pants, 0, 0.87, 0, 0.18, 0.13, 0.13);
    limb(this.upper, skin, 0, 1.48, 0, 0.055, 0.09);
    this.head.position.y = 1.64;
    this.upper.add(this.head);
    const headMesh = new THREE.Mesh(createHeadGeometry(), skin);
    headMesh.name = "argon-continuous-head";
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    this.head.add(headMesh);
    for (const sign of [-1, 1]) {
      ellipsoid(this.head, skin, sign * 0.105, -0.01, 0, 0.018, 0.033, 0.021);
      const eye = new THREE.Group();
      eye.position.set(
        sign * headProfile.eye_spacing,
        0.024,
        headFrontZ(headProfile.eye_spacing, 0.024) - headProfile.eye_white_depth * 0.6,
      );
      this.head.add(eye);
      this.eyes.push(eye);
      ellipsoid(
        eye,
        new THREE.MeshStandardMaterial({ color: "#ECE7DB", roughness: 0.28 }),
        0,
        0,
        0,
        headProfile.eye_white_width,
        headProfile.eye_white_height,
        headProfile.eye_white_depth,
      );
      ellipsoid(
        eye,
        new THREE.MeshStandardMaterial({ color: f.eye_color, roughness: 0.25 }),
        0,
        0,
        headProfile.eye_white_depth * 0.94,
        headProfile.eye_white_height * 0.7,
        headProfile.eye_white_height * 0.7,
        headProfile.eye_white_depth * 0.2,
      );
      ellipsoid(eye, dark, 0, 0, headProfile.eye_white_depth * 1.11,
        headProfile.eye_white_height * 0.3, headProfile.eye_white_height * 0.35,
        headProfile.eye_white_depth * 0.13);
      const brow = ellipsoid(
        this.head,
        hair,
        sign * headProfile.eye_spacing,
        0.045,
        headFrontZ(headProfile.eye_spacing, 0.045),
        0.023,
        f.brow === "thick" ? 0.004 : 0.0025,
        0.003,
      );
      brow.rotation.z = sign * (f.brow === "arched" ? 0.15 : 0);
    }
    ellipsoid(
      this.head,
      skin,
      0,
      -0.007,
      0.108,
      0.014,
      f.nose === "long" ? 0.032 : 0.024,
      0.024,
    );
    this.mouth = ellipsoid(
      this.head,
      new THREE.MeshStandardMaterial({ color: "#653E3A", roughness: 0.67 }),
      0,
      -0.061,
      0.092,
      0.026,
      0.002,
      0.006,
    );
    if (f.hair_style !== "bald") {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(1, headProfile.segments, headProfile.segments, 0, Math.PI * 2, 0, Math.PI * headProfile.hair_cap_angle),
        hair,
      );
      cap.scale.set(headProfile.head_width + 0.006, headProfile.head_height + 0.008, headProfile.head_depth + 0.006);
      cap.rotation.x = -0.08; // Argon design note: tilt slightly back, exposing the forehead.
      this.head.add(cap);
      cap.castShadow = true;
      if (["long", "bob", "ponytail"].includes(f.hair_style))
        ellipsoid(
          this.head,
          hair,
          0,
          -0.035,
          -0.069,
          0.1,
          f.hair_style === "bob" ? 0.11 : 0.19,
          0.058,
        );
      if (f.hair_style === "bun")
        ellipsoid(this.head, hair, 0, 0.08, -0.11, 0.055, 0.055, 0.05);
      if (f.hair_style === "curly")
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          ellipsoid(
            this.head,
            hair,
            Math.cos(a) * 0.08,
            0.09,
            Math.sin(a) * 0.075,
            0.035,
            0.04,
            0.035,
          );
        }
    }
    // Fine shirt/collar detail gives the fallback human-scale tailoring rather than toy blocks.
    if (["blazer", "lab_coat", "jacket", "vest"].includes(f.outfit)) {
      const shirt = new THREE.MeshStandardMaterial({
        color: "#E5E0D5",
        roughness: 0.92,
      });
      ellipsoid(this.upper, shirt, 0, 1.32, 0.12, 0.052, 0.12, 0.012);
      for (const s of [-1, 1]) {
        const lapel = ellipsoid(
          this.upper,
          cloth,
          s * 0.075,
          1.33,
          0.125,
          0.027,
          0.11,
          0.014,
        );
        lapel.rotation.z = s * 0.25;
      }
    }
    if (f.accessory.startsWith("glasses"))
      for (const s of [-1, 1]) {
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(0.024, 0.002, 5, 16),
          dark,
        );
        rim.position.set(s * 0.042, 0.025, 0.11);
        this.head.add(rim);
      }
    if (f.accessory === "scarf")
      ellipsoid(this.upper, cloth, 0, 1.46, 0, 0.086, 0.04, 0.083);
  }
  private async loadAvatar(asset: CharacterAsset, lod = false): Promise<void> {
    try {
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(lod ? asset.lods[0] : asset.url);
      if (this.disposed) {
        disposeNpcObject(gltf.scene);
        return;
      }
      const rig = new AvatarRig(gltf, asset, this.face);
      this.rigs[lod ? 1 : 0] = rig;
      this.group.add(rig.root);
      rig.root.visible = !lod;
      this.body.visible = false;
    } catch (error) {
      if (!this.disposed)
        this.assetError =
          error instanceof Error ? error.message : String(error);
    }
  }
  /** Explicit slot metadata is required; never infer chair positions from arbitrary node names. */
  setSeated(seated: boolean): void {
    this.seated = seated;
    this.upper.position.y = seated ? -0.43 : 0;
    this.hips.forEach((hip) => {
      hip.position.y = seated ? 0.44 : 0.87;
      hip.rotation.x = seated ? -Math.PI / 2 : 0;
    });
    this.knees.forEach((knee) => (knee.rotation.x = seated ? Math.PI / 2 : 0));
  }
  greet(): void {
    this.waveUntil = this.elapsed + 1;
  }
  update(dt: number, player?: THREE.Vector3): void {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    this.elapsed += dt;
    const t = this.elapsed;
    this.torso.scale.y = 0.31 * (1 + 0.012 * Math.sin(t * 1.6));
    this.body.rotation.z = 0.006 * Math.sin(t * 0.9);
    if (t >= this.blinkAt) {
      this.blinkStart = t;
      this.blinkAt = t + 2.5 + this.rng() * 3;
    }
    const blinkTime = t - this.blinkStart;
    const blink =
      blinkTime < 0.06
        ? blinkTime / 0.06
        : blinkTime < 0.14
          ? 1 - (blinkTime - 0.06) / 0.08
          : 0;
    this.eyes.forEach((e) => (e.scale.y = Math.max(0.03, 1 - blink)));
    if (player) {
      const local = this.group.worldToLocal(player.clone());
      const yaw = THREE.MathUtils.clamp(
        Math.atan2(local.x, local.z),
        -Math.PI / 3,
        Math.PI / 3,
      );
      const pitch = THREE.MathUtils.clamp(
        -Math.atan2(
          local.y - (this.seated ? 1.21 : 1.64),
          Math.hypot(local.x, local.z),
        ),
        -0.35,
        0.35,
      );
      const near = local.length() < 6;
      this.head.rotation.y = THREE.MathUtils.damp(
        this.head.rotation.y,
        near ? yaw : 0,
        8,
        dt,
      );
      this.head.rotation.x = THREE.MathUtils.damp(
        this.head.rotation.x,
        near ? pitch : 0,
        8,
        dt,
      );
    }
    this.head.rotation.z = this.mood === "listening" ? 0.08 : 0;
    const mouth = this.lipSync.update(dt);
    this.mouth.scale.set(
      THREE.MathUtils.clamp(mouth.width, 0.05, 0.1) / 2,
      Math.max(0.002, mouth.open / 2),
      0.006,
    );
    this.arms[1].rotation.x =
      this.mood === "thinking"
        ? -1.1
        : this.mood === "speaking"
          ? -0.25 + 0.15 * Math.sin(t * 2.2)
          : 0;
    this.arms[1].rotation.z =
      this.waveUntil > t ? -2.4 + 0.15 * Math.sin(t * 18) : 0.07;
    const distance = player
      ? this.group.getWorldPosition(new THREE.Vector3()).distanceTo(player)
      : 0;
    if (
      distance > 8 &&
      this.options.avatar?.lods[0] &&
      !this.lodLoading &&
      !this.rigs[1]
    ) {
      this.lodLoading = true;
      void this.loadAvatar(this.options.avatar, true);
    }
    const chosen = distance > 8 && this.rigs[1] ? this.rigs[1] : this.rigs[0];
    // A rig without a sitting clip uses the articulated procedural fallback, never clips through a chair.
    const useRig = !!chosen && (!this.seated || chosen.supportsSitting);
    this.body.visible = !useRig;
    for (const rig of this.rigs) {
      if (!rig) continue;
      rig.root.visible = useRig && rig === chosen;
      if (rig.root.visible)
        rig.update(
          dt,
          this.head.rotation,
          mouth,
          blink,
          this.lipSync.speaking || this.mood === "speaking",
          this.seated,
        );
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lipSync.stop();
    for (const rig of this.rigs) rig?.dispose();
    this.rigs = [];
    disposeNpcObject(this.body);
    this.group.removeFromParent();
    this.group.clear();
  }
}
