import * as THREE from "three";
import argonHead from "./argon-head-profile.json";

/** Generated Argon proportions for the procedural fallback, not a photoreal asset. */
export const headProfile = argonHead.profile;

export function jawTaper(normalizedY: number): number {
  return 1 - (1 - headProfile.jaw_width_ratio) * Math.max(0, -normalizedY);
}

/** One continuous cranium/jaw surface, with no intersecting jaw primitive. */
export function createHeadGeometry(): THREE.SphereGeometry {
  const p = headProfile;
  const geometry = new THREE.SphereGeometry(1, p.segments, p.segments);
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    positions.setXYZ(i, positions.getX(i) * p.head_width * jawTaper(y), y * p.head_height, positions.getZ(i) * p.head_depth);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Front surface of the same tapered ellipsoid, for flush facial placement. */
export function headFrontZ(x: number, y: number): number {
  const p = headProfile;
  const ny = y / p.head_height;
  const nx = x / (p.head_width * jawTaper(ny));
  return p.head_depth * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
}
