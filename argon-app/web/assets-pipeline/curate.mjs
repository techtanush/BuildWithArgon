// OWNER: karthik. Explicit maintainer command: updates the lock from live official APIs.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "../public/assets"),
  ev = path.resolve(
    process.env.ASSET_EVIDENCE_DIR || path.join(root, "raw/.metadata"),
  );
await fs.mkdir(ev, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const get = async (u) => {
  const dir = await fs.mkdtemp(path.join(ev, "request-")),
    dest = path.join(dir, "response");
  try {
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await exec("curl", [
          "-fLsS",
          "--max-time",
          "300",
          "--continue-at",
          "-",
          "--output",
          dest,
          u,
        ]);
        error = null;
        break;
      } catch (e) {
        error = e;
        console.log("retry-range", attempt + 1, u);
      }
    }
    if (error) throw error;
    return await fs.readFile(dest);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};
const json = async (u) => {
  const id = u.startsWith("https://api.polyhaven.com/files/")
    ? u.split("/").pop()
    : null;
  if (id) {
    try {
      return JSON.parse(
        await fs.readFile(path.join(ev, `${id}-files.json`), "utf8"),
      );
    } catch {}
  }
  return JSON.parse((await get(u)).toString());
};
const textures = await json("https://api.polyhaven.com/assets?t=textures"),
  models = await json("https://api.polyhaven.com/assets?t=models"),
  hdris = await json("https://api.polyhaven.com/assets?t=hdris");
const lock = {
  version: 1,
  sourceDate: new Date().toISOString(),
  files: [],
  textures: [],
  models: [],
  hdris: [],
  materials: {},
  props: {},
  streetFurniture: {},
  characters: [],
  vehicles: [],
  procedural: {
    props: [],
    streetFurniture: process.env.ASSET_SAMPLE
      ? ["bench", "street_lamp", "trash_bin", "bollard", "planter", "bike_rack"]
      : ["trash_bin", "bollard", "bike_rack"],
    vehicle:
      "No verified usable CC0 car in inspected Poly Haven catalog; covered_car is a tarp-covered prop, not a drivable car.",
    characters:
      "Rocketbox MIT verified; 35-avatar production conversion and rig inspection remain incomplete. One separate jaw-only WASM smoke had invalid facial morph data; no production avatars are published.",
  },
};
const inFlight = new Map();
async function file(f, rel) {
  if (inFlight.has(rel)) return inFlight.get(rel);
  const work = downloadFile(f, rel);
  inFlight.set(rel, work);
  try {
    return await work;
  } finally {
    inFlight.delete(rel);
  }
}
async function downloadFile(f, rel) {
  const dest = path.join(root, "raw", rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  let b;
  try {
    b = await fs.readFile(dest);
    if (f.md5 && createHash("md5").update(b).digest("hex") !== f.md5) b = null;
  } catch {}
  if (!b) {
    b = await get(f.url);
    if (f.md5 && createHash("md5").update(b).digest("hex") !== f.md5)
      throw Error("upstream MD5 mismatch");
    await fs.writeFile(dest, b);
  }
  if (lock.files.some((f) => f.path === rel)) return rel;
  const entry = { path: rel, url: f.url, sha256: sha(b), bytes: b.length };
  lock.files.push(entry);
  return rel;
}
async function each(entries, fn) {
  const queue = [...entries];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const value = queue.shift();
        await fn(value);
      }
    }),
  );
}
const credit = (id, meta) => ({
  source: "Poly Haven",
  url: `https://polyhaven.com/a/${id}`,
  author: Object.keys(meta.authors || {}).join(", "),
  license: "CC0",
});
const choices = {
  wood_floor: "wood_floor",
  wood_dark: "oak_wood_planks",
  wood_light: "oak_wood_planks",
  plaster_wall: "white_plaster_02",
  brick: "red_brick_03",
  roof: "grey_roof_tiles",
  roof_red: "clay_roof_tiles",
  plaza_stone: "cobblestone_floor_01",
  road: "asphalt_02",
  sidewalk: "concrete_pavement",
  grass: "grass_ground",
  fabric_blue: "rough_linen",
  dirt: "dirt",
  metal_dark: "blue_metal_plate",
};
await each(
  Object.entries(choices).filter(
    ([k]) => !process.env.ASSET_SAMPLE || k === "wood_floor",
  ),
  async ([key, id]) => {
    const m = textures[id];
    if (!m) throw Error(`Unknown texture ${id}`);
    const api = await json(`https://api.polyhaven.com/files/${id}`);
    await fs.writeFile(path.join(ev, `${id}-files.json`), JSON.stringify(api));
    const maps = {};
    for (const [out, source] of [
      ["color", "Diffuse"],
      ["normal", "nor_gl"],
      ["roughness", "Rough"],
    ]) {
      const f = api[source]?.["2k"]?.jpg;
      if (!f) throw Error(`${id} missing ${source}`);
      maps[out] = await file(f, `textures/${id}/${out}.jpg`);
    }
    if (!lock.textures.some((t) => t.id === `polyhaven/${id}`))
      lock.textures.push({
        id: `polyhaven/${id}`,
        ...(["rough_linen", "blue_metal_plate"].includes(id)
          ? { colorProcessing: "neutralize-luminance" }
          : {}),
        tileMeters: m.dimensions[0] / 1000,
        dimensionEvidence: "Poly Haven dimensions in millimetres",
        maps,
        credit: credit(id, m),
      });
    lock.materials[key] = { texture: `polyhaven/${id}` };
    console.log("texture", id);
  },
);
const alias = {
  plaster_warm: "plaster_wall",
  stucco: "plaster_wall",
  trim: "wood_light",
  curb: "sidewalk",
};
lock.materials.wood_dark = {
  texture: null,
  ...lock.materials.wood_dark,
  tint: "#655044",
};
for (const [a, b] of Object.entries(alias))
  lock.materials[a] = lock.materials[b]
    ? { ...lock.materials[b] }
    : { texture: null };
