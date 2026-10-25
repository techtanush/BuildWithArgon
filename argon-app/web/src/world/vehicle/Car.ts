// OWNER: mahin
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from "three";
import { buildRoadster } from "./Roadster";
import type { VehicleAsset } from "../assets/manifest.contract";
import { moveCircle, type CollisionSource } from "../player/Collision";
import { isOnRoad } from "../city/layout";
import type { RoadGraph } from "../nav/RoadGraph";
export interface CarState {
  x: number;
  z: number;
  heading: number;
  speed: number;
}
export interface CarInput {
  throttle: number;
  brake?: boolean;
  steer: number;
  handbrake?: boolean;
}
export class Car {
  readonly group = new Group();
  readonly state: CarState = { x: 6, z: 18, heading: 0, speed: 0 };
  private model = new Group();
  private wheels: Object3D[] = [];
  private accumulator = 0;
  private disposed = false;
  private tail = new MeshStandardMaterial({
    color: "#78180d",
    emissive: "#ff3010",
    emissiveIntensity: 0.3,
    roughness: 0.2,
  });
  constructor() {
    this.group.name = "foundry-car";
    this.group.add(this.model);
    this.buildFallback();
    this.sync();
  }
  private buildFallback(): void {
    const roadster = buildRoadster(this.tail);
    this.model.add(roadster.model);
    this.wheels = roadster.wheels;
  }
  /** The original roadster is the runtime vehicle, not a transient loading placeholder.
   * Legacy manifest URLs are intentionally ignored: cached generic GLBs must not replace it. */
  async loadAsset(_asset?: VehicleAsset): Promise<boolean> {
    return false;
  }
  teleport(x: number, z: number, heading = 0): void {
    Object.assign(this.state, { x, z, heading, speed: 0 });
    this.accumulator = 0;
    this.sync();
  }
  update(
    dt: number,
    input: CarInput,
    colliders: CollisionSource = [],
    onRoad: (x: number, z: number) => boolean = isOnRoad,
    boundaryRadius=310,
  ): void {
    this.accumulator += Math.min(0.1, Math.max(0, dt));
    const step = 1 / 120;
    while (this.accumulator >= step) {
      const s = this.state,
        v = s.speed,
        throttle = Math.max(0, Math.min(1, input.throttle)),
        steer = Math.max(-1, Math.min(1, input.steer));
      const a =
        throttle * 14 -
        (input.brake ? (v > 0.5 ? 28 : 8) : 0) -
        0.35 * v * (input.handbrake ? 3 : 1) -
        1.2 * Math.sign(v);
      s.speed = Math.max(
        -8,
        Math.min(onRoad(s.x, s.z) ? 36 : 14, v + a * step),
      );
      if (
        !throttle &&
        !input.brake &&
        (Math.abs(s.speed) < 0.05 || Math.sign(v) !== Math.sign(s.speed))
      )
        s.speed = 0;
      s.heading +=
        steer *
        1.9 *
        (s.speed / (Math.abs(s.speed) + 6)) *
        (input.handbrake ? 1.6 : 1) *
        step;
      const p = moveCircle(
        s.x,
        s.z,
        -Math.sin(s.heading) * s.speed * step,
        -Math.cos(s.heading) * s.speed * step,
        2,
        colliders,
        boundaryRadius,
      );
      s.x = p.x;
      s.z = p.z;
      if (p.hit) s.speed *= -0.25;
      this.wheels.forEach((w) => (w.rotation.x -= (s.speed * step) / 0.38));
      this.accumulator -= step;
    }
    this.model.rotation.z =
      -input.steer * 0.04 * Math.min(1, Math.abs(this.state.speed) / 20);
    this.tail.emissiveIntensity = input.brake ? 3 : 0.3;
    this.sync();
  }
  private sync(): void {
    this.group.position.set(this.state.x, 0, this.state.z);
    this.group.rotation.y = this.state.heading;
  }
  followTerrain(heightAt:(x:number,z:number)=>number):void {
    const {x,z,heading}=this.state,s=Math.sin(heading),c=Math.cos(heading);
    this.group.position.y=heightAt(x,z);
    this.group.rotation.order="YXZ";
    this.group.rotation.x=Math.atan2(heightAt(x-s*2,z-c*2)-heightAt(x+s*2,z+c*2),4);
    this.group.rotation.z=Math.atan2(heightAt(x+c,z-s)-heightAt(x-c,z+s),2);
  }
  exitPosition(): [number, number, number] {
    return [
      this.state.x - 2.2 * Math.cos(this.state.heading),
      1.65,
      this.state.z + 2.2 * Math.sin(this.state.heading),
    ];
  }
  reset(graph: RoadGraph): void {
    const n = graph.nearestNodes(this.state.x, this.state.z, 1)[0];
    if (n) this.teleport(n.pos[0], n.pos[1], graph.headingAt(n.id));
  }
  private disposeObject(root: Object3D): void {
    const mats = new Set<MeshStandardMaterial>();
    const geometries = new Set<import("three").BufferGeometry>();
    root.traverse((o) => {
      if (o instanceof Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          mats.add(m);
      }
    });
    geometries.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeObject(this.group);
    this.group.clear();
  }
}
export default Car;
