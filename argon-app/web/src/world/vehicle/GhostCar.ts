// OWNER: mahin
import { Group, Mesh } from "three";
import type { XZ } from "../../shared/contracts";
import { pathLength } from "../nav/RoadGraph";
import { Car } from "./Car";

export interface RoadPose {
  pos: XZ;
  /** Car's forward axis is -Z, unlike checkpoint rings' +Z. */
  heading: number;
}

/** Arc-length sampling of the actual route, never a shortcut between checkpoints. */
export function sampleRoadPath(path: readonly XZ[], distance: number): RoadPose | null {
  if (!path.length) return null;
  let remaining = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  let last: RoadPose = { pos: [...path[0]], heading: 0 };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length <= 1e-8) continue;
    const heading = Math.atan2(-dx, -dz);
    if (remaining < length) {
      const t = remaining / length;
      return { pos: [a[0] + dx * t, a[1] + dz * t], heading };
    }
    remaining -= length;
    last = { pos: [...b], heading };
  }
  return last;
}

/** A visible scripted pace reference, not an AI agent or a claim of live agent work. */
export class GhostCar {
  readonly group: Group;
  readonly path: readonly XZ[];
  readonly length: number;
  distance = 0;
  private car = new Car();
  private disposed = false;

  constructor(path: readonly XZ[], readonly speed = 18) {
    this.path = path.map(p => [...p] as XZ);
    this.length = pathLength(this.path);
    this.group = this.car.group;
    this.group.name = "Route ghost / scripted pace car";
    this.group.userData.scripted = true;
    this.group.traverse(o => {
      if (!(o instanceof Mesh)) return;
      o.castShadow = false;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.transparent = true;
        m.opacity = 0.58;
        m.depthWrite = false;
        if ("color" in m) (m as import("three").MeshStandardMaterial).color.set("#43ddeb");
      }
    });
    this.update(0);
  }

  get finished(): boolean { return this.distance >= this.length; }

  update(elapsed: number, heightAt?: (x: number, z: number) => number): void {
    if (this.disposed) return;
    this.distance = Math.min(this.length, Math.max(0, Number.isFinite(elapsed) ? elapsed : 0) * Math.max(0, this.speed));
    const pose = sampleRoadPath(this.path, this.distance);
    if (!pose) { this.group.visible = false; return; }
    this.car.teleport(pose.pos[0], pose.pos[1], pose.heading);
    if (heightAt) this.car.followTerrain(heightAt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.car.dispose();
  }
}