lock.materials.plaster_warm.tint = "#efdfcd";
lock.materials.trim.tint = "#f4f0e7";
for (const [k, tint] of Object.entries({
  lavender: "#a99bbd",
  blue: "#94aec0",
  pink: "#c79ea9",
  cream: "#d9cfb7",
  coral: "#c89481",
  coral_dark: "#9c6b5f",
}))
  lock.materials[`fabric_${k}`] = {
    texture: null,
    ...lock.materials.fabric_blue,
    tint,
    physical: { sheen: 0.3 },
  };
for (const key of [
  "metal_dark",
  "metal_light",
  "paper",
  "plant",
  "pot",
  "cable",
  "screen",
  "glass",
  "window_glow",
  "accent",
  "accent_dark",
  "lane_marking",
])
  lock.materials[key] = {
    texture: null,
    ...lock.materials[key],
    roughness: key === "glass" ? 0.05 : 0.7,
    ...(key.startsWith("metal") ? { metalness: 0.9 } : {}),
    ...(key === "glass" ? { physical: { transmission: 0.95, ior: 1.5 } } : {}),
  };
if (lock.materials.metal_dark) {
  lock.materials.metal_dark.metalness = 0;
  lock.materials.metal_dark.roughness = 0.6;
}
lock.materials.metal_light = { texture: null, metalness: 1, roughness: 0.35 };
const propChoices = {
  armchair: "ArmChair_01",
  chair: "SchoolChair_01",
  desk: "metal_office_desk",
  table_round: "round_wooden_table_02",
  table_long: "painted_wooden_table",
  sofa: "Sofa_01",
  bookshelf: "wooden_bookshelf_worn",
  plant_small: "potted_plant_01",
  lamp_desk: "industrial_pipe_lamp",
  crate: "wooden_crate_01",
  barrel: "wine_barrel_01",
  clock: "wall_clock",
  books: "book_encyclopedia_set_01",
};
await each(
  Object.entries(propChoices).filter(
    ([k]) => !process.env.ASSET_SAMPLE || k === "armchair",
  ),
  async ([key, id]) => {
    const api = await json(`https://api.polyhaven.com/files/${id}`),
      f = api.gltf?.["1k"]?.gltf;
    if (!f) {
      console.log("skip no gltf", id);
      return;
    }
    const main = await file(f, `models/${id}/source.gltf`);
    for (const [rel, include] of Object.entries(f.include || {}))
      await file(include, `models/${id}/${rel}`);
    lock.models.push({
      id: `polyhaven/${id}`,
      file: main,
      prop: key,
      rotationY: 0,
      ...(key === "books" ? { rotationZ: Math.PI / 2 } : {}),
      orientation:
        "Poly Haven glTF front not visually reviewed; +Z is unverified",
      credit: credit(id, models[id]),
    });
    lock.props[key] = `polyhaven/${id}`;
    console.log("model", id);
  },
);
for (const [key, id] of Object.entries(
  process.env.ASSET_SAMPLE
    ? {}
    : {
        street_lamp: "street_lamp_01",
        planter: "planter_box_01",
        bench: "painted_wooden_bench",
      },
)) {
  const api = await json(`https://api.polyhaven.com/files/${id}`),
    f = api.gltf?.["1k"]?.gltf;
  if (!f) continue;
  const main = await file(f, `models/${id}/source.gltf`);
  for (const [rel, i] of Object.entries(f.include || {}))
    await file(i, `models/${id}/${rel}`);
  const dims = models[id].dimensions;
  lock.models.push({
    id: `polyhaven/${id}`,
    file: main,
    target: { w: dims[0] / 1000, d: dims[1] / 1000, h: dims[2] / 1000 },
    rotationY: 0,
    orientation: "Unreviewed source front",
    credit: credit(id, models[id]),
  });
  lock.streetFurniture[key] = `polyhaven/${id}`;
}
lock.procedural.bench =
  "PropKind bench expects 0.45m total height/backless seat; backed scan retained only as native-height street furniture to avoid squashing.";
