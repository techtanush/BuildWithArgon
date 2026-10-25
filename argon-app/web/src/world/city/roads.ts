// OWNER: mahin
import * as THREE from "three";
import type { Manifest } from "../../shared/contracts";
export type CityMaterials = { get(key: any): THREE.Material };
function flat(geo: THREE.BufferGeometry, mat: THREE.Material, y: number) {
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}
export function buildRoads(manifest: Manifest, m: CityMaterials) {
  const root = new THREE.Group();
  root.name = "Avenues";
  const grass = flat(
    new THREE.PlaneGeometry(800, 800, 1, 1),
    m.get("grass"),
    -0.025,
  );
  root.add(grass);
  const ring = flat(new THREE.RingGeometry(87, 97, 160), m.get("road"), 0.02);
  root.add(ring);
  for (const r of [86.2, 97.8])
    root.add(
      flat(
        new THREE.RingGeometry(r - 0.65, r + 0.65, 160),
        m.get("sidewalk"),
        0.035,
      ),
    );
  for (const b of manifest.buildings) {
    const a = b.theta;
    for (const [from, to, w] of [
      [30, 87, 8],
      [97, 119, 6],
    ]) {
      const length = to - from;
      const middle = (to + from) / 2;
      const road = flat(
        new THREE.PlaneGeometry(w, length),
        m.get("road"),
        0.025,
      );
      road.position.x = Math.sin(a) * middle;
      road.position.z = -Math.cos(a) * middle;
      road.rotation.z = a;
      root.add(road);
      for (const side of [-1, 1]) {
        const curb = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.14, length),
          m.get("curb"),
        );
        curb.position.set(
          Math.sin(a) * middle + Math.cos(a) * side * (w / 2 + 0.2),
          0.07,
          -Math.cos(a) * middle + Math.sin(a) * side * (w / 2 + 0.2),
        );
        curb.rotation.y = -a;
        curb.receiveShadow = true;
        root.add(curb);
        const pavement = curb.clone();
        pavement.geometry = new THREE.BoxGeometry(1.3, 0.09, length);
        pavement.position.x += Math.cos(a) * side * 0.8;
        pavement.position.z += Math.sin(a) * side * 0.8;
        root.add(pavement);
      }
    }
  }
  const dashes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2, 0.009, 0.12),
    m.get("lane_marking"),
    116,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 116; i++) {
    const a = (i / 116) * Math.PI * 2;
    dummy.position.set(Math.sin(a) * 92, 0.035, -Math.cos(a) * 92);
    dummy.rotation.y = -a;
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  }
  root.add(dashes);
  return root;
}
