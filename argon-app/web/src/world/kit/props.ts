// OWNER: mahin
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { PROP_FOOTPRINTS } from "./props.contract";
import type { PropKind, MaterialKey } from "./types";
import { MaterialLibrary } from "./materials";
import type { AssetManifest } from "../assets/manifest.contract";
export function normalizeProp(root: T.Object3D, kind: PropKind) {
  root.updateMatrixWorld(true);
  const b = new T.Box3().setFromObject(root),
    s = b.getSize(new T.Vector3()),
    f = PROP_FOOTPRINTS[kind];
  const wrapper = new T.Group();
  wrapper.add(root);
  root.position.sub(
    new T.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2),
  );
  wrapper.scale.set(f.w / (s.x || 1), f.h / (s.y || 1), f.d / (s.z || 1));
  return wrapper;
}
export async function loadPropModels(manifest: AssetManifest) {
  const models = new Map<PropKind, T.Object3D>(),
    loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(
    Object.entries(manifest.props).map(async ([kind, id]) => {
      const asset = manifest.models.find((m) => m.id === id);
      if (asset)
        try {
          models.set(
            kind as PropKind,
            normalizeProp(
              (await loader.loadAsync(asset.url)).scene,
              kind as PropKind,
            ),
          );
        } catch {
          /* procedural fallback */
        }
    }),
  );
  return models;
}
export function createProp(
  kind: PropKind,
  mats: MaterialLibrary,
  override?: MaterialKey,
): T.Group {
  const g = new T.Group();
  g.name = kind;
  const f = PROP_FOOTPRINTS[kind],
    { w, d, h } = f;
  const add = (
    geo: T.BufferGeometry,
    x: number,
    y: number,
    z: number,
    mat: MaterialKey = "wood_light",
  ) => {
    const m = new T.Mesh(geo, mats.get(override ?? mat));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const box = (
    x: number,
    y: number,
    z: number,
    a: number,
    b: number,
    c: number,
    mat: MaterialKey = "wood_light",
  ) => add(new T.BoxGeometry(a, b, c), x, y, z, mat);
  const cyl = (
    x: number,
    y: number,
    z: number,
    r: number,
    height: number,
    mat: MaterialKey = "metal_dark",
  ) => add(new T.CylinderGeometry(r, r, height, 20), x, y, z, mat);
  const legs = (top: number) => {
    for (const x of [-w * 0.4, w * 0.4])
      for (const z of [-d * 0.36, d * 0.36])
        box(x, top / 2, z, 0.045, top, 0.045, "metal_dark");
  };
  const tabletop = [
    "desk",
    "workbench",
    "table_long",
    "bench",
    "table_round",
  ].includes(kind);
  if (tabletop) {
    if (kind === "table_round") cyl(0, h - 0.035, 0, w / 2, 0.07, "wood_light");
    else box(0, h - 0.04, 0, w, 0.08, d);
    legs(h - 0.08);
    if (kind === "workbench") {
      box(0, 0.18, 0, w * 0.9, 0.04, d * 0.7, "wood_dark");
      box(w * 0.32, h - 0.12, 0, 0.2, 0.15, d * 0.7, "metal_dark");
    }
  } else if (["chair", "armchair", "sofa"].includes(kind)) {
    legs(0.4);
    box(0, 0.43, 0, w, 0.13, d * 0.85, "fabric_cream");
    box(0, (h + 0.48) / 2, -d * 0.4, w, h - 0.48, d * 0.2, "fabric_blue");
    if (kind !== "chair")
      for (const x of [-w * 0.45, w * 0.45])
        box(x, 0.55, 0, w * 0.1, 0.28, d, "fabric_blue");
  } else if (kind.startsWith("plant") || kind === "flowerbed") {
    cyl(0, h * 0.14, 0, Math.min(w, d) * 0.4, h * 0.28, "pot");
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4,
        r = w * 0.28 * Math.sqrt(i / 12),
        y = h * (0.4 + (0.5 * i) / 12);
      cyl(
        Math.cos(a) * r * 0.5,
        y * 0.5,
        Math.sin(a) * r * 0.5,
        0.012,
        y,
        "wood_dark",
      );
      const leaf = add(
        new T.SphereGeometry(1, 8, 6),
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        "plant",
      );
      leaf.scale.set(w * 0.22, h * 0.12, d * 0.22);
      leaf.rotation.z = a;
    }
  } else if (kind === "bookshelf") {
    box(-w / 2 + 0.03, h / 2, 0, 0.06, h, d);
    box(w / 2 - 0.03, h / 2, 0, 0.06, h, d);
    box(0, h / 2, -d / 2 + 0.02, w, h, 0.04, "wood_dark");
    for (let j = 0; j < 5; j++) {
      box(0, (j * h) / 4 + 0.025, 0, w, 0.05, d);
      if (j < 4)
        for (let i = 0; i < 8; i++)
          box(
            -w * 0.4 + i * w * 0.11,
            (j * h) / 4 + 0.2,
            0,
            w * 0.07,
            0.3 + (i % 3) * 0.03,
            d * 0.7,
            ["fabric_blue", "fabric_coral", "paper"][i % 3] as MaterialKey,
          );
    }
  } else if (kind === "lamp_floor" || kind === "lamp_desk") {
    cyl(0, 0.025, 0, w / 2, 0.05);
    cyl(0, h * 0.45, 0, 0.018, h * 0.85);
    add(
      new T.CylinderGeometry(w * 0.3, w * 0.5, h * 0.2, 24, 1, true),
      0,
      h * 0.9,
      0,
      "fabric_cream",
    );
    cyl(0, h * 0.81, 0, w * 0.4, 0.02, "window_glow");
  } else if (kind === "screen_stand") {
    box(0, 0.02, 0, w * 0.5, 0.04, d, "metal_dark");
    box(0, h * 0.3, 0, 0.04, h * 0.6, 0.04, "metal_dark");
    box(0, h * 0.68, 0, w, h * 0.64, 0.04, "metal_dark");
    box(0, h * 0.68, 0.024, w * 0.92, h * 0.56, 0.008, "screen");
  } else if (kind === "whiteboard" || kind === "easel") {
    legs(h * 0.5);
    box(0, h * 0.68, 0, w, h * 0.6, 0.06, "wood_dark");
    box(0, h * 0.68, 0.035, w * 0.94, h * 0.55, 0.015, "paper");
    for (let i = 0; i < 4; i++)
      box(-w * 0.2, h * 0.8 - i * 0.12, 0.05, w * 0.35, 0.018, 0.006, "accent");
  } else if (kind === "barrel") {
    cyl(0, h / 2, 0, w / 2, h, "wood_dark");
    for (const y of [h * 0.12, h * 0.82])
      cyl(0, y, 0, w * 0.505, 0.055, "metal_dark");
  } else if (kind === "clock") {
    const c = cyl(0, h / 2, 0, w / 2, d, "paper");
    c.rotation.x = Math.PI / 2;
    box(0, h * 0.59, d * 0.55, 0.02, h * 0.24, 0.012, "metal_dark");
    box(w * 0.12, h * 0.5, d * 0.55, w * 0.26, 0.018, 0.012, "metal_dark");
  } else if (kind === "telescope") {
    legs(h * 0.65);
    const tube = add(
      new T.CylinderGeometry(w * 0.17, w * 0.2, w * 0.8, 24),
      0,
      h * 0.82,
      0,
      "metal_light",
    );
    tube.rotation.z = Math.PI / 3;
    cyl(0, h * 0.6, 0, 0.04, h * 0.5);
  } else if (kind === "vault_door") {
    box(0, h / 2, 0, w, h, d, "metal_dark");
    const door = cyl(0, h * 0.5, d * 0.52, w * 0.4, 0.08, "metal_light");
    door.rotation.x = Math.PI / 2;
    const wheel = add(
      new T.TorusGeometry(w * 0.14, 0.025, 8, 24),
      0,
      h * 0.5,
      d * 0.65,
      "metal_dark",
    );
    wheel.rotation.z = 0.2;
  } else if (kind === "mug") {
    cyl(0, h / 2, 0, w * 0.36, h, "paper");
    const ring = add(
      new T.TorusGeometry(w * 0.25, w * 0.07, 8, 16),
      w * 0.3,
      h * 0.55,
      0,
      "paper",
    );
    ring.scale.y = 1.3;
  } else if (kind === "books") {
    for (let i = 0; i < 4; i++)
      box(
        0,
        (h * (i + 0.5)) / 4,
        0,
        w,
        (h / 4) * 0.9,
        d,
        i % 2 ? "paper" : "fabric_blue",
      );
  } else if (kind === "flag") {
    cyl(0, h / 2, 0, 0.025, h, "metal_light");
    box(w * 0.25, h * 0.85, 0, w * 0.5, h * 0.2, 0.02, "accent");
  } else if (kind === "mailbox") {
    cyl(0, h * 0.35, 0, 0.04, h * 0.7);
    box(0, h * 0.82, 0, w, h * 0.32, d, "accent");
    box(0, h * 0.85, d * 0.51, w * 0.7, 0.025, 0.015, "metal_dark");
  } else {
    box(
      0,
      h / 2,
      0,
      w,
      h,
      d,
      kind === "server_rack"
        ? "metal_dark"
        : kind === "counter"
          ? "wood_dark"
          : "wood_light",
    );
    if (["server_rack", "filing_cabinet", "crate", "counter"].includes(kind)) {
      for (let i = 0; i < 5; i++) {
        box(
          0,
          (h * (i + 0.5)) / 5,
          d * 0.505,
          w * 0.9,
          0.025,
          0.015,
          "metal_light",
        );
        if (kind === "server_rack")
          box(
            w * 0.3,
            (h * (i + 0.5)) / 5,
            d * 0.52,
            0.025,
            0.025,
            0.015,
            "window_glow",
          );
      }
    }
  }
  return normalizeProp(g, kind) as T.Group;
}