lock.procedural.metal_light =
  "No verified brushed-aluminium scan in inspected Poly Haven catalog; physical brushed-metal approximation remains.";
for (const [use, id] of Object.entries({
  exterior: "kloofendal_38d_partly_cloudy",
  interior: "small_empty_room_1",
})) {
  const api = await json(`https://api.polyhaven.com/files/${id}`);
  const filePath = await file(api.hdri["1k"].hdr, `hdri/${id}.hdr`);
  lock.hdris.push({
    id: `polyhaven/${id}`,
    file: filePath,
    use,
    credit: credit(id, hdris[id]),
  });
}
const all = [
  "desk",
  "chair",
  "armchair",
  "sofa",
  "table_round",
  "table_long",
  "bookshelf",
  "plant_small",
  "plant_tall",
  "lamp_floor",
  "lamp_desk",
  "screen_stand",
  "whiteboard",
  "counter",
  "crate",
  "barrel",
  "bench",
  "telescope",
  "clock",
  "vault_door",
  "workbench",
  "server_rack",
  "flowerbed",
  "mailbox",
  "flag",
  "easel",
  "filing_cabinet",
  "mug",
  "books",
];
lock.files.sort((a, b) => a.path.localeCompare(b.path));
lock.textures.sort((a, b) => a.id.localeCompare(b.id));
lock.models.sort((a, b) => a.id.localeCompare(b.id));
lock.procedural.props = all.filter((x) => !lock.props[x]);
await fs.writeFile(
  path.resolve(import.meta.dirname, "assets.lock.json.next"),
  JSON.stringify(lock, null, 2) + "\n",
);
await fs.rename(
  path.resolve(import.meta.dirname, "assets.lock.json.next"),
  path.resolve(import.meta.dirname, "assets.lock.json"),
);
console.log(
  "LOCK",
  lock.files.length,
  lock.files.reduce((a, f) => a + f.bytes, 0),
);
