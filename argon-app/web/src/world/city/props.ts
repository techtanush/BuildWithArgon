// OWNER: mahin
import * as THREE from "three";
import type { CityMaterials } from "./roads";
import type { Manifest } from "../../shared/contracts";
export function seeded(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function buildScenery(manifest: Manifest, m: CityMaterials) {
  const root = new THREE.Group();
  const rng = seeded(1337);
  const points: THREE.Vector3[] = [];
  for (let i = 0; points.length < 140 && i < 12000; i++) {
    const a = rng() * Math.PI * 2,
      r = 38 + rng() * 250;
    const x = Math.sin(a) * r,
      z = -Math.cos(a) * r;
    if (Math.abs(r - 92) < 11) continue;
    if (
      manifest.buildings.some(
        (b) => Math.hypot(x - b.plot_center[0], z - b.plot_center[1]) < 24,
      )
    )
      continue;
    if (
      r < 145 &&
      manifest.buildings.some(
        (b) =>
          Math.abs(x * Math.cos(b.theta) + z * Math.sin(b.theta)) < 9 &&
          x * Math.sin(b.theta) - z * Math.cos(b.theta) > 0,
      )
    )
      continue;
    if (points.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    points.push(new THREE.Vector3(x, 0, z));
  }
  const bark = m.get("wood_dark");
  const foliage = new THREE.MeshStandardMaterial({
    color: "#465b30",
    roughness: 0.94,
  });
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.1, 0.26, 1, 7),
    bark,
    points.length * 4,
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    foliage,
    points.length * 22,
  );
  const dummy = new THREE.Object3D();
  let bi = 0,
    li = 0;
  for (const p of points) {
    const h = 4 + rng() * 4;
    dummy.position.copy(p).add(new THREE.Vector3(0, h / 2, 0));
    dummy.rotation.set(0, rng() * 6.28, 0);
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(bi++, dummy.matrix);
    for (let j = 0; j < 3; j++) {
      const a = rng() * 6.28;
      dummy.position
        .copy(p)
        .add(new THREE.Vector3(Math.cos(a) * 0.7, h * 0.62, Math.sin(a) * 0.7));
      dummy.rotation.set(Math.cos(a) * 0.55, a, Math.sin(a) * 0.55);
      dummy.scale.set(0.55, h * 0.5, 0.55);
      dummy.updateMatrix();
      trunks.setMatrixAt(bi++, dummy.matrix);
    }
    for (let j = 0; j < 22; j++) {
      const a = rng() * 6.28,
        rr = Math.sqrt(rng()) * 2;
      dummy.position
        .copy(p)
        .add(
          new THREE.Vector3(
            Math.cos(a) * rr,
            h * 0.72 + rng() * h * 0.45,
            Math.sin(a) * rr,
          ),
        );
      dummy.rotation.set(rng() * 6, rng() * 6, rng() * 6);
      const s = 0.65 + rng() * 0.65;
      dummy.scale.set(s * 1.3, s, s);
      dummy.updateMatrix();
      leaves.setMatrixAt(li, dummy.matrix);
      leaves.setColorAt(
        li++,
        new THREE.Color().setHSL(
          0.2 + rng() * 0.07,
          0.23 + rng() * 0.18,
          0.16 + rng() * 0.16,
        ),
      );
    }
  }
  trunks.castShadow = true;
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  root.add(trunks, leaves);
  const lampPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r = i % 2 ? 85 : 99;
    lampPoints.push(new THREE.Vector3(Math.sin(a) * r, 0, -Math.cos(a) * r));
  }
  for (let i = 0; i < 4; i++) {
    const a = ((i + 0.5) * Math.PI) / 2;
    lampPoints.push(new THREE.Vector3(Math.sin(a) * 26, 0, -Math.cos(a) * 26));
  }
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.055, 0.1, 4.5, 8),
    m.get("metal_dark"),
    lampPoints.length,
  );
  const heads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.48, 0.14, 0.48),
    m.get("metal_dark"),
    lampPoints.length,
  );
  const bulbs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.37, 0.06, 0.37),
    new THREE.MeshStandardMaterial({
      color: "#fff3d4",
      emissive: "#ffb35c",
      emissiveIntensity: 1.2,
    }),
    lampPoints.length,
  );
  lampPoints.forEach((p, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.copy(p);
    dummy.position.y = 2.25;
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 4.55;
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 4.46;
    dummy.updateMatrix();
    bulbs.setMatrixAt(i, dummy.matrix);
  });
  poles.castShadow = true;
  root.add(poles, heads, bulbs);
  const hillGeometry = new THREE.PlaneGeometry(1600, 1600, 64, 64);
  hillGeometry.rotateX(-Math.PI / 2);
  const pos = hillGeometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      z = pos.getZ(i),
      r = Math.hypot(x, z);
    const slope = Math.max(0, Math.min(1, (r - 290) / 130));
    pos.setY(
      i,
      slope *
        (18 +
          20 * Math.sin(x * 0.011) * Math.cos(z * 0.009) +
          8 * Math.sin(z * 0.027)) -
        0.2,
    );
  }
  hillGeometry.computeVertexNormals();
  const hills = new THREE.Mesh(hillGeometry, m.get("grass"));
  hills.receiveShadow = true;
  root.add(hills);
  return {
    group: root,
    treePositions: points,
    setQuality(tier: string) {
      leaves.count = Math.floor(
        li * (tier === "low" ? 0.4 : tier === "medium" ? 0.7 : 1),
      );
      trunks.count = Math.floor(
        bi * (tier === "low" ? 0.4 : tier === "medium" ? 0.7 : 1),
      );
    },
    dispose() {
      foliage.dispose();
    },
  };
}
