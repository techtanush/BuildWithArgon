import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MaterialLibrary } from "../kit/materials";
import type { Collider } from "../player/Collision";

export interface Waterfront {
  group: THREE.Group;
  colliders: Collider[];
  /** Elapsed time in seconds. */
  update(time: number): void;
  dispose(): void;
}

/** Original coastal scenery. No network assets, lights, or render targets required. */
export function buildWaterfront(
  materials: MaterialLibrary,
  heightAt: (x: number, z: number) => number,
): Waterfront {
  const group = new THREE.Group();
  group.name = "Bay waterfront";
  const colliders: Collider[] = [];
  const ownedMaterials = new Set<THREE.Material>();
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const geometries = new Set<THREE.BufferGeometry>();
  const shoreHeight = (z: number) => heightAt(230, Math.max(-240, Math.min(240, z)));
  let waterY = Infinity;
  for (let z = -240; z <= 240; z += 6) waterY = Math.min(waterY, shoreHeight(z) - 1.8);
  const surface = (color: string, roughness = 0.8, metalness = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    ownedMaterials.add(m);
    return m;
  };
  const concrete = materials.get("sidewalk");
  const stone = surface("#c4beb0");
  const wall = surface("#8d9691");
  const dark = surface("#283d42", 0.43, 0.62);
  const timber = materials.get("wood_dark");
  const deckWood = surface("#81766a");
  const bridgeRed = surface("#a84e38", 0.64, 0.24);
  const bridgeRoad = surface("#58666c");
  const lens = surface("#eee5c9", 0.3);
  lens.emissive.set("#f7deb3");
  lens.emissiveIntensity = 0.2;
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const list = batches.get(m) ?? [];
    list.push(g);
    batches.set(m, list);
  };
  const box = (m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
    add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), m);
  };
  const cylinder = (m: THREE.Material, x: number, y: number, z: number, r: number, h: number, top = r) => {
    add(new THREE.CylinderGeometry(top, r, h, 8).translate(x, y, z), m);
  };
  const rod = (m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number) => {
    const v = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(radius, radius, v.length(), 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    add(g, m);
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // A continuous sloping promenade, with joints rather than a stack of flat steps.
  const walkPositions: number[] = [];
  const walkUvs: number[] = [];
  for (let z = -240; z < 240; z += 6) {
    const ya = shoreHeight(z) + 0.08, yb = shoreHeight(z + 6) + 0.08;
    for (const p of [[222, ya, z], [222, yb, z + 6], [238, ya, z],
      [238, ya, z], [222, yb, z + 6], [238, yb, z + 6]]) {
      walkPositions.push(...p);
      walkUvs.push(p[0] / 4, p[2] / 4);
    }
    const h = Math.max(2, (ya + yb) / 2 - waterY + 1.2);
    box(wall, 236.7, (ya + yb) / 2 - h / 2, z + 3, 2.6, h, 6.02);
    // Cut-stone coping, drain slots and narrow expansion joints.
    box(stone, 237.25, (ya + yb) / 2 + 0.1, z + 3, 1.5, 0.2, 5.96);
    box(wall, 230, ya + 0.018, z, 13.7, 0.025, 0.035);
    if (z % 12 === 0) box(dark, 236.0, ya + 0.025, z + 2, 0.45, 0.035, 0.7);
  }
  const walk = new THREE.BufferGeometry();
  walk.setAttribute("position", new THREE.Float32BufferAttribute(walkPositions, 3));
  walk.setAttribute("uv", new THREE.Float32BufferAttribute(walkUvs, 2));
  walk.computeVertexNormals();
  add(walk, concrete);

  // Thin powder-coated marine railing, continuous even across pier entrances.
  for (let z = -240; z <= 240; z += 4) {
    const y = shoreHeight(z) + 0.2;
    cylinder(dark, 237, y + 0.56, z, 0.055, 1.12);
    box(stone, 237, y - 0.02, z, 0.25, 0.12, 0.25);
    if (z < 240) for (const h of [0.37, 1.1]) {
      rod(dark, v(237, y + h, z), v(237, shoreHeight(z + 4) + 0.2 + h, z + 4), 0.043);
    }
  }
  // Broad collision backing prevents high-speed vehicles slipping between posts.
  colliders.push({ kind: "obb", x: 239, z: 0, hw: 2.1, hd: 244, rotY: 0 });
  for (const end of [-240, 240]) {
    rod(dark, v(222, shoreHeight(end) + 1.3, end), v(237, shoreHeight(end) + 1.3, end), 0.05);
    colliders.push({ kind: "obb", x: 230, z: end, hw: 8, hd: 0.3, rotY: 0 });
  }
  for (let z = -228; z <= 228; z += 24) {
    const y = shoreHeight(z) + 0.1;
    cylinder(dark, 234.2, y + 2.6, z, 0.11, 5.2, 0.07);
    cylinder(dark, 234.2, y + 0.16, z, 0.23, 0.32);
    rod(dark, v(234.2, y + 5.15, z), v(232.8, y + 5.15, z), 0.065);
    box(dark, 232.8, y + 5.12, z, 0.65, 0.13, 0.35);
    box(lens, 232.8, y + 5.04, z, 0.5, 0.04, 0.26);
    for (const dz of [-4, 4]) {
      const by = shoreHeight(z + dz) + 0.1;
      cylinder(dark, 223, by + 0.42, z + dz, 0.12, 0.84);
      cylinder(stone, 223, by + 0.72, z + dz, 0.125, 0.07);
      colliders.push({ kind: "circle", x: 223, z: z + dz, r: 0.16 });
    }
    if (z % 48 === 12 || z % 48 === -36) {
      // Timber benches facing the bay, with three actual seat slats.
      for (const x of [231.5, 231.75, 232]) box(timber, x, y + 0.47, z + 5, 0.2, 0.09, 2.2);
      for (const dz of [-0.8, 0.8]) box(dark, 231.75, y + 0.23, z + 5 + dz, 0.6, 0.46, 0.08);
      box(timber, 231.4, y + 0.83, z + 5, 0.09, 0.38, 2.2);
      colliders.push({ kind: "obb", x: 231.7, z: z + 5, hw: 0.43, hd: 1.15, rotY: 0 });
    }
  }

  // Two working timber piers. Railing intentionally blocks gameplay access.
  for (const z of [-130, 130]) {
    const y = shoreHeight(z) - 0.05;
    box(wall, 270, y - 0.32, z, 66, 0.5, 9);
    box(deckWood, 270, y, z, 66, 0.16, 8.7);
    for (let x = 240; x <= 302; x += 1.2) box(timber, x, y + 0.085, z, 0.035, 0.012, 8.65);
    for (let x = 244; x <= 300; x += 8) {
      for (const side of [-1, 1]) {
        const zz = z + side * 3.6;
        cylinder(timber, x, (waterY + y) / 2 - 0.7, zz, 0.27, y - waterY + 2.4);
        cylinder(dark, x, y + 0.3, zz, 0.18, 0.6);
        cylinder(dark, x, y + 0.59, zz, 0.25, 0.08);
        // Side rubbing strips and mooring cleats.
        box(timber, x, y - 0.6, z + side * 4.55, 7.8, 0.25, 0.18);
      }
    }
    // Modest low pier shed with folded gable roof, not oversized cones.
    box(stone, 294, y + 1.6, z, 8, 3.2, 5.6);
    for (const side of [-1, 1]) {
      const roof = new THREE.BoxGeometry(8.8, 0.14, 3.1);
      roof.rotateX(side * 0.22).translate(294, y + 3.55, z + side * 1.45);
      add(roof, dark);
      box(dark, 289.95, y + 1.65, z + side * 1.5, 0.08, 1.5, 1.2);
    }
  }

  const waterMaterial = new THREE.ShaderMaterial({
    name: "Coastal water / analytical waves and sky reflection",
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      time: { value: 0 },
      deepColor: { value: new THREE.Color("#124b64") },
      shallowColor: { value: new THREE.Color("#277c83") },
      skyColor: { value: new THREE.Color("#a2c4ce") },
    },
    vertexShader: `
      uniform float time;
      varying vec3 worldPosition;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        p.y += sin(p.x * 0.13 + p.z * 0.07 + time * 0.65) * 0.065;
        p.y += sin(p.z * 0.23 - p.x * 0.04 - time * 0.48) * 0.035;
        worldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float time;
      uniform vec3 deepColor;
      uniform vec3 shallowColor;
      uniform vec3 skyColor;
      varying vec3 worldPosition;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = worldPosition.xz;
        float a = p.x * 0.65 + p.y * 0.28 + time * 0.72;
        float b = p.y * 1.45 - p.x * 0.32 - time * 0.91;
        float c = p.x * 2.7 + p.y * 1.1 + time * 1.3;
        vec3 n = normalize(vec3(-0.045*cos(a)-0.025*cos(c), 1.0, -0.055*cos(b)-0.025*cos(a)));
        vec3 eye = normalize(cameraPosition - worldPosition);
        float fresnel = 0.07 + 0.72 * pow(1.0 - max(dot(n, eye), 0.0), 4.0);
        float shoal = exp(-max(p.x - 234.0, 0.0) * 0.015);
        vec3 base = mix(deepColor, shallowColor, shoal * 0.65);
        base *= 0.96 + 0.04 * sin(a * 0.27 + sin(b * 0.16));
        vec3 reflected = skyColor * (0.85 + 0.15 * n.y);
        vec3 color = mix(base, reflected, fresnel);
        vec3 halfSun = normalize(eye + normalize(vec3(-0.5, 0.65, -0.4)));
        float glint = pow(max(dot(n, halfSun), 0.0), 320.0);
        color += vec3(1.0, 0.92, 0.73) * glint * 0.65;
        float ripple = pow(0.5 + 0.5 * sin(a + 1.6 * sin(b)), 18.0);
        color += vec3(0.12, 0.22, 0.23) * ripple * shoal * 0.16;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  ownedMaterials.add(waterMaterial);
  const waterGeometry = new THREE.PlaneGeometry(3600, 4800, 96, 96);
  waterGeometry.rotateX(-Math.PI / 2).translate(2034, waterY, 0);
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.name = "Animated open bay";
  water.frustumCulled = false;
  geometries.add(waterGeometry);
  group.add(water);

  // A slender original two-tower suspension span, oriented across the view.
  const bridgeX = 560, roadY = waterY + 31;
  box(bridgeRoad, bridgeX, roadY, -45, 13, 1.8, 760);
  for (const x of [bridgeX - 7, bridgeX + 7]) {
    box(bridgeRed, x, roadY + 1.0, -45, 0.45, 1.8, 760);
    for (const z of [-205, 115]) {
      box(wall, x, waterY + 1.4, z, 7, 5, 9);
      box(bridgeRed, x, waterY + 48, z, 3.1, 94, 4.1);
    }
    const cableHeight = (z: number) => {
      if (z < -205) return roadY + 9 + 55 * Math.pow((z + 425) / 220, 1.25);
      if (z > 115) return roadY + 9 + 55 * Math.pow((335 - z) / 220, 1.25);
      return roadY + 13 + 51 * Math.pow((z + 45) / 160, 2);
    };
    for (let z = -425; z < 335; z += 5) {
      rod(bridgeRed, v(x, cableHeight(z), z), v(x, cableHeight(z + 5), z + 5), 0.24);
    }
    for (let z = -413; z < 335; z += 12) {
      rod(bridgeRed, v(x, roadY + 1.8, z), v(x, cableHeight(z), z), 0.075);
    }
  }
  for (const z of [-205, 115]) {
    for (const h of [39, 64, 88]) {
      box(bridgeRed, bridgeX, waterY + h, z, 14, 2.4, 3.8);
    }
    rod(bridgeRed, v(553, waterY + 42, z), v(567, waterY + 62, z), 0.38);
    rod(bridgeRed, v(567, waterY + 42, z), v(553, waterY + 62, z), 0.38);
  }
  for (const z of [-425, -340, 250, 335]) box(wall, bridgeX, waterY + 14.5, z, 9, 29, 5);

  // Long irregular ridgelines: layered terrain, never cone-shaped mountains.
  const ridge = (x: number, z: number, length: number, depth: number, height: number, color: string, phase: number) => {
    const positions: number[] = [], colors: number[] = [];
    const nx = 9, nz = 56;
    const point = (i: number, j: number) => {
      const u = i / nx, t = j / nz;
      const ends = Math.pow(Math.sin(Math.PI * t), 0.65);
      const silhouette = 0.64 + 0.18 * Math.sin(t * 19 + phase) + 0.11 * Math.sin(t * 43 - phase);
      const rise = Math.sin(Math.PI * u) * silhouette * ends;
      return [x + u * depth + 18 * Math.sin(t * 17 + phase), waterY - 2 + height * rise, z + t * length];
    };
    const base = new THREE.Color(color);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      for (const p of [point(i, j), point(i, j + 1), point(i + 1, j), point(i + 1, j), point(i, j + 1), point(i + 1, j + 1)]) {
        positions.push(...p);
        const c = base.clone().multiplyScalar(0.89 + 0.1 * Math.sin(p[2] * 0.025) + 0.12 * (p[1] - waterY) / height);
        colors.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const m = surface("#ffffff");
    m.vertexColors = true;
    const mesh = new THREE.Mesh(g, m);
    mesh.name = "Layered coastal headland";
    geometries.add(g);
    group.add(mesh);
  };
  ridge(880, -950, 1850, 330, 172, "#8aadb2", 1.3);
  ridge(735, -740, 1280, 240, 108, "#718e8b", 3.5);
  ridge(510, -700, 330, 200, 67, "#627564", 0.7);
  ridge(605, 330, 580, 250, 80, "#6f8076", 2.4);

  // Low distant urban shoreline, with restrained silhouettes and roof setbacks.
  const skylineA = surface("#adb8b4"), skylineB = surface("#8a9fa3"), skylineGlass = surface("#6f8993", 0.4, 0.2);
  let seed = 19073;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  for (let i = 0; i < 52; i++) {
    const x = 650 + random() * 115, z = 265 + random() * 310;
    const h = 8 + Math.pow(random(), 2) * 58, w = 8 + random() * 13, d = 7 + random() * 14;
    const m = i % 4 === 0 ? skylineGlass : i % 2 ? skylineA : skylineB;
    box(m, x, waterY + h / 2, z, w, h, d);
    if (h > 30) box(m, x, waterY + h + 1.4, z, w * 0.6, 2.8, d * 0.7);
  }

  // One draw call per material, regardless of bollard/railing/cable count.
  for (const [material, parts] of batches) {
    // Custom slab and standard primitive attributes are normalized before merging.
    const normalized = parts.map((part) => {
      const g = part.index ? part.toNonIndexed() : part;
      if (g !== part) part.dispose();
      if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
      return g;
    });
    const geometry = mergeGeometries(normalized, false);
    normalized.forEach((g) => g.dispose());
    if (!geometry) throw new Error("Waterfront geometry merge failed");
    geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Waterfront batch ${material.name || material.type}`;
    mesh.receiveShadow = true;
    // Distant bridge/skyline do not burden the shadow map.
    mesh.castShadow = material === dark || material === timber || material === stone;
    group.add(mesh);
  }
  group.userData.waterLevel = waterY;
  group.userData.drawCalls = group.children.filter((child) => child instanceof THREE.Mesh).length;
  group.userData.triangles = [...geometries].reduce((sum, g) => sum + (g.index?.count ?? g.getAttribute("position").count) / 3, 0);
  let disposed = false;
  return {
    group,
    colliders,
    update(time: number) {
      if (!disposed && Number.isFinite(time)) waterMaterial.uniforms.time.value = time;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometries.forEach((g) => g.dispose());
      ownedMaterials.forEach((m) => m.dispose());
      group.clear();
    },
  };
}
