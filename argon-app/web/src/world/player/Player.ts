// OWNER: mahin
import { PerspectiveCamera, Vector3 } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
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
  constructor(camera = new PerspectiveCamera(70, 1, 0.05, 900)) {
    this.camera = camera;
    this.camera.rotation.order = "YXZ";
    this.teleport([0, 1.65, 16], 0);
  }
  get position(): Vector3 {
    return this.camera.position;
  }
  get yaw(): number {
    return this.camera.rotation.y;
  }
  set yaw(v: number) {
    this.camera.rotation.y = v;
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
    this.camera.rotation.x = Math.max(
      (-Math.PI * 4) / 9,
      Math.min((Math.PI * 4) / 9, this.camera.rotation.x - dy * 0.0022),
    );
  }
  teleport(pos: readonly number[] | Vector3, yaw = 0): void {
    if (pos instanceof Vector3) this.position.copy(pos);
    else this.position.set(pos[0], pos[1], pos[2]);
    this.camera.rotation.set(0, yaw, 0, "YXZ");
    this.velocity.set(0, 0, 0);
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
    this.position.x = p.x;
    this.position.z = p.z;
    const v = Math.hypot(this.velocity.x, this.velocity.z);
    this.phase += v * 2.2 * dt;
    this.position.y = 1.65 + (v > 0.1 ? 0.035 * Math.sin(this.phase) : 0);
  }
  dispose(): void {
    this.controls?.dispose();
  }
}
export default Player;
