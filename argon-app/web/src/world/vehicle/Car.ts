// OWNER: mahin
import {
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  CylinderGeometry,
  BoxGeometry,
  Object3D,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
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
    const paint = new MeshPhysicalMaterial({
      color: "#b9542e",
      metalness: 0.65,
      roughness: 0.24,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
    const glass = new MeshPhysicalMaterial({
      color: "#192934",
      metalness: 0.15,
      roughness: 0.08,
      clearcoat: 1,
    });
    const rubber = new MeshStandardMaterial({
      color: "#141719",
      roughness: 0.88,
    });
    const chrome = new MeshStandardMaterial({
      color: "#bac0c4",
      metalness: 0.95,
      roughness: 0.22,
    });
    const add = (
      geometry: BoxGeometry | RoundedBoxGeometry,
      material: MeshStandardMaterial,
      x: number,
      y: number,
      z: number,
    ) => {
      const mesh = new Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.model.add(mesh);
      return mesh;
    };
    add(new RoundedBoxGeometry(2, 0.65, 4.2, 2, 0.16), paint, 0, 0.77, 0);
    add(
      new RoundedBoxGeometry(1.72, 0.68, 2.05, 2, 0.12),
      glass,
      0,
      1.37,
      0.12,
    );
    add(
      new RoundedBoxGeometry(1.74, 0.09, 1.95, 1, 0.04),
      paint,
      0,
      1.73,
      0.12,
    );
    add(new BoxGeometry(1.55, 0.15, 0.07), rubber, 0, 0.66, -2.1);
    for (const x of [-0.72, 0.72]) {
      add(
        new RoundedBoxGeometry(0.42, 0.16, 0.07, 1, 0.03),
        new MeshStandardMaterial({
          color: "#fff0d2",
          emissive: "#fff1da",
          emissiveIntensity: 2,
        }),
        x,
        0.93,
        -2.08,
      );
      add(new BoxGeometry(0.42, 0.14, 0.07), this.tail, x, 0.94, 2.08);
      add(
        new RoundedBoxGeometry(0.23, 0.13, 0.33, 1, 0.04),
        paint,
        x * 1.46,
        1.35,
        -0.45,
      );
    }
    for (const x of [-1, 1])
      for (const z of [-1.3, 1.3]) {
        const wheel = new Group();
        wheel.position.set(x, 0.39, z);
        const tire = new Mesh(
          new CylinderGeometry(0.38, 0.38, 0.3, 20),
          rubber,
        );
        tire.rotation.z = Math.PI / 2;
        tire.castShadow = true;
        wheel.add(tire);
        const hub = new Mesh(
          new CylinderGeometry(0.23, 0.23, 0.315, 12),
          chrome,
        );
        hub.rotation.z = Math.PI / 2;
        wheel.add(hub);
        this.model.add(wheel);
        this.wheels.push(wheel);
      }
  }
  async loadAsset(asset?: VehicleAsset): Promise<boolean> {
    if (!asset) return false;
    try {
      const gltf = await new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .loadAsync(asset.url);
      if (this.disposed) {
        this.disposeObject(gltf.scene);
        return false;
      }
      this.disposeObject(this.model);
      this.model.clear();
      const loaded = gltf.scene;
      loaded.rotation.y = Math.PI;
      loaded.traverse((o) => {
        if (o instanceof Mesh) {
          o.castShadow = o.receiveShadow = true;
        }
      });
      this.model.add(loaded);
      this.wheels = asset.wheels
        ? Object.values(asset.wheels)
            .map((n) => loaded.getObjectByName(n))
            .filter((x): x is Object3D => !!x)
        : [];
      return true;
    } catch {
      return false;
    }
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
    root.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          mats.add(m);
      }
    });
    mats.forEach((m) => m.dispose());
  }
  dispose(): void {
    this.disposed = true;
    this.disposeObject(this.group);
    this.group.clear();
  }
}
export default Car;
