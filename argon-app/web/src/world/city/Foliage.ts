import * as THREE from "three";

export interface FoliagePlacement {
  x: number; y: number; z: number; yaw?: number; scale?: number;
}
export interface Foliage {
  crown: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  understory: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** Owns meshes, geometry, materials and the fallback, never a supplied texture. */
  dispose(): void;
}

const ALPHA_TEST = 0.43;
const CARDS_PER_CROWN = 90;
const CARDS_PER_SHRUB = 10;
const TAU = Math.PI * 2;
const lobes = [[0, 4.7, 0], [-0.52, 4.27, 0.25], [0.48, 4.45, 0.33],
  [0.14, 4.3, -0.53], [-0.17, 5.22, -0.1]];

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Original deterministic twig/leaf painting. No canvas, network or paid assets. */
export function createLeafSprayTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const rng = random(0x71eaf);
  const paint = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  };
  const stem = (ax: number, ay: number, bx: number, by: number, radius: number) => {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
    for (let i = 0; i <= steps; i++) {
      const x = ax + (bx - ax) * i / steps, y = ay + (by - ay) * i / steps;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy <= radius * radius) paint(Math.round(x + dx), Math.round(y + dy), 99, 92, 49);
      }
    }
  };
  // Pointed, asymmetric broad leaves, each with a midrib and fine lateral veins.
  const leaf = (cx: number, cy: number, angle: number, length: number, width: number) => {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const shade = 0.82 + rng() * 0.3;
    const extent = Math.ceil(length + width);
    for (let y = Math.max(0, Math.floor(cy - extent)); y <= Math.min(size - 1, cy + extent); y++) {
      for (let x = Math.max(0, Math.floor(cx - extent)); x <= Math.min(size - 1, cx + extent); x++) {
        const u = ((x - cx) * ca + (y - cy) * sa) / length;
        const v = (-(x - cx) * sa + (y - cy) * ca) / width;
        const profile = Math.pow(Math.max(0, 1 - u * u), 0.82);
        if (Math.abs(u) >= 1 || Math.abs(v) > profile) continue;
        const edge = Math.min((1 - Math.abs(u)) * length, (profile - Math.abs(v)) * width);
        const vein = Math.abs(v) < 0.045 || Math.abs((u * 5 - Math.abs(v) * 1.7) % 1) < 0.045;
        const light = shade * (0.84 + 0.14 * v + 0.12 * (1 - Math.abs(u))) + (vein ? 0.1 : 0);
        paint(x, y, Math.round(92 * light), Math.round(123 * light), Math.round(59 * light), Math.round(Math.min(1, edge * 1.5) * 255));
      }
    }
  };
  stem(124, 15, 129, 215, 1.6);
  for (let node = 0; node < 6; node++) {
    const y = 47 + node * 27;
    for (const side of [-1, 1]) {
      const bx = 126 + side * (69 - node * 6), by = y + 35;
      stem(126, y, bx, by, 1.1);
      for (let k = 0; k < 3; k++) {
        const t = 0.35 + k * 0.28;
        const x = 126 + (bx - 126) * t, py = y + (by - y) * t;
        const angle = Math.atan2(by - y, bx - 126) + (k % 2 ? -1 : 1) * side * 0.65;
        leaf(x + Math.cos(angle) * 9, py + Math.sin(angle) * 9, angle, 14 + rng() * 5, 5.4 + rng() * 2);
      }
    }
  }
  leaf(129, 222, Math.PI / 2, 19, 7);
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = "Original broadleaf twig spray / deterministic RGBA";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** 3D crowns filled with independently oriented sprays, not camera-facing shells.
 * A supplied texture must be an RGBA, full-card leafy branch cutout, not an atlas.
 * No shader hooks: compatible with the world's CSM material setup.
 */
export function createFoliage(
  trees: readonly FoliagePlacement[],
  suppliedTexture?: THREE.Texture,
  shrubs: readonly FoliagePlacement[] = [],
): Foliage {
  const texture = suppliedTexture ?? createLeafSprayTexture();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    name: "Airy broadleaf alpha-cut sprays", map: texture, color: "#ffffff",
    side: THREE.DoubleSide, alphaTest: ALPHA_TEST, transparent: false,
    depthWrite: true, roughness: 0.92, metalness: 0,
  });
  material.shadowSide = THREE.DoubleSide;
  // Explicit alpha-tested shadow passes keep the holes, including point lights.
  const depth = new THREE.MeshDepthMaterial({ map: texture, alphaTest: ALPHA_TEST,
    side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking });
  const distance = new THREE.MeshDistanceMaterial({ map: texture, alphaTest: ALPHA_TEST,
    side: THREE.DoubleSide });
  const makeMesh = (name: string, placements: readonly FoliagePlacement[], shrub: boolean) => {
    const cards = shrub ? CARDS_PER_SHRUB : CARDS_PER_CROWN;
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length * cards);
    mesh.name = name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = depth; mesh.customDistanceMaterial = distance;
    const transform = new THREE.Object3D();
    const center = new THREE.Vector3();
    const treeQ = new THREE.Quaternion();
    const rotation = new THREE.Quaternion();
    const colors = ["#b2bf9a", "#c1cba9", "#95ad84", "#d0cfad", "#a6b88f"].map(c => new THREE.Color(c));
    placements.forEach((tree, index) => {
      const rng = random(0x5f71 + index * 9319 + (shrub ? 37 : 0));
      const scale = tree.scale ?? 1;
      treeQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, tree.yaw ?? 0);
      for (let card = 0; card < cards; card++) {
        const lobe = lobes[Math.floor(card / 18)];
        const azimuth = rng() * TAU;
        const radius = Math.sqrt(rng()) * (shrub ? 0.35 : 0.31);
        center.set((shrub ? 0 : lobe[0]) + Math.cos(azimuth) * radius,
          shrub ? 0.2 + rng() * 0.42 : lobe[1] + (rng() - 0.5) * 0.63,
          (shrub ? 0 : lobe[2]) + Math.sin(azimuth) * radius);
        // Cards remain within a ~3m wide envelope even on the 1.1x plaza trees.
        const horizontal = Math.hypot(center.x, center.z);
        if (horizontal > 0.8) { center.x *= 0.8 / horizontal; center.z *= 0.8 / horizontal; }
        center.multiplyScalar(scale).applyQuaternion(treeQ).add(new THREE.Vector3(tree.x, tree.y, tree.z));
        transform.position.copy(center);
        // Include near-horizontal and tilted sprays, never fixed billboard crosses.
        rotation.setFromEuler(new THREE.Euler((rng() - 0.5) * 2.6, rng() * TAU, (rng() - 0.5) * 1.6, "YXZ"));
        transform.quaternion.copy(treeQ).multiply(rotation);
        const width = (0.63 + rng() * 0.25) * scale;
        transform.scale.set(width, width * (0.74 + rng() * 0.25), 1);
        transform.updateMatrix();
        const id = index * cards + card;
        mesh.setMatrixAt(id, transform.matrix);
        mesh.setColorAt(id, colors[(index + card) % colors.length]);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (mesh.count) { mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
    return mesh;
  };
  const crown = makeMesh("Layered coastal tree foliage", trees, false);
  const understory = makeMesh("Plaza low planting", shrubs, true);
  let disposed = false;
  return { crown, understory, dispose() {
    if (disposed) return;
    disposed = true;
    crown.dispose(); understory.dispose(); geometry.dispose();
    material.dispose(); depth.dispose(); distance.dispose();
    if (!suppliedTexture) texture.dispose();
  } };
}
