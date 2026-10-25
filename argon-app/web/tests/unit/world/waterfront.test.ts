import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildWaterfront } from "../../../src/world/city/Waterfront";
import { MaterialLibrary } from "../../../src/world/kit/materials";
import { resolveCircle } from "../../../src/world/player/Collision";

describe("original bay waterfront", () => {
  it("stays within geometry and draw-call budgets, using finite original geometry", () => {
    const materials = new MaterialLibrary();
    const waterfront = buildWaterfront(materials, (_x, z) => 1 + Math.cos(z / 80) * 0.3);
    expect(waterfront.group.userData.drawCalls).toBeLessThanOrEqual(70);
    expect(waterfront.group.userData.triangles).toBeLessThan(150_000);
    expect(waterfront.group.children.some((child) => child.name === "Animated open bay")).toBe(true);
    let countedTriangles = 0;
    waterfront.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      countedTriangles += (object.geometry.index?.count ?? positions.count) / 3;
    });
    expect(countedTriangles).toBe(waterfront.group.userData.triangles);
    console.info("Waterfront budget:", waterfront.group.userData);
    waterfront.dispose();
    materials.dispose();
  });

  it("blocks the continuous seawall including streets and pier mouths", () => {
    const materials = new MaterialLibrary();
    const waterfront = buildWaterfront(materials, () => 0);
    for (const z of [-216, -144, -130, -72, 0, 72, 130, 144, 216]) {
      const resolved = resolveCircle(237, z, 0.8, waterfront.colliders);
      expect(resolved.hit).toBe(true);
      expect(resolved.x).toBeLessThan(237);
    }
    expect(waterfront.group.userData.waterLevel).toBeCloseTo(-1.8);
    waterfront.dispose();
    materials.dispose();
  });

  it("updates GPU wave time and disposes only its own resources, idempotently", () => {
    const materials = new MaterialLibrary();
    const sidewalkDispose = vi.spyOn(materials.get("sidewalk"), "dispose");
    const timberDispose = vi.spyOn(materials.get("wood_dark"), "dispose");
    const waterfront = buildWaterfront(materials, () => 0);
    const water = waterfront.group.getObjectByName("Animated open bay") as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const disposeGeometry = vi.spyOn(water.geometry, "dispose");
    const disposeMaterial = vi.spyOn(water.material, "dispose");
    waterfront.update(12.5);
    expect(water.material.uniforms.time.value).toBe(12.5);
    waterfront.update(NaN);
    expect(water.material.uniforms.time.value).toBe(12.5);
    waterfront.dispose();
    waterfront.dispose();
    waterfront.update(15);
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(sidewalkDispose).not.toHaveBeenCalled();
    expect(timberDispose).not.toHaveBeenCalled();
    expect(waterfront.group.children).toHaveLength(0);
    materials.dispose();
  });
});
