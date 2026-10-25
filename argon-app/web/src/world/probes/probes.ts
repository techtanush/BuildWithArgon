// OWNER: mahin
import type { KitApi, Vec3 } from "../kit/types";
import { PROP_FOOTPRINTS } from "../kit/props.contract";
import type {
  CaptureMode,
  CaptureSource,
  ProbeCheck,
  ProbeResult,
} from "./types";

export interface ProbeCollider {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  yaw: number;
  minY: number;
  maxY: number;
  radius?: number;
}
export interface ProbeRecording {
  calls: number;
  colliders: ProbeCollider[];
  slots: { id: string; pos: Vec3; facingY: number }[];
  entrances: { z: number }[];
  signs: { pos: Vec3; width: number; rotY?: number }[];
  lights: number;
}
export function recordKit(kit: KitApi): {
  kit: KitApi;
  recording: ProbeRecording;
} {
  const recording: ProbeRecording = {
    calls: 0,
    colliders: [],
    slots: [],
    entrances: [],
    signs: [],
    lights: 0,
  };
  const proxy = new Proxy(kit, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function" || key === "rand") return value;
      if (key === "group")
        return (_name: string, fn: () => void) => {
          recording.calls++;
          fn();
        };
      return (o: any) => {
        recording.calls++;
        if (key === "npcSlot") recording.slots.push({ ...o, pos: [...o.pos] });
        if (key === "entrance") recording.entrances.push({ ...o });
        if (key === "sign") recording.signs.push({ ...o, pos: [...o.pos] });
        if (key === "light") recording.lights++;
        if (o.collide) {
          let size: Vec3;
          let bottom = false;
          let radius: number | undefined;
          if (key === "prop") {
            const p = PROP_FOOTPRINTS[o.kind as keyof typeof PROP_FOOTPRINTS];
            size = [p.w, p.h, p.d].map((v) => v * (o.scale ?? 1)) as Vec3;
            bottom = true;
          } else if (key === "sphere") {
            size = [0, 1, 2].map(
              (i) => 2 * o.radius * (o.scale?.[i] ?? 1),
            ) as Vec3;
            radius = Math.max(size[0], size[2]) / 2;
          } else if (key === "cylinder") {
            radius = Math.max(o.radiusTop, o.radiusBottom);
            size = [radius * 2, o.height, radius * 2];
          } else size = o.size;
          if (size)
            recording.colliders.push({
              x: o.pos[0],
              z: o.pos[2],
              halfX: size[0] / 2,
              halfZ: size[2] / 2,
              yaw: o.rotY ?? 0,
              minY: o.pos[1] - (bottom ? 0 : size[1] / 2),
              maxY: o.pos[1] + (bottom ? size[1] : size[1] / 2),
              radius,
            });
        }
        return value.call(target, o);
      };
    },
  });
  return { kit: proxy, recording };
}
export function colliderDistance(
  c: ProbeCollider,
  x: number,
  z: number,
): number {
  const dx = x - c.x,
    dz = z - c.z,
    co = Math.cos(c.yaw),
    si = Math.sin(c.yaw);
  if (c.radius !== undefined) return Math.max(0, Math.hypot(dx, dz) - c.radius);
  return Math.hypot(
    Math.max(0, Math.abs(dx * co - dz * si) - c.halfX),
    Math.max(0, Math.abs(dx * si + dz * co) - c.halfZ),
  );
}
type Point = [number, number];
function polygon(c: ProbeCollider): Point[] {
  if (c.radius !== undefined)
    return Array.from(
      { length: 96 },
      (_, i) =>
        [
          c.x + Math.cos((i * Math.PI) / 48) * c.radius!,
          c.z + Math.sin((i * Math.PI) / 48) * c.radius!,
        ] as Point,
    );
  const co = Math.cos(c.yaw),
    si = Math.sin(c.yaw);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => [
    c.x + x * c.halfX * co + z * c.halfZ * si,
    c.z - x * c.halfX * si + z * c.halfZ * co,
  ]);
}
const cross = (a: Point, b: Point, p: Point) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
/** Exact convex OBB footprint clipping; circular footprints use a 96-edge approximation. */
export function overlapVolume(a: ProbeCollider, b: ProbeCollider): number {
  const height = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (height <= 0) return 0;
  let points = polygon(a);
  const clip = polygon(b);
  for (let i = 0; i < clip.length && points.length; i++) {
    const u = clip[i],
      v = clip[(i + 1) % clip.length],
      out: Point[] = [];
    for (let j = 0; j < points.length; j++) {
      const p = points[j],
        q = points[(j + 1) % points.length],
        dp = cross(u, v, p),
        dq = cross(u, v, q);
      if (dp >= 0) out.push(p);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    points = out;
  }
  return (
    Math.abs(
      points.reduce((s, p, i) => {
        const q = points[(i + 1) % points.length];
        return s + p[0] * q[1] - q[0] * p[1];
      }, 0),
    ) *
    0.5 *
    height
  );
}
export function unreachableSlots(r: ProbeRecording): string[] {
  const step = 0.25,
    nx = 73,
    nz = 57;
  const obstacle = (x: number, z: number) =>
    x < -8.65 ||
    x > 8.65 ||
    z < -6.65 ||
    z > 6.65 ||
    r.colliders.some(
      (c) =>
        c.minY < 1.75 && c.maxY > 0.05 && colliderDistance(c, x, z) <= 0.35,
    );
  const index = (x: number, z: number) =>
    Math.round((z + 7) / step) * nx + Math.round((x + 9) / step);
  const xy = (n: number): Point => [
    -9 + (n % nx) * step,
    -7 + Math.floor(n / nx) * step,
  ];
  const seen = new Set<number>(),
    queue: number[] = [];
  const start = index(0, 5.4);
  if (!obstacle(0, 5.4) && !obstacle(...xy(start))) {
    seen.add(start);
    queue.push(start);
  }
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i],
      col = n % nx,
      row = Math.floor(n / nx);
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = col + dc,
        z = row + dr;
      if (x < 0 || x >= nx || z < 0 || z >= nz) continue;
      const next = z * nx + x;
      if (!seen.has(next) && !obstacle(...xy(next))) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return r.slots
    .filter((s) => {
      const x = s.pos[0] + Math.sin(s.facingY) * 1.2,
        z = s.pos[2] + Math.cos(s.facingY) * 1.2;
      return obstacle(x, z) || !seen.has(index(x, z));
    })
    .map((s) => s.id);
}
export interface ProbeEvidence {
  building: string;
  mode: CaptureMode;
  source: CaptureSource;
  recording: ProbeRecording;
  bounds: { min: Vec3; max: Vec3 }[];
  triangles: number;
  drawCalls: number;
  consoleErrors?: string[];
  buildError?: string;
  signVisibility?: { areaRatio: number; unoccluded: boolean };
}
export function runProbes(e: ProbeEvidence): ProbeResult {
  const r = e.recording,
    errors = [...(e.consoleErrors ?? [])];
  if (e.buildError) errors.push(e.buildError);
  const probes: ProbeCheck[] = [];
  const add = (id: ProbeCheck["id"], pass: boolean, details: string) =>
    probes.push({ id, pass, details });
  const interior = e.mode === "interior";
  if (e.mode !== "portrait") {
    add(
      "P1",
      errors.length === 0 && r.calls > 0,
      errors.join("; ") ||
        (r.calls
          ? "Module built without recorded errors"
          : "No module calls recorded"),
    );
    const min = interior ? [-9, 0, -7] : [-13, 0, -13],
      max = interior ? [9, 4.2, 7] : [13, 30, 13];
    const outside = e.bounds.filter(
      (b) =>
        b.min.some((v, i) => !Number.isFinite(v) || v < min[i] - 0.05) ||
        b.max.some((v, i) => !Number.isFinite(v) || v > max[i] + 0.05),
    );
    add(
      "P2",
      e.bounds.length > 0 && outside.length === 0,
      `${outside.length} out-of-bounds meshes of ${e.bounds.length}`,
    );
    if (!interior) {
      const door = r.entrances[0],
        sign = r.signs[0];
      const blocked = door
        ? r.colliders.filter(
            (c) =>
              c.minY < 1.75 &&
              c.maxY > 0.05 &&
              colliderDistance(c, 0, door.z + 1.5) < 1.5,
          )
        : [];
      add(
        "P3",
        r.entrances.length === 1 &&
          door.z >= 6 &&
          door.z <= 11 &&
          r.signs.length === 1 &&
          sign.pos[1] >= 3.2 &&
          sign.pos[1] <= 6 &&
          blocked.length === 0,
        `${r.entrances.length} entrances; ${r.signs.length} signs; ${blocked.length} colliders within 1.5m of ring (door z + 1.5m)`,
      );
    } else {
      const problems: string[] = [];
      if (
        r.slots.length !== 6 ||
        new Set(r.slots.map((s) => s.id)).size !== 6 ||
        r.slots.some((s) => !/^s[1-6]$/.test(s.id))
      )
        problems.push("Require exactly s1..s6");
      for (let i = 0; i < r.slots.length; i++) {
        const s = r.slots[i];
        if (Math.abs(s.pos[0]) > 8.2 || Math.abs(s.pos[2]) > 6.2)
          problems.push(`${s.id} within 0.8m of wall`);
        if (
          r.colliders.some(
            (c) =>
              c.minY < s.pos[1] + 1.75 &&
              c.maxY > s.pos[1] &&
              colliderDistance(c, s.pos[0], s.pos[2]) === 0,
          )
        )
          problems.push(`${s.id} inside collider`);
        for (const t of r.slots.slice(i + 1))
          if (Math.hypot(s.pos[0] - t.pos[0], s.pos[2] - t.pos[2]) < 1.6)
            problems.push(`${s.id}/${t.id} less than 1.6m apart`);
      }
      add(
        "P4",
        problems.length === 0,
        problems.join("; ") || "Six distinct, spaced, unobstructed slots",
      );
      const unreachable = unreachableSlots(r);
      add(
        "P5",
        r.slots.length === 6 && unreachable.length === 0,
        unreachable.length
          ? `Unreachable approaches: ${unreachable.join(", ")}`
          : "0.25m BFS, 0.35m clearance from (0,5.4)",
      );
    }
    let overlap = 0;
    for (let i = 0; i < r.colliders.length; i++)
      for (let j = i + 1; j < r.colliders.length; j++)
        if (overlapVolume(r.colliders[i], r.colliders[j]) > 0.01) overlap++;
    add("P6", overlap === 0, `${overlap} collider pairs overlap by >0.01m³`);
    add(
      "P7",
      Number.isFinite(e.triangles) &&
        e.triangles > 0 &&
        e.triangles <= (interior ? 400000 : 250000) &&
        e.drawCalls > 0 &&
        e.drawCalls <= 150,
      `${e.triangles} triangles; ${e.drawCalls} draw calls`,
    );
    add("P8", r.lights <= (interior ? 3 : 1), `${r.lights} module lights`);
    if (!interior)
      add(
        "P10",
        !!e.signVisibility &&
          e.signVisibility.areaRatio >= 0.01 &&
          e.signVisibility.unoccluded,
        e.signVisibility
          ? `Sign ${(100 * e.signVisibility.areaRatio).toFixed(2)}% of image; center ${e.signVisibility.unoccluded ? "visible" : "occluded"}`
          : "No measured sign projection/raycast",
      );
  }
  return {
    building: e.building,
    mode: e.mode,
    source: e.source,
    probes,
    stats: {
      triangles: e.triangles,
      drawCalls: e.drawCalls,
      lights: r.lights,
      kitCalls: r.calls,
    },
    consoleErrors: errors,
  };
}
