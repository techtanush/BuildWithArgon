// OWNER: mahin
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { CharacterAsset } from "../assets/manifest.contract";
import type { FaceSpec } from "./FaceSpec";
import { LipSync } from "./LipSync";
import { acquireAvatarAsset, AvatarRig, disposeNpcObject, instantiateAvatar, type AvatarAssetLease } from "./AvatarRig";
import { hashSeed, mulberry32 } from "./faces";
import { createHeadGeometry, headFrontZ, headProfile } from "./headGeometry";
import { activityFromActual, type ActualNpcActivity, type NpcActivity } from "./activity";
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
  private rigLeases: AvatarAssetLease[] = [];
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
  private currentActivity: NpcActivity = activityFromActual();
  private walking = false;
  private posePhase = 0;
  private rigPoseNodes = new Map<AvatarRig, { node: THREE.Object3D; rest: THREE.Quaternion; kind: "armL" | "armR" | "spine" }[]>();
  private poseOffset = new THREE.Quaternion();
  private poseAxis = new THREE.Vector3(1, 0, 0);
  get activity(): Readonly<NpcActivity> { return this.currentActivity; }
  get isSeated(): boolean { return this.seated; }
  get isWalking(): boolean { return this.walking; }
  /** Work poses must carry real active backend evidence. Conversation mood is independent. */
  setActivity(actual?: ActualNpcActivity): void {
    if (this.disposed) return;
    this.currentActivity = activityFromActual(actual);
    this.group.userData.activity = this.currentActivity.status;
    this.group.userData.activityPose = this.currentActivity.pose;
    if (this.currentActivity.status !== "idle") this.walking = false;
  }
  /** Locomotion is requested by NpcManager only after collision/path checks. */
  setWalking(walking: boolean): void {
    if (!this.disposed) this.walking = walking && !this.seated && this.currentActivity.status === "idle";
  }
  constructor(
    face: FaceSpec,
    private options: { avatar?: CharacterAsset } = {},
  ) {
    this.face = face;
    this.rng = mulberry32(hashSeed(face.agent_id));
    this.blinkAt = 2.5 + this.rng() * 3;
    this.posePhase = this.rng() * Math.PI * 2;
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
      const url = lod ? asset.lods[0] : asset.url;
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const lease = await acquireAvatarAsset(url, () => loader.loadAsync(url));
      if (this.disposed) {
        lease.release();
        return;
      }
      const rig = new AvatarRig(instantiateAvatar(lease.gltf), asset, this.face);
      const slot = lod ? 1 : 0;
      this.rigs[slot] = rig;
      this.rigLeases[slot] = lease;
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
    if (this.disposed) return;
    this.seated = seated;
    if (seated) this.walking = false;
    this.upper.position.y = seated ? -0.43 : 0;
    this.hips.forEach((hip) => {
      hip.position.y = seated ? 0.44 : 0.87;
      hip.rotation.x = seated ? -Math.PI / 2 : 0;
    });
    this.knees.forEach((knee) => (knee.rotation.x = seated ? Math.PI / 2 : 0));
  }
  greet(): void {
    if (!this.disposed) this.waveUntil = this.elapsed + 1;
  }
  update(dt: number, player?: THREE.Vector3): void {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    this.elapsed += dt;
    const t = this.elapsed;
    const p = t + this.posePhase;
    const working = this.currentActivity.status === "working";
    const typing = working && this.currentActivity.pose === "typing";
    const reviewing = working && this.currentActivity.pose === "reviewing";
    const presenting = working && this.currentActivity.pose === "presenting";
    const conversational = this.mood !== "idle" || this.lipSync.speaking;
    const gait = this.walking ? Math.sin(p * 7) : 0;
    this.hips.forEach((hip, i) => { hip.rotation.x = this.seated ? -Math.PI / 2 : gait * (i ? -0.24 : 0.24); });
    this.knees.forEach((knee, i) => { knee.rotation.x = this.seated ? Math.PI / 2 : Math.max(0, gait * (i ? 0.28 : -0.28)); });
    this.upper.rotation.x = THREE.MathUtils.damp(this.upper.rotation.x, typing && this.seated && !conversational ? 0.09 : 0, 6, dt);
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
    let gazeYaw = 0.15 * Math.sin(p * 0.43), gazePitch = 0.035 * Math.sin(p * 0.7);
    if (working && !conversational) {
      gazeYaw = 0.06 * Math.sin(p * 0.6);
      gazePitch = typing || reviewing ? 0.18 : -0.025;
    }
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
      const near = local.length() < (working && !conversational ? 2 : 6);
      if (near) { gazeYaw = yaw; gazePitch = pitch; }
    }
      this.head.rotation.y = THREE.MathUtils.damp(
        this.head.rotation.y,
        gazeYaw,
        8,
        dt,
      );
      this.head.rotation.x = THREE.MathUtils.damp(
        this.head.rotation.x,
        gazePitch,
        8,
        dt,
      );
    this.head.rotation.z = this.mood === "listening" ? 0.08 : 0;
    const mouth = this.lipSync.update(dt);
    this.mouth.scale.set(
      THREE.MathUtils.clamp(mouth.width, 0.05, 0.1) / 2,
      Math.max(0.002, mouth.open / 2),
      0.006,
    );
    this.arms[0].rotation.x = THREE.MathUtils.damp(this.arms[0].rotation.x,
      !conversational && typing ? -0.95 + 0.045 * Math.sin(p * 15) : this.walking ? -gait * 0.2 : 0, 12, dt);
    this.arms[0].rotation.z = -0.07;
    this.arms[1].rotation.x =
      this.mood === "thinking"
        ? -1.1
        : this.mood === "speaking"
          ? -0.25 + 0.15 * Math.sin(t * 2.2)
          : typing ? -0.95 + 0.045 * Math.sin(p * 15 + 1.8)
          : reviewing ? -0.8 + 0.04 * Math.sin(p * 1.2)
          : presenting ? -0.45 + 0.15 * Math.sin(p * 2.2)
          : this.walking ? gait * 0.2 : 0;
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
      if (rig.root.visible) {
        let poseNodes = this.rigPoseNodes.get(rig);
        if (!poseNodes) {
          poseNodes = [];
          for (const kind of ["armL", "armR", "spine"] as const) {
            const name = rig.asset.bones[kind];
            const node = name ? rig.root.getObjectByName(name) : undefined;
            if (node) poseNodes.push({ node, rest: node.quaternion.clone(), kind });
          }
          this.rigPoseNodes.set(rig, poseNodes);
        }
        for (const pose of poseNodes) pose.node.quaternion.copy(pose.rest);
        rig.update(
          dt,
          this.head.rotation,
          mouth,
          blink,
          this.lipSync.speaking || this.mood === "speaking",
          this.seated,
          this.walking,
        );
        for (const pose of poseNodes) {
          const sign = pose.kind === "armL" ? -1 : 1;
          const x = pose.kind === "spine"
            ? (typing && this.seated && !conversational ? 0.06 : 0.008 * Math.sin(p * 1.6))
            : conversational ? (this.mood === "speaking" ? -0.12 + 0.07 * Math.sin(p * 2.2 + sign) : 0)
            : typing ? -0.35 + 0.025 * Math.sin(p * 15 + sign)
            : reviewing ? -0.22 + 0.025 * Math.sin(p * 1.2)
            : presenting ? -0.2 + 0.09 * Math.sin(p * 2.2 + sign)
            : this.walking ? sign * gait * 0.12 : 0;
          this.poseOffset.setFromAxisAngle(this.poseAxis, x);
          pose.node.quaternion.multiply(this.poseOffset);
        }
      }
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.walking = false;
    this.currentActivity = activityFromActual();
    this.lipSync.stop();
    for (const rig of this.rigs) rig?.dispose();
    for (const lease of this.rigLeases) lease?.release();
    this.rigs = [];
    this.rigLeases = [];
    this.rigPoseNodes.clear();
    disposeNpcObject(this.body);
    this.group.removeFromParent();
    this.group.clear();
  }
}
