// OWNER: mahin
import { PerspectiveCamera, Vector3 } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Character } from "../npc/Character";
import type { CharacterAsset } from "../assets/manifest.contract";
import type { FaceSpec } from "../npc/FaceSpec";
import type { CameraMode } from "./avatarPreferences";
import { moveCircle, type CollisionSource } from "./Collision";
export interface PlayerInput {
  forward: number;
  right: number;
  sprint?: boolean;
}
export class Player {
  readonly camera: PerspectiveCamera;
  readonly velocity = new Vector3();
  controls: PointerLockControls | null = null;
  private phase = 0;
  private readonly anchor = new Vector3();
  private heading = 0;
  private pitch = 0;
  cameraMode: CameraMode = "third";
  character: Character | null = null;
  moved = false;
  setAvatar(face: FaceSpec, avatar?: CharacterAsset) {
    this.character?.dispose();
    this.character = new Character(face, {avatar});
    this.character.group.name = "player-avatar";
    return this.character.group;
  }
  setCameraMode(mode: CameraMode) { this.cameraMode=mode; }
  present(dt: number, active = true, walking = false, ground = this.position.y - 1.65, colliders: CollisionSource = []) {
    if(this.character) {
      this.character.group.position.set(this.position.x,ground,this.position.z);
      this.character.group.rotation.y=this.heading+Math.PI;
      this.character.group.visible=active && this.cameraMode==='third';
      this.character.setWalking(active && walking && this.moved);
      this.character.update(dt);
    }
    if(!active) return;
    this.camera.rotation.set(this.pitch,this.heading,0,'YXZ');
    this.camera.position.copy(this.position);
    if(this.cameraMode==='third') {
      const distance=3.4, horizontal=Math.cos(this.pitch)*distance;
      this.camera.position.x+=Math.sin(this.heading)*horizontal;
      this.camera.position.z+=Math.cos(this.heading)*horizontal;
      this.camera.position.y=Math.max(ground+0.3,this.position.y-Math.sin(this.pitch)*distance+0.45);
      const safe=moveCircle(this.position.x,this.position.z,this.camera.position.x-this.position.x,this.camera.position.z-this.position.z,0.2,colliders);
      this.camera.position.x=safe.x;this.camera.position.z=safe.z;
    }
  }
  constructor(camera = new PerspectiveCamera(70, 1, 0.05, 900)) {
    this.camera = camera;
    this.camera.rotation.order = "YXZ";
    this.teleport([0, 1.65, 16], 0);
  }
  get position(): Vector3 {
    return this.anchor;
  }
  get yaw(): number {
    return this.heading;
  }
  set yaw(v: number) {
    this.heading = v;
  }
  attach(element: HTMLElement): PointerLockControls {
    this.controls?.dispose();
    this.controls = new PointerLockControls(this.camera, element);
    this.controls.pointerSpeed = 1.1;
    this.controls.minPolarAngle = Math.PI / 18;
    this.controls.maxPolarAngle = (Math.PI * 17) / 18;
    return this.controls;
  }
  look(dx: number, dy: number): void {
    this.yaw -= dx * 0.0022;
    this.pitch = Math.max(
      (-Math.PI * 4) / 9,
      Math.min((Math.PI * 4) / 9, this.pitch - dy * 0.0022),
    );
  }
  teleport(pos: readonly number[] | Vector3, yaw = 0): void {
    if (pos instanceof Vector3) this.position.copy(pos);
    else this.position.set(pos[0], pos[1], pos[2]);
    this.heading=yaw; this.pitch=0;
    this.camera.rotation.set(0, yaw, 0, "YXZ");
    this.camera.position.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.moved=false;
  }
  update(
    dt: number,
    input: PlayerInput,
    colliders: CollisionSource = [],
    boundaryRadius = Infinity,
  ): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const len = Math.max(1, Math.hypot(input.forward, input.right)),
      speed = input.sprint ? 8 : 4.5,
      f = (input.forward / len) * speed,
      r = (input.right / len) * speed;
    const tx = -Math.sin(this.yaw) * f + Math.cos(this.yaw) * r,
      tz = -Math.cos(this.yaw) * f - Math.sin(this.yaw) * r,
      blend = 1 - Math.exp(-12 * dt);
    this.velocity.x += (tx - this.velocity.x) * blend;
    this.velocity.z += (tz - this.velocity.z) * blend;
    const p = moveCircle(
      this.position.x,
      this.position.z,
      this.velocity.x * dt,
      this.velocity.z * dt,
      0.35,
      colliders,
      boundaryRadius,
    );
    this.moved=Math.hypot(p.x-this.position.x,p.z-this.position.z)>0.001;
    this.position.x = p.x;
    this.position.z = p.z;
    const v = Math.hypot(this.velocity.x, this.velocity.z);
    this.phase += v * 2.2 * dt;
    this.position.y = 1.65 + (v > 0.1 ? 0.035 * Math.sin(this.phase) : 0);
  }
  dispose(): void {
    this.controls?.dispose();
    this.character?.dispose();
  }
}
export default Player;
