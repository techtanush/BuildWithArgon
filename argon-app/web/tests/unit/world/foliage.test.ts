import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createFoliage, createLeafSprayTexture } from "../../../src/world/city/Foliage";
import { buildStreetLife } from "../../../src/world/city/StreetLife";
import { MaterialLibrary } from "../../../src/world/kit/materials";

const streets = [-216, -144, -72, 0, 72, 144, 216];
const blocks = [-180, -108, -36, 36, 108, 180];
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();

describe("original airy broadleaf foliage", () => {
  it("paints a deterministic RGBA leaf spray with real holes and color variation", () => {
    const a = createLeafSprayTexture(), b = createLeafSprayTexture();
    const pixels = a.image.data!;
    expect(pixels).toEqual(b.image.data);
    expect(a.image.width).toBe(256);
    let holes = 0, solid = 0;
    const greens = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) holes++;
      if (pixels[i + 3] > 200) { solid++; greens.add(pixels[i + 1]); }
    }
    expect(holes).toBeGreaterThan(256 * 256 * 0.5);
    expect(solid).toBeGreaterThan(256 * 256 * 0.08);
    expect(greens.size).toBeGreaterThan(20);
    expect(a.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(a.generateMipmaps).toBe(true);
    a.dispose(); b.dispose();
  });

  it("fills the crown in 3D with finite rotated cards above pedestrian eye level", () => {
    const foliage = createFoliage([{ x: 0, y: 0.18, z: 0, scale: 0.86 }]);
    const { crown } = foliage;
    expect(crown.count).toBe(90);
    expect(crown.geometry.type).toBe("PlaneGeometry");
    expect(crown.geometry.getAttribute("uv").count).toBe(4);
    const xs: number[] = [], ys: number[] = [], zs: number[] = [], normals: number[] = [];
    for (let i = 0; i < crown.count; i++) {
      crown.getMatrixAt(i, matrix);
      expect(Array.from(matrix.elements).every(Number.isFinite)).toBe(true);
      position.setFromMatrixPosition(matrix);
      xs.push(position.x); ys.push(position.y); zs.push(position.z);
      normals.push(matrix.elements[10]);
      for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) {
        position.set(x, y, 0).applyMatrix4(matrix);
        expect(position.y).toBeGreaterThan(3);
        expect(Math.hypot(position.x, position.z) / 0.86).toBeLessThan(1.43);
      }
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.9);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
    expect(new Set(normals.map(n => n.toFixed(3))).size).toBeGreaterThan(70);
    expect(crown.instanceColor).not.toBeNull();
    const repeat = createFoliage([{ x: 0, y: 0.18, z: 0, scale: 0.86 }]);
    expect(crown.instanceMatrix.array).toEqual(repeat.crown.instanceMatrix.array);
    repeat.dispose(); foliage.dispose();
  });

  it("uses opaque alpha-tested double-sided color and matching shadow maps", () => {
    const supplied = new THREE.Texture();
    const foliage = createFoliage([{ x: 0, y: 0, z: 0 }], supplied, [{ x: 2, y: 0, z: 0 }]);
    const { crown, understory } = foliage;
    expect(crown.material.map).toBe(supplied);
    expect(crown.material.transparent).toBe(false);
    expect(crown.material.depthWrite).toBe(true);
    expect(crown.material.side).toBe(THREE.DoubleSide);
    expect(crown.material.alphaTest).toBeCloseTo(0.43);
    expect(crown.material.shadowSide).toBe(THREE.DoubleSide);
    expect(crown.geometry).toBe(understory.geometry);
    expect(crown.material).toBe(understory.material);
    for (const shadow of [crown.customDepthMaterial, crown.customDistanceMaterial]) {
      const material = shadow as THREE.MeshDepthMaterial;
      expect(material.map).toBe(supplied);
      expect(material.alphaTest).toBe(crown.material.alphaTest);
      expect(material.side).toBe(THREE.DoubleSide);
    }
    expect(crown.castShadow && crown.receiveShadow).toBe(true);
    foliage.dispose(); supplied.dispose();
  });

  it("retains all original colliders, trees, parked vehicles, lamps and planters", () => {
    const materials = new MaterialLibrary();
    const height = (x: number, z: number) => x * 0.001 + z * 0.002;
    const scene = buildStreetLife(materials, height);
    const expectedColliders: unknown[] = [], treeCenters: unknown[] = [], vehicles: unknown[] = [];
    streets.forEach((street, i) => blocks.forEach((mid, j) => {
      const side = (i + j) % 2 ? -1 : 1;
      const x = street + side * 5.6, z = mid + ((i * 3 + j) % 2 ? -14 : 14);
      const kind = (i * 6 + j) % 6 === 2 ? "van" : "sedan";
      vehicles.push({ x, z, width: 1.78, length: kind === "van" ? 4.5 : 4.34, kind });
      expectedColliders.push({ kind: "obb", x, z, hw: 0.89, hd: kind === "van" ? 2.25 : 2.17, rotY: 0 });
    }));
    const lamps = scene.group.getObjectByName("Slim curved streetlamps") as THREE.InstancedMesh;
    streets.forEach((street, i) => blocks.forEach((mid, j) => {
      const x = street - 8.6, z = mid + (i % 2 ? 4 : -4);
      expectedColliders.push({ kind: "circle", x, z, r: 0.12 });
      lamps.getMatrixAt(i * blocks.length + j, matrix);
      expect(matrix.elements[12]).toBeCloseTo(x, 4);
      expect(matrix.elements[13]).toBeCloseTo(height(x, z) + 0.3, 4);
      expect(matrix.elements[14]).toBeCloseTo(z, 4);
    }));
    const trunks = scene.group.getObjectByName("Street tree trunks") as THREE.InstancedMesh;
    let index = 0;
    streets.forEach((street, i) => blocks.forEach((mid, j) => {
      for (const offset of [-22, 22]) {
        const x = street + 8.6, z = mid + offset;
        treeCenters.push({ x, z });
        expectedColliders.push({ kind: "circle", x, z, r: 0.16 });
        trunks.getMatrixAt(index++, matrix);
        expect(matrix.elements[12]).toBeCloseTo(x, 4);
        expect(matrix.elements[13]).toBeCloseTo(height(x, z) + 0.18, 4);
        expect(matrix.elements[14]).toBeCloseTo(z, 4);
        const scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
        matrix.decompose(position, rotation, scale);
        expect(scale.x).toBeCloseTo(0.86 + ((i + j) % 4) * 0.06);
      }
    }));
    const planters = scene.group.getObjectByName("Plaza corner stone planters") as THREE.InstancedMesh;
    let planterIndex = 0;
    for (const x of [18, 54]) for (const z of [18, 54]) {
      treeCenters.push({ x, z });
      expectedColliders.push({ kind: "obb", x, z, hw: 1.6, hd: 1.6, rotY: 0 });
      planters.getMatrixAt(planterIndex++, matrix);
      expect(matrix.elements[12]).toBeCloseTo(x);
      expect(matrix.elements[13]).toBeCloseTo(height(x, z) + 0.19);
      expect(matrix.elements[14]).toBeCloseTo(z);
      trunks.getMatrixAt(index++, matrix);
      expect(matrix.elements[13]).toBeCloseTo(height(x, z) + 0.64);
    }
    expect(scene.colliders).toEqual(expectedColliders);
    expect(scene.group.userData.treeCenters).toEqual(treeCenters);
    expect(scene.group.userData.parkedVehicles).toEqual(vehicles);
    scene.dispose(); materials.dispose();
  });

  it("keeps the complete street life under triangle and draw-call budgets", () => {
    const materials = new MaterialLibrary();
    const scene = buildStreetLife(materials, () => 0);
    let triangles = 0, draws = 0;
    scene.group.traverse(object => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      draws++;
      const positions = object.geometry.getAttribute("position");
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      expect(Array.from(object.instanceMatrix.array).every(Number.isFinite)).toBe(true);
      triangles += (object.geometry.index?.count ?? positions.count) / 3 * object.count;
    });
    expect(draws).toBeLessThanOrEqual(23);
    expect(triangles).toBeLessThan(150_000);
    expect(scene.group.userData.drawCalls).toBe(draws);
    expect(scene.group.userData.triangles).toBe(triangles);
    console.info("Airy street foliage budget", { draws, triangles });
    scene.dispose(); materials.dispose();
  });

  it("disposes owned fallback and shared GPU resources once, never the supplied texture or library", () => {
    const foliage = createFoliage([{ x: 0, y: 0, z: 0 }]);
    const spies = [foliage.crown, foliage.understory, foliage.crown.geometry, foliage.crown.material,
      foliage.crown.material.map!, foliage.crown.customDepthMaterial!, foliage.crown.customDistanceMaterial!]
      .map(resource => vi.spyOn(resource, "dispose"));
    foliage.dispose(); foliage.dispose();
    spies.forEach(spy => expect(spy).toHaveBeenCalledTimes(1));
    const supplied = new THREE.Texture();
    const textureDispose = vi.spyOn(supplied, "dispose");
    const materials = new MaterialLibrary();
    const barkDispose = vi.spyOn(materials.get("wood_dark"), "dispose");
    const stoneDispose = vi.spyOn(materials.get("plaza_stone"), "dispose");
    const scene = buildStreetLife(materials, () => 0, supplied);
    const crown = scene.group.getObjectByName("Layered coastal tree foliage") as THREE.InstancedMesh;
    const meshDispose = vi.spyOn(crown, "dispose");
    scene.dispose(); scene.dispose();
    expect(meshDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).not.toHaveBeenCalled();
    expect(barkDispose).not.toHaveBeenCalled(); expect(stoneDispose).not.toHaveBeenCalled();
    expect(scene.group.children).toHaveLength(0);
    supplied.dispose(); materials.dispose();
  });
});
