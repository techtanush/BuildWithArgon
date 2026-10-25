import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MaterialLibrary } from "../kit/materials";
import type { Collider } from "../player/Collision";
import { createFoliage } from "./Foliage";

export interface StreetLife {
  group: THREE.Group;
  colliders: Collider[];
  dispose(): void;
}
type Placement = { x: number; y: number; z: number; yaw?: number; pitch?: number; roll?: number; scale?: number; color?: string };
type ParkedVehicle = { x: number; z: number; width: number; length: number; kind: "sedan" | "van" };
const STREETS = [-216, -144, -72, 0, 72, 144, 216];
const BLOCKS = [-180, -108, -36, 36, 108, 180];
const PAINT = ["#485e68", "#a4aaa4", "#ded7c7", "#665e58", "#657767", "#884f48", "#424c5b", "#c1b5a0"];

/** Original, static street furniture. Templates are shared through instancing. */
export function buildStreetLife(materials: MaterialLibrary, heightAt: (x: number, z: number) => number, foliageTexture?: THREE.Texture): StreetLife {
  const group = new THREE.Group();
  group.name = "Street life / parked vehicles and coastal planting";
  const colliders: Collider[] = [];
  const ownedMaterials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const instances: THREE.InstancedMesh[] = [];
  const standard = (color: string, roughness = 0.7, metalness = 0) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    ownedMaterials.add(material);
    return material;
  };
  const paint = standard("#ffffff", 0.3, 0.35);
  const glass = standard("#344d58", 0.13, 0.48);
  const rubber = standard("#252729", 0.97);
  const metal = standard("#8b9493", 0.35, 0.75);
  const lampMetal = standard("#364446", 0.5, 0.6);
  const headlamp = standard("#e2e1d2", 0.18, 0.3);
  const taillamp = standard("#8b3028", 0.24, 0.15);
  const bark = materials.get("wood_dark");
  const planter = materials.get("plaza_stone");
  const soil = standard("#554e3c");

  const cube = (x: number, y: number, z: number, w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, top = r, sides = 7) => {
    const axis = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(top, r, axis.length(), sides);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
    geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return geometry;
  };
  const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const merge = (parts: THREE.BufferGeometry[]) => {
    const normalized = parts.map((g) => {
      const out = g.index ? g.toNonIndexed() : g;
      if (out !== g) g.dispose();
      out.deleteAttribute("uv");
      return out;
    });
    const geometry = mergeGeometries(normalized, false);
    normalized.forEach((g) => g.dispose());
    if (!geometry) throw new Error("Street life template merge failed");
    geometries.add(geometry);
    return geometry;
  };
  const place = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, locations: Placement[], colored = false) => {
    const mesh = new THREE.InstancedMesh(geometry, material, locations.length);
    mesh.name = name;
    const transform = new THREE.Object3D();
    locations.forEach((p, i) => {
      transform.position.set(p.x, p.y, p.z);
      transform.rotation.set(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0, "YXZ");
      transform.scale.setScalar(p.scale ?? 1);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      if (colored) mesh.setColorAt(i, new THREE.Color(p.color ?? "#ffffff"));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = material !== glass && material !== headlamp && material !== taillamp;
    mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
    instances.push(mesh);
    return mesh;
  };
  // Closed longitudinal loft gives tapered bumpers, shoulders and a real hood.
  const hull = (sections: [number, number, number, number][]) => {
    const vertices: number[] = [], indices: number[] = [];
    for (const [z, halfWidth, bottom, top] of sections) {
      for (const [x, y] of [[-halfWidth * 0.88, bottom], [halfWidth * 0.88, bottom],
        [halfWidth, bottom + 0.12], [halfWidth, top - 0.10], [halfWidth * 0.86, top],
        [-halfWidth * 0.86, top], [-halfWidth, top - 0.1], [-halfWidth, bottom + 0.12]]) vertices.push(x, y, z);
    }
    for (let s = 0; s < sections.length - 1; s++) for (let i = 0; i < 8; i++) {
      const a = s * 8 + i, b = s * 8 + (i + 1) % 8, c = a + 8, d = b + 8;
      indices.push(a, b, c, b, d, c);
    }
    for (let i = 1; i < 7; i++) {
      indices.push(0, i + 1, i);
      const last = (sections.length - 1) * 8;
      indices.push(last, last + i, last + i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };
  const cabin = (frontBottom: number, rearBottom: number, frontTop: number, rearTop: number, bottom: number, top: number, width: number) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      -width, bottom, rearBottom, width, bottom, rearBottom,
      -width, bottom, frontBottom, width, bottom, frontBottom,
      -width * 0.84, top, rearTop, width * 0.84, top, rearTop,
      -width * 0.84, top, frontTop, width * 0.84, top, frontTop,
    ], 3));
    geometry.setIndex([0,4,1,1,4,5, 2,3,6,3,7,6, 0,2,4,2,6,4, 1,5,3,3,5,7, 4,6,5,5,6,7, 0,1,2,1,3,2]);
    geometry.computeVertexNormals();
    return geometry;
  };

  const vehicleRecords: ParkedVehicle[] = [];
  const vehicleLocations: Record<"sedan" | "van", Placement[]> = { sedan: [], van: [] };
  STREETS.forEach((street, i) => BLOCKS.forEach((mid, j) => {
    const side = (i + j) % 2 ? -1 : 1;
    const x = street + side * 5.6, z = mid + ((i * 3 + j) % 2 ? -14 : 14);
    const kind = (i * 6 + j) % 6 === 2 ? "van" : "sedan";
    const sign = side > 0 ? 1 : -1;
    const wheelbase = kind === "van" ? 2.65 : 2.55;
    const front = heightAt(x, z + sign * wheelbase / 2), back = heightAt(x, z - sign * wheelbase / 2);
    const left = heightAt(x - sign * 0.72, z), right = heightAt(x + sign * 0.72, z);
    vehicleLocations[kind].push({ x, y: (front + back) / 2 + 0.085, z,
      yaw: side > 0 ? 0 : Math.PI, pitch: -Math.atan2(front - back, wheelbase),
      roll: Math.atan2(right - left, 1.44), color: PAINT[(i * 5 + j * 3) % PAINT.length] });
    vehicleRecords.push({ x, z, width: 1.78, length: kind === "van" ? 4.5 : 4.34, kind });
    colliders.push({ kind: "obb", x, z, hw: 0.89, hd: kind === "van" ? 2.25 : 2.17, rotY: 0 });
  }));

  for (const kind of ["sedan", "van"] as const) {
    const van = kind === "van", locations = vehicleLocations[kind];
    const halfLength = van ? 2.22 : 2.14, wheelbase = van ? 2.65 : 2.55;
    const bottom = van ? 1.0 : 0.86, top = van ? 1.94 : 1.43;
    const frontBottom = van ? 1.35 : 1.18, rearBottom = van ? -1.95 : -1.35;
    const frontTop = van ? 0.8 : 0.52, rearTop = van ? -1.84 : -0.76;
    const body: THREE.BufferGeometry[] = [hull([
      [-halfLength, 0.67, 0.39, van ? 0.98 : 0.66],
      [-halfLength + 0.23, 0.86, 0.34, bottom],
      [halfLength - 0.4, 0.86, 0.34, van ? 0.92 : 0.79],
      [halfLength, 0.7, 0.40, 0.64],
    ])];
    const windowParts = [cabin(frontBottom, rearBottom, frontTop, rearTop, bottom, top, 0.76)];
    body.push(cube(0, top + 0.025, (frontTop + rearTop) / 2, 1.3, 0.065, frontTop - rearTop + 0.07));
    // Thin painted window pillars preserve readable glazing rather than a solid block.
    for (const side of [-1, 1]) {
      const x = side * 0.765;
      body.push(rod(vec(x, bottom, frontBottom), vec(side * 0.645, top, frontTop), 0.035));
      body.push(rod(vec(x, bottom, rearBottom), vec(side * 0.645, top, rearTop), 0.04));
      body.push(rod(vec(x, bottom, -0.25), vec(side * 0.645, top, -0.25), 0.04));
      if (van) {
        // Delivery van rear panels, retaining front side glazing.
        body.push(cube(side * 0.71, 1.43, -1.16, 0.08, 0.86, 1.37));
        body.push(cube(side * 0.72, 1.88, -1.16, 0.08, 0.08, 1.37));
      }
      // Mirrors remain within the requested 1.8m overall vehicle envelope.
      body.push(cube(side * 0.835, bottom + 0.15, frontBottom - 0.18, 0.11, 0.11, 0.18));
    }
    const tires: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) for (const z of [-wheelbase / 2, wheelbase / 2]) {
      const tire = new THREE.CylinderGeometry(0.315, 0.315, 0.19, 12);
      tire.rotateZ(Math.PI / 2).translate(side * 0.79, 0.32, z);
      tires.push(tire);
      const hub = new THREE.CylinderGeometry(0.176, 0.176, 0.017, 10);
      hub.rotateZ(Math.PI / 2).translate(side * 0.88, 0.32, z);
      trim.push(hub);
    }
    trim.push(cube(0, 0.48, halfLength + 0.005, 1.24, 0.1, 0.035), cube(0, 0.48, -halfLength - 0.005, 1.24, 0.1, 0.035));
    // Recessed grille, plates and understated door handles.
    tires.push(cube(0, 0.62, halfLength + 0.012, 0.55, 0.12, 0.025));
    trim.push(cube(0, 0.45, -halfLength + 0.015, 0.35, 0.12, 0.018));
    for (const side of [-1, 1]) for (const z of [-0.7, 0.5]) trim.push(cube(side * 0.863, 0.79, z, 0.017, 0.035, 0.14));
    const frontLights = [-1, 1].map((s) => cube(s * 0.52, 0.64, halfLength - 0.015, 0.25, 0.15, 0.075));
    const rearLights = [-1, 1].map((s) => cube(s * 0.54, van ? 0.82 : 0.64, -halfLength + 0.008, 0.22, van ? 0.27 : 0.14, 0.07));
    place(`Parked ${kind} / painted body`, merge(body), paint, locations, true);
    place(`Parked ${kind} / cabin glazing`, merge(windowParts), glass, locations);
    place(`Parked ${kind} / tires and grille`, merge(tires), rubber, locations);
    place(`Parked ${kind} / wheel hubs and trim`, merge(trim), metal, locations);
    place(`Parked ${kind} / headlights`, merge(frontLights), headlamp, locations);
    place(`Parked ${kind} / rear lights`, merge(rearLights), taillamp, locations);
  }

  const lampLocations: Placement[] = [];
  STREETS.forEach((street, i) => BLOCKS.forEach((mid, j) => {
    const x = street - 8.6, z = mid + (i % 2 ? 4 : -4);
    lampLocations.push({ x, y: heightAt(x, z) + 0.3, z });
    colliders.push({ kind: "circle", x, z, r: 0.12 });
  }));
  const lampParts = [rod(vec(0, 0, 0), vec(0, 5.3, 0), 0.09, 0.052), cube(0, 0.08, 0, 0.27, 0.16, 0.27)];
  // Quarter-circle outreach sweeps towards the street, with a flat LED luminaire.
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI / 2, b = (i + 1) / 8 * Math.PI / 2;
    lampParts.push(rod(vec(1.25 * (1 - Math.cos(a)), 5.3 + 1.25 * Math.sin(a), 0), vec(1.25 * (1 - Math.cos(b)), 5.3 + 1.25 * Math.sin(b), 0), 0.047));
  }
  lampParts.push(cube(1.55, 6.55, 0, 0.78, 0.12, 0.27));
  place("Slim curved streetlamps", merge(lampParts), lampMetal, lampLocations);
  place("Streetlamp lenses", merge([cube(1.55, 6.48, 0, 0.62, 0.025, 0.19)]), headlamp, lampLocations);

  const treeLocations: Placement[] = [], planterLocations: Placement[] = [];
  STREETS.forEach((street, i) => BLOCKS.forEach((mid, j) => {
    for (const offset of [-22, 22]) {
      const x = street + 8.6, z = mid + offset;
      treeLocations.push({ x, y: heightAt(x, z) + 0.18, z, yaw: (i * 1.7 + j * 0.8), scale: 0.86 + ((i + j) % 4) * 0.06 });
      colliders.push({ kind: "circle", x, z, r: 0.16 });
    }
  }));
  for (const x of [18, 54]) for (const z of [18, 54]) {
    const y = heightAt(x, z) + 0.19;
    planterLocations.push({ x, y, z });
    treeLocations.push({ x, y: y + 0.45, z, scale: 1.1, yaw: x });
    colliders.push({ kind: "obb", x, z, hw: 1.6, hd: 1.6, rotY: 0 });
  }
  // High clear trunks keep sidewalks usable. Only trunks collide, never canopy.
  const branches = [rod(vec(0, 0, 0), vec(0.05, 3.8, 0.04), 0.15, 0.055, 6)];
  // Tapered bifurcating limbs support the airy lobes without low sidewalk growth.
  const tips = [vec(0, 4.7, 0), vec(-0.52, 4.27, 0.25), vec(0.48, 4.45, 0.33),
    vec(0.14, 4.3, -0.53), vec(-0.17, 5.22, -0.1)];
  tips.forEach((tip, i) => {
    const fork = tip.clone().lerp(vec(0.03, 3.1, 0), 0.36);
    branches.push(rod(vec(0.03, 2.95 + i * 0.11, 0.02), fork, 0.055 - i * 0.004, 0.024, 5));
    for (const side of [-1, 1]) {
      const end = tip.clone().add(vec(side * 0.24, -0.06, side * 0.19));
      branches.push(rod(fork, end, 0.024, 0.006, 5));
    }
  });
  place("Street tree trunks", merge(branches), bark, treeLocations);
  const planterParts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    planterParts.push(cube(side * 1.47, 0.25, 0, 0.26, 0.5, 3.2));
    planterParts.push(cube(0, 0.25, side * 1.47, 2.7, 0.5, 0.26));
  }
  place("Plaza corner stone planters", merge(planterParts), planter, planterLocations);
  place("Plaza planter soil", merge([cube(0, 0.38, 0, 2.7, 0.08, 2.7)]), soil, planterLocations);
  const lowPlanting: Placement[] = [];
  planterLocations.forEach((p, i) => {
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      lowPlanting.push({ x: p.x + Math.cos(a), y: p.y + 0.61, z: p.z + Math.sin(a), scale: 0.37,
        color: ["#758268", "#6b7e59", "#829174"][(i + k) % 3] });
    }
  });
  const foliage = createFoliage(treeLocations, foliageTexture, lowPlanting);
  group.add(foliage.crown, foliage.understory);
  instances.push(foliage.crown, foliage.understory);
  group.userData.parkedVehicles = vehicleRecords;
  group.userData.treeCenters = treeLocations.map(({ x, z }) => ({ x, z }));
  group.userData.drawCalls = instances.length;
  group.userData.triangles = instances.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3 * mesh.count, 0);
  let disposed = false;
  return { group, colliders, dispose() {
    if (disposed) return;
    disposed = true;
    instances.forEach((mesh) => {
      if (mesh !== foliage.crown && mesh !== foliage.understory) mesh.dispose();
    });
    foliage.dispose();
    geometries.forEach((geometry) => geometry.dispose());
    ownedMaterials.forEach((material) => material.dispose());
    group.clear();
  } };
}
