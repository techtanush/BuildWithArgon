// OWNER: mahin
import * as T from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type {
  KitApi,
  MaterialKey,
  Vec3,
  BuildingModule,
  PropKind,
} from "./types";
import { MaterialLibrary } from "./materials";
import { createProp } from "./props";
import { PROP_FOOTPRINTS } from "./props.contract";
import { seededRandom, hashSeed } from "./textures";
export interface Collider {
  kind: "obb" | "circle";
  x: number;
  z: number;
  halfX?: number;
  halfZ?: number;
  radius?: number;
  rotY: number;
  yMin: number;
  yMax: number;
  name?: string;
}
export interface KitRecording {
  calls: { method: string; options: any; group?: string }[];
  colliders: Collider[];
  slots: Parameters<KitApi["npcSlot"]>[0][];
  entrances: { z: number }[];
  signs: (Parameters<KitApi["sign"]>[0] & { mesh: T.Object3D })[];
  lights: Parameters<KitApi["light"]>[0][];
  bounds: T.Box3;
  triangles: number;
  drawCalls: number;
}
export interface KitOptions {
  mode: "exterior" | "interior";
  departmentId?: string;
  colors?: { accent: string; accentDark: string };
  seed?: number;
  materials?: MaterialLibrary;
  models?: Map<PropKind, T.Object3D>;
  shell?: BuildingModule["interiorShell"] | false;
}
export function metreUV(geometry: T.BufferGeometry, tileMeters = 2) {
  const p = geometry.getAttribute("position"),
    n = geometry.getAttribute("normal"),
    uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)),
      ay = Math.abs(n.getY(i)),
      az = Math.abs(n.getZ(i));
    uv[i * 2] = (ax > ay && ax > az ? p.getZ(i) : p.getX(i)) / tileMeters;
    uv[i * 2 + 1] = (ay > ax && ay > az ? p.getZ(i) : p.getY(i)) / tileMeters;
  }
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  return geometry;
}
export function transformCollider(
  c: Collider,
  position: Vec3,
  rotY: number,
): Collider {
  const co = Math.cos(rotY),
    si = Math.sin(rotY);
  return {
    ...c,
    x: position[0] + c.x * co + c.z * si,
    z: position[2] - c.x * si + c.z * co,
    rotY: c.rotY + rotY,
    yMin: c.yMin + position[1],
    yMax: c.yMax + position[1],
  };
}
export function interactionRing(color = "#e3c85b") {
  const m = new T.Mesh(
    new T.RingGeometry(0.75, 0.8, 48),
    new T.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      side: T.DoubleSide,
      roughness: 0.6,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.018;
  return m;
}
export function createKit(options: KitOptions) {
  const group = new T.Group();
  group.name = options.departmentId ?? "building";
  const own = !options.materials,
    mats = options.materials ?? new MaterialLibrary(options.colors);
  const recording: KitRecording = {
    calls: [],
    colliders: [],
    slots: [],
    entrances: [],
    signs: [],
    lights: [],
    bounds: new T.Box3(),
    triangles: 0,
    drawCalls: 0,
  };
  let disposed = false;
  const pendingSigns = new Set<Promise<void>>();
  const cancelSigns = new Set<() => void>();
  const disposedTextures = new WeakSet<T.Texture>();
  const disposeTexture = (texture?: T.Texture | null) => {
    if (texture && !disposedTextures.has(texture)) {
      disposedTextures.add(texture);
      texture.dispose();
    }
  };
  let label = "";
  const rec = (method: string, o: any) =>
    recording.calls.push({ method, options: structuredClone(o), group: label });
  const mesh = (
    geo: T.BufferGeometry,
    pos: Vec3,
    mat: MaterialKey,
    rot?: Vec3,
    name?: string,
  ) => {
    metreUV(geo, mats.tileMeters.get(mat) ?? 2);
    const m = new T.Mesh(geo, mats.get(mat));
    m.position.fromArray(pos);
    if (rot) m.rotation.set(...rot);
    m.castShadow = m.receiveShadow = true;
    m.name = name ?? mat;
    group.add(m);
    return m;
  };
  const obb = (pos: Vec3, size: Vec3, rotY = 0, name?: string) =>
    recording.colliders.push({
      kind: "obb",
      x: pos[0],
      z: pos[2],
      halfX: size[0] / 2,
      halfZ: size[2] / 2,
      rotY,
      yMin: pos[1] - size[1] / 2,
      yMax: pos[1] + size[1] / 2,
      name,
    });
  const rawBox = (size: Vec3, pos: Vec3, mat: MaterialKey) =>
    mesh(new T.BoxGeometry(...size), pos, mat);
  const kit: KitApi = {
    mode: options.mode,
    bounds:
      options.mode === "exterior"
        ? { minX: -13, maxX: 13, minZ: -13, maxZ: 13, maxY: 30 }
        : { minX: -9, maxX: 9, minZ: -7, maxZ: 7, maxY: 4.2 },
    colors: mats.colors,
    rand: seededRandom(
      options.seed ?? hashSeed(options.departmentId ?? "building"),
    ),
    box(o) {
      rec("box", o);
      const m = mesh(
        new T.BoxGeometry(...o.size),
        o.pos,
        o.mat,
        [0, o.rotY ?? 0, 0],
        o.name,
      );
      m.castShadow = o.castShadow ?? true;
      if (o.collide) obb(o.pos, o.size, o.rotY, o.name);
    },
    roundedBox(o) {
      rec("roundedBox", o);
      mesh(
        new RoundedBoxGeometry(
          ...o.size,
          2,
          Math.min(o.radius, Math.min(...o.size) / 2),
        ),
        o.pos,
        o.mat,
        [0, o.rotY ?? 0, 0],
        o.name,
      );
      if (o.collide) obb(o.pos, o.size, o.rotY, o.name);
    },
    cylinder(o) {
      rec("cylinder", o);
      const m = mesh(
        new T.CylinderGeometry(
          o.radiusTop,
          o.radiusBottom,
          o.height,
          o.segments ?? 24,
        ),
        o.pos,
        o.mat,
        [o.rotX ?? 0, o.rotY ?? 0, o.rotZ ?? 0],
        o.name,
      );
      if (o.collide) {
        if (o.rotX || o.rotZ) {
          m.updateMatrixWorld();
          const b = new T.Box3().setFromObject(m),
            s = b.getSize(new T.Vector3()),
            p = b.getCenter(new T.Vector3());
          obb(p.toArray() as Vec3, s.toArray() as Vec3);
        } else
          recording.colliders.push({
            kind: "circle",
            x: o.pos[0],
            z: o.pos[2],
            radius: Math.max(o.radiusTop, o.radiusBottom),
            rotY: 0,
            yMin: o.pos[1] - o.height / 2,
            yMax: o.pos[1] + o.height / 2,
            name: o.name,
          });
      }
    },
    sphere(o) {
      rec("sphere", o);
      const geo = new T.SphereGeometry(o.radius, 24, 16);
      if (o.scale) geo.scale(...o.scale);
      mesh(geo, o.pos, o.mat, undefined, o.name);
      if (o.collide)
        obb(o.pos, [
          2 * o.radius * (o.scale?.[0] ?? 1),
          2 * o.radius * (o.scale?.[1] ?? 1),
          2 * o.radius * (o.scale?.[2] ?? 1),
        ]);
    },
    cone(o) {
      rec("cone", o);
      mesh(
        new T.ConeGeometry(o.radius, o.height, o.segments ?? 32),
        o.pos,
        o.mat,
        [0, o.rotY ?? 0, 0],
        o.name,
      );
    },
    torus(o) {
      rec("torus", o);
      mesh(
        new T.TorusGeometry(o.radius, o.tube, 8, 40, o.arc ?? Math.PI * 2),
        o.pos,
        o.mat,
        [o.rotX ?? 0, o.rotY ?? 0, 0],
        o.name,
      );
    },
    tube(o) {
      rec("tube", o);
      if (o.points.length < 2) throw new Error("tube requires two points");
      mesh(
        new T.TubeGeometry(
          new T.CatmullRomCurve3(o.points.map((p) => new T.Vector3(...p))),
          Math.max(12, o.points.length * 8),
          o.radius,
          8,
          false,
        ),
        [0, 0, 0],
        o.mat,
        undefined,
        o.name,
      );
    },
    plane(o) {
      rec("plane", o);
      mesh(new T.PlaneGeometry(...o.size), o.pos, o.mat, o.rot, o.name);
    },
    prop(o) {
      rec("prop", o);
      const source = options.models?.get(o.kind);
      const p = source ? source.clone(true) : createProp(o.kind, mats, o.mat),
        s = o.scale ?? 1;
      p.position.fromArray(o.pos);
      p.rotation.y = o.rotY ?? 0;
      const wrapper = new T.Group();
      wrapper.add(p);
      p.scale.multiplyScalar(s);
      group.add(wrapper);
      if (o.collide) {
        const f = PROP_FOOTPRINTS[o.kind];
        obb(
          [o.pos[0], o.pos[1] + (f.h * s) / 2, o.pos[2]],
          [f.w * s, f.h * s, f.d * s],
          o.rotY,
          o.kind,
        );
      }
    },
    light(o) {
      rec("light", o);
      recording.lights.push(o);
      const l =
        o.kind === "spot"
          ? new T.SpotLight(o.color, o.intensity, o.distance)
          : new T.PointLight(o.color, o.intensity, o.distance);
      l.position.fromArray(o.pos);
      if (l instanceof T.SpotLight && o.target) {
        l.target.position.fromArray(o.target);
        group.add(l.target);
      }
      l.castShadow = false;
      group.add(l);
    },
    entrance(o) {
      rec("entrance", o);
      recording.entrances.push(o);
      rawBox([0.12, 2.7, 0.16], [-0.86, 1.35, o.z], "accent");
      rawBox([0.12, 2.7, 0.16], [0.86, 1.35, o.z], "accent");
      rawBox([1.84, 0.12, 0.16], [0, 2.75, o.z], "accent");
      rawBox([1.6, 2.6, 0.06], [0, 1.3, o.z - 0.12], "wood_dark");
      const ring = interactionRing();
      ring.position.z = o.z + 1.5;
      group.add(ring);
    },
    sign(o) {
      rec("sign", o);
      const board = rawBox([o.width, o.width / 4, 0.12], o.pos, "wood_dark");
      board.rotation.y = o.rotY ?? 0;
      let texture: T.Texture | undefined;
      if (
        typeof document !== "undefined" &&
        !navigator.userAgent.includes("jsdom")
      ) {
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#eee5d4";
          ctx.fillRect(0, 0, 1024, 256);
          ctx.strokeStyle = mats.colors.accent;
          ctx.lineWidth = 16;
          ctx.strokeRect(12, 12, 1000, 232);
          ctx.fillStyle = "#303637";
          ctx.textAlign = "center";
          ctx.font = "52px Georgia";
          ctx.fillText(
            (options.departmentId ?? "Foundry")
              .replaceAll("-", " ")
              .toUpperCase(),
            512,
            144,
            940,
          );
          texture = new T.CanvasTexture(canvas);
          texture.colorSpace = T.SRGBColorSpace;
        }
      }
      const face = new T.Mesh(
        new T.PlaneGeometry(o.width * 0.95, (o.width / 4) * 0.85),
        new T.MeshStandardMaterial({
          map: texture ?? null,
          color: texture ? "#ffffff" : "#eee5d4",
          roughness: 0.7,
        }),
      );
      face.position.set(0, 0, 0.065);
      board.add(face);
      recording.signs.push({ ...o, mesh: board });
      // Generated art is optional: the canvas remains visible on missing assets.
      if (options.departmentId && typeof document !== "undefined" && !disposed) {
        let url: string;
        try {
          url = "/generated/signs/" + encodeURIComponent(options.departmentId) + ".png";
        } catch {
          return;
        }
        let resolveReady!: () => void;
        const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
        pendingSigns.add(ready);
        let active = true;
        let requested: T.Texture | undefined;
        const settle = () => {
          if (!active) return;
          active = false;
          clearTimeout(timer);
          cancelSigns.delete(cancel);
          pendingSigns.delete(ready);
          resolveReady();
        };
        const cancel = () => {
          if (!active) return;
          settle();
          disposeTexture(requested);
        };
        const timer = setTimeout(cancel, 2500);
        cancelSigns.add(cancel);
        try {
          requested = new T.TextureLoader().load(url, (loaded) => {
            if (!active || disposed) {
              disposeTexture(loaded);
              return;
            }
            loaded.colorSpace = T.SRGBColorSpace;
            const material = face.material;
            disposeTexture(material.map);
            material.map = loaded;
            material.color.set("#ffffff");
            material.needsUpdate = true;
            settle();
          }, undefined, cancel);
          // Also handle synchronous loaders/errors used by embedders and tests.
          if (!active && face.material.map !== requested) disposeTexture(requested);
        } catch {
          cancel();
        }
      }
    },
    window(o) {
      rec("window", o);
      const north = o.wall === "north",
        sign = o.wall === "east" ? 1 : -1,
        pos: Vec3 = north
          ? [o.center, o.sill + o.height / 2, -6.86]
          : [sign * 8.86, o.sill + o.height / 2, o.center];
      const parent = new T.Group();
      parent.position.fromArray(pos);
      parent.rotation.y = north ? 0 : (-sign * Math.PI) / 2;
      group.add(parent);
      const part = (size: Vec3, p: Vec3, mat: MaterialKey) => {
        const m = new T.Mesh(new T.BoxGeometry(...size), mats.get(mat));
        m.position.fromArray(p);
        parent.add(m);
      };
      part([o.width, o.height, 0.04], [0, 0, 0], "window_glow");
      part([o.width, o.height, 0.025], [0, 0, 0.04], "glass");
      for (const x of [-o.width / 2, 0, o.width / 2])
        part([0.055, o.height + 0.1, 0.12], [x, 0, 0.08], "trim");
      for (const y of [-o.height / 2, o.height / 2])
        part([o.width + 0.15, 0.07, 0.16], [0, y, 0.08], "trim");
      part([o.width + 0.3, 0.09, 0.3], [0, -o.height / 2 - 0.06, 0.15], "trim");
    },
    npcSlot(o) {
      rec("npcSlot", o);
      recording.slots.push(o);
    },
    group(name, fn) {
      const old = label;
      label = name;
      try {
        fn();
      } finally {
        label = old;
      }
    },
  };
  if (options.mode === "interior" && options.shell !== false) {
    const shell = options.shell ?? {};
    rawBox([18, 0.04, 14], [0, -0.02, 0], shell.floor ?? "wood_floor");
    const ceiling = rawBox([18, 0.04, 14], [0, 4.18, 0], "plaster_warm");
    ceiling.name = "ceiling";
    for (const x of [-8.97, 8.97])
      rawBox([0.06, 4.2, 14], [x, 2.1, 0], shell.walls ?? "plaster_wall");
    rawBox([18, 4.2, 0.12], [0, 2.1, -6.97], shell.walls ?? "plaster_wall");
    for (const x of [-4.95, 4.95])
      rawBox([8.1, 4.2, 0.12], [x, 2.1, 6.97], shell.walls ?? "plaster_wall");
    rawBox([1.8, 1.6, 0.12], [0, 3.4, 6.97], shell.walls ?? "plaster_wall");
    for (const x of [-8.91, 8.91])
      rawBox([0.04, 0.12, 14], [x, 0.06, 0], "trim");
    rawBox([18, 0.12, 0.04], [0, 0.06, -6.91], "trim");
    const ring = interactionRing("#c07865");
    ring.position.z = 6.2;
    group.add(ring);
  }
  let finalized = false;
  const finalize = () => {
    group.updateMatrixWorld(true);
    if (!finalized) {
      const bins = new Map<T.Material, T.BufferGeometry[]>();
      const remove: T.Mesh[] = [];
      group.traverse((o) => {
        if (
          o instanceof T.Mesh &&
          !Array.isArray(o.material) &&
          !o.material.transparent &&
          o.name !== "ceiling" &&
          !recording.signs.some((s) => s.mesh === o || s.mesh === o.parent)
        ) {
          const geo = o.geometry
            .clone()
            .applyMatrix4(o.matrixWorld)
            .toNonIndexed();
          const list = bins.get(o.material) ?? [];
          list.push(geo);
          bins.set(o.material, list);
          remove.push(o);
        }
      });
      for (const [mat, geos] of bins) {
        const merged = mergeGeometries(geos);
        geos.forEach((g) => g.dispose());
        if (merged) {
          const m = new T.Mesh(merged, mat);
          m.castShadow = m.receiveShadow = true;
          group.add(m);
        }
      }
      remove.forEach((m) => {
        m.removeFromParent();
        m.geometry.dispose();
      });
      finalized = true;
    }
    recording.bounds.setFromObject(group);
    recording.triangles = 0;
    recording.drawCalls = 0;
    group.traverse((o) => {
      if (o instanceof T.Mesh) {
        recording.triangles +=
          (o.geometry.index?.count ??
            o.geometry.getAttribute("position").count) / 3;
        recording.drawCalls++;
      }
    });
    return recording;
  };
  return {
    kit,
    group,
    recording,
    finalize,
    /** Call after kit methods; every optional sign request settles within 2.5s. */
    async ready() {
      await Promise.all([...pendingSigns]);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cancel of [...cancelSigns]) cancel();
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      for (const sign of recording.signs) {
        sign.mesh.traverse((o) => {
          if (o instanceof T.Mesh && o.parent === sign.mesh) {
            const material = o.material as T.MeshStandardMaterial;
            disposeTexture(material.map);
            material.dispose();
          }
        });
      }
      group.clear();
      if (own) mats.dispose();
    },
  };
}
export type KitBuild = ReturnType<typeof createKit>;
