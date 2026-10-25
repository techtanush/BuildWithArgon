import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildStreetLife } from "../../../src/world/city/StreetLife";
import { MaterialLibrary } from "../../../src/world/kit/materials";
import { cityHeight } from "../../../src/world/city/urbanLayout";
import { resolveCircle } from "../../../src/world/player/Collision";

const streets = [-216, -144, -72, 0, 72, 144, 216];
describe("instanced static street life", () => {
  it("provides 42 detailed parked vehicles without blocking travel lanes or crossings", () => {
    const materials = new MaterialLibrary();
    const scene = buildStreetLife(materials, cityHeight);
    const vehicles = scene.group.userData.parkedVehicles as {x: number;z: number;width: number;length: number;kind: string}[];
    expect(vehicles).toHaveLength(42);
    expect(vehicles.some((car) => car.kind === "van")).toBe(true);
    for (const car of vehicles) {
      expect(car.width).toBeLessThanOrEqual(1.8);
      expect(car.length).toBeLessThanOrEqual(4.5);
      const road = streets.reduce((a, b) => Math.abs(car.x-a) < Math.abs(car.x-b) ? a : b);
      expect(Math.abs(car.x-road)).toBeCloseTo(5.6);
      expect(Math.abs(car.x-road)-car.width/2).toBeGreaterThan(3);
      expect(Math.min(...streets.map((z) => Math.abs(car.z-z)))-car.length/2).toBeGreaterThan(14);
    }
    for (const child of scene.group.children) {
      if (!child.name.startsWith("Parked")) continue;
      const mesh = child as THREE.InstancedMesh;
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox!;
      expect(bounds.min.x).toBeGreaterThanOrEqual(-0.9);
      expect(bounds.max.x).toBeLessThanOrEqual(0.9);
      expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(4.5);
    }
    for (const [x,z,r] of [[72,53,2],[65,60,0.5],[36,36,5],[36,47.5,1]]) {
      expect(resolveCircle(x,z,r,scene.colliders).hit).toBe(false);
    }
    scene.dispose(); materials.dispose();
  });
  it("keeps street trees at block offsets, uses trunk-only collisions and meets budgets", () => {
    const materials = new MaterialLibrary();
    const scene = buildStreetLife(materials, cityHeight);
    expect(scene.group.userData.drawCalls).toBeLessThanOrEqual(35);
    expect(scene.group.userData.triangles).toBeLessThanOrEqual(100_000);
    const trees = scene.group.userData.treeCenters as {x:number;z:number}[];
    expect(trees).toHaveLength(88);
    for (const tree of trees.slice(0,84)) {
      expect(streets.some(x => Math.abs(tree.x-x-8.6)<0.0001)).toBe(true);
      expect([-180,-108,-36,36,108,180].some(z=>Math.abs(Math.abs(tree.z-z)-22)<0.0001)).toBe(true);
      const collider = scene.colliders.find(c => c.x===tree.x && c.z===tree.z);
      expect(collider?.kind).toBe("circle");
      if (collider?.kind === "circle") expect(collider.r).toBeLessThanOrEqual(0.16);
    }
    const crowns = scene.group.getObjectByName("Layered coastal tree foliage") as THREE.InstancedMesh;
    const low = scene.group.getObjectByName("Plaza low planting") as THREE.InstancedMesh;
    expect(crowns.geometry).toBe(low.geometry);
    scene.group.traverse(o=>{
      if (!(o instanceof THREE.InstancedMesh)) return;
      expect(Array.from(o.instanceMatrix.array).every(Number.isFinite)).toBe(true);
      expect(Array.from(o.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
    });
    console.info("Street life budget", {drawCalls:scene.group.userData.drawCalls,triangles:scene.group.userData.triangles});
    scene.dispose();materials.dispose();
  });
  it("disposes shared template geometry once without disposing the material library", () => {
    const materials = new MaterialLibrary();
    const barkDispose=vi.spyOn(materials.get("wood_dark"),"dispose");
    const planterDispose=vi.spyOn(materials.get("plaza_stone"),"dispose");
    const scene=buildStreetLife(materials,()=>0);
    const foliage=scene.group.getObjectByName("Layered coastal tree foliage") as THREE.InstancedMesh;
    const geometryDispose=vi.spyOn(foliage.geometry,"dispose");
    const instanceDispose=vi.spyOn(foliage,"dispose");
    scene.dispose();scene.dispose();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(instanceDispose).toHaveBeenCalledTimes(1);
    expect(barkDispose).not.toHaveBeenCalled();
    expect(planterDispose).not.toHaveBeenCalled();
    expect(scene.group.children).toHaveLength(0);
    materials.dispose();
  });
});
