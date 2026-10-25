// OWNER: mahin
import * as THREE from "three";
import type { CityMaterials } from "./roads";
export function buildPlaza(m: CityMaterials) {
  const group = new THREE.Group();
  group.name = "Founders Plaza";
  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const disc = add(
    new THREE.CircleGeometry(30, 128),
    m.get("plaza_stone"),
    0,
    0.032,
    0,
  );
  disc.rotation.x = -Math.PI / 2;
  for (const r of [5.3, 14.4, 29.5]) {
    const ring = add(
      new THREE.RingGeometry(r - 0.07, r + 0.07, 128),
      m.get("metal_light"),
      0,
      0.04,
      0,
    );
    ring.rotation.x = -Math.PI / 2;
  }
  add(
    new THREE.CylinderGeometry(4.65, 4.8, 0.52, 64),
    m.get("plaza_stone"),
    0,
    0.26,
    0,
  );
  const lip = add(
    new THREE.TorusGeometry(4.45, 0.19, 12, 96),
    m.get("trim"),
    0,
    0.62,
    0,
  );
  lip.rotation.x = Math.PI / 2;
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: "#679b9e",
    roughness: 0.16,
    metalness: 0.23,
    transparent: true,
    opacity: 0.9,
    clearcoat: 1,
  });
  const water = add(
    new THREE.CircleGeometry(4.3, 64),
    waterMaterial,
    0,
    0.54,
    0,
  );
  water.rotation.x = -Math.PI / 2;
  add(
    new THREE.CylinderGeometry(0.42, 0.64, 1.7, 24),
    m.get("plaza_stone"),
    0,
    1.24,
    0,
  );
  add(
    new THREE.CylinderGeometry(1.45, 0.7, 0.36, 48),
    m.get("trim"),
    0,
    2.16,
    0,
  );
  const droplets = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.035, 5, 4),
    waterMaterial,
    150,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 150; i++) {
    const a = i * 2.39996;
    const t = (i % 25) / 25;
    dummy.position.set(
      Math.cos(a) * (1.3 + t * 0.9),
      2.2 - t * t * 1.7,
      Math.sin(a) * (1.3 + t * 0.9),
    );
    dummy.scale.set(0.6, 2.5, 0.6);
    dummy.updateMatrix();
    droplets.setMatrixAt(i, dummy.matrix);
  }
  group.add(droplets);
  add(new THREE.BoxGeometry(2.4, 1.05, 0.8), m.get("wood_dark"), 0, 0.525, 9.6);
  add(new THREE.BoxGeometry(2.6, 0.12, 1), m.get("plaza_stone"), 0, 1.1, 9.6);
  for (const x of [-1.2, 1.2])
    add(
      new THREE.CylinderGeometry(0.045, 0.045, 2.8, 10),
      m.get("metal_dark"),
      x,
      1.4,
      9.3,
    );
  add(new THREE.BoxGeometry(3, 0.12, 1.7), m.get("wood_dark"), 0, 2.85, 9.6);
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) * Math.PI) / 4;
    const bench = new THREE.Group();
    for (let s = 0; s < 5; s++) {
      const slat = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.07, 0.1),
        m.get("wood_dark"),
      );
      slat.position.set(0, 0.48, (s - 2) * 0.12);
      slat.castShadow = true;
      bench.add(slat);
    }
    for (const x of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.48, 0.55),
        m.get("metal_dark"),
      );
      leg.position.set(x, 0.24, 0);
      bench.add(leg);
    }
    bench.position.set(Math.sin(a) * 13, 0, -Math.cos(a) * 13);
    bench.rotation.y = -a;
    group.add(bench);
  }
  return {
    group,
    water,
    droplets,
    update(t: number) {
      water.rotation.z = t * 0.025;
      droplets.rotation.y = t * 0.05;
    },
    dispose() {
      waterMaterial.dispose();
    },
  };
}
