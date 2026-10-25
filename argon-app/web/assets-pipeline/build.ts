import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  cloneDocument,
  getBounds,
  dedup,
  weld,
  prune,
  simplify,
  meshopt,
  textureCompress,
} from "@gltf-transform/functions";
import {
  MeshoptEncoder,
  MeshoptDecoder,
  MeshoptSimplifier,
} from "meshoptimizer";
import { PROP_FOOTPRINTS } from "../src/world/kit/props.contract";
import type {
  AssetManifest,
  PbrTextureSet,
} from "../src/world/assets/manifest.contract";
import { assetRoot, loadLock, safePath, hash } from "./lib/lock";
const l = await loadLock(),
  raw = path.join(assetRoot, "raw");
for (const f of l.files) {
  const b = await readFile(safePath(raw, f.path));
  if (b.length !== f.bytes || hash(b) !== f.sha256)
    throw Error(`Corrupt ${f.path}; run assets:fetch`);
}
const out: AssetManifest = {
  version: 1,
  generatedAt: l.sourceDate,
  textures: [],
  materials: l.materials,
  models: [],
  props: l.props,
  streetFurniture: l.streetFurniture,
  hdris: [],
  characters: [],
  vehicles: [],
};
// Reviewed licensed human bases are versioned with hashes, not regenerated as duplicate identities.
try {
  const approved = JSON.parse(await readFile(new URL("./approved-characters.json", import.meta.url), "utf8"));
  for (const character of approved.characters ?? []) {
    const receipt = approved.validation?.find((item: { id: string }) => item.id === character.id);
    if (!receipt || hash(await readFile(safePath(assetRoot, character.url.replace("/assets/", "")))) !== receipt.sha256)
      throw new Error(`Approved character integrity failed: ${character.id}`);
    out.characters.push(character);
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const textureCache = path.join(raw, ".texture-cache");
await mkdir(textureCache, { recursive: true });
for (const t of l.textures) {
  const id = t.id.split("/").pop()!,
    dir = path.join(assetRoot, "textures", id),
    maps: Record<string, string> = {};
  await mkdir(dir, { recursive: true });
  for (const [key, file] of Object.entries(t.maps)) {
    for (const res of [1024, 2048]) {
      const destination = path.join(dir, `${key}_${res}.webp`);
      const cacheKey = hash(
        Buffer.from(
          JSON.stringify({
            processorRevision: 1,
            source: l.files.find((f) => f.path === file)!.sha256,
            map: key,
            res,
            colorProcessing: t.colorProcessing || null,
            sharp: sharp.versions,
          }),
        ),
      );
      const receipt = path.join(textureCache, cacheKey + ".json");
      try {
        const saved = JSON.parse(await readFile(receipt, "utf8"));
        if (saved.sha256 === hash(await readFile(destination))) continue;
      } catch {}
      let image = sharp(safePath(raw, file)).resize(res, res);
      if (key === "color" && t.colorProcessing === "neutralize-luminance")
        image = image.grayscale().normalize().linear(0.42, 128);
      await image
        .webp({ lossless: key !== "color", quality: 90 })
        .toFile(destination);
      await writeFile(
        receipt,
        JSON.stringify({ sha256: hash(await readFile(destination)) }),
      );
    }
    maps[key] = `/assets/textures/${id}/${key}_{res}.webp`;
  }
  console.log("built texture", t.id);
  out.textures.push({
    id: t.id,
    tileMeters: t.tileMeters,
    resolutions: [1024, 2048],
    maps: maps as PbrTextureSet["maps"],
    credit: t.credit,
  });
}
await Promise.all([
  MeshoptEncoder.ready,
  MeshoptDecoder.ready,
  MeshoptSimplifier.ready,
]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });
// Rigid scans with split UV/normal seams can have a >15k topological floor.
// Meshoptimizer Permissive crosses those seams without dropping mesh parts.
const permissiveSimplifier = {
  ...MeshoptSimplifier,
  simplify: (...args: Parameters<typeof MeshoptSimplifier.simplify>) => {
    args[5] = [...(args[5] ?? []), "Permissive"];
    return MeshoptSimplifier.simplify(...args);
  },
};
const tris = (d: Awaited<ReturnType<NodeIO["read"]>>) =>
  d
    .getRoot()
    .listMeshes()
    .reduce(
      (n, m) =>
        n +
        m
          .listPrimitives()
          .reduce(
            (s, p) =>
              s +
              (p.getIndices()?.getCount() ??
                p.getAttribute("POSITION")?.getCount() ??
                0) /
                3,
            0,
          ),
      0,
    );
const report = [];
for (const m of l.models) {
  const d = await io.read(safePath(raw, m.file)),
    scene = d.getRoot().listScenes()[0],
    target = m.prop ? PROP_FOOTPRINTS[m.prop] : m.target;
  if (!scene || !target || d.getRoot().listSkins().length)
    throw Error("Invalid prop");
  if (m.rotationZ) {
    const pose = d.createNode("reviewed-flat-book-stack");
    for (const node of [...scene.listChildren()]) pose.addChild(node);
    pose.setRotation([
      0,
      0,
      Math.sin(m.rotationZ / 2),
      Math.cos(m.rotationZ / 2),
    ]);
    scene.addChild(pose);
  }
  if (m.rotationY) {
    const oriented = d.createNode("reviewed-source-front");
    for (const node of [...scene.listChildren()]) oriented.addChild(node);
    oriented.setRotation([
      0,
      Math.sin(m.rotationY / 2),
      0,
      Math.cos(m.rotationY / 2),
    ]);
    scene.addChild(oriented);
  }
  const b = getBounds(scene),
    e = b.max.map((v, i) => v - b.min[i]);
  if (e.some((x) => x <= 0)) throw Error("Degenerate bbox");
  const wrap = d.createNode("floor-center-metres");
  for (const n of [...scene.listChildren()]) wrap.addChild(n);
  scene.addChild(wrap);
  wrap.setScale([target.w / e[0], target.h / e[1], target.d / e[2]]);
  wrap.setTranslation([
    ((-(b.max[0] + b.min[0]) / 2) * target.w) / e[0],
    (-b.min[1] * target.h) / e[1],
    ((-(b.max[2] + b.min[2]) / 2) * target.d) / e[2],
  ]);
  await d.transform(
    dedup(),
    weld(),
    prune(),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [1024, 1024],
    }),
  );
  for (const error of [0.001, 0.003, 0.01]) {
    if (tris(d) <= 15000) break;
    await d.transform(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: 14000 / tris(d),
        error,
      }),
    );
  }
  let permissiveUsed = false;
  if (tris(d) > 15000) {
    permissiveUsed = true;
    await d.transform(
      simplify({
        simplifier: permissiveSimplifier,
        ratio: 14000 / tris(d),
        error: 0.001,
      }),
    );
  }
  if (tris(d) > 15000) throw Error(`Budget exceeded ${m.id}`);
  const count = tris(d),
    bounds = getBounds(scene),
    id = m.id.split("/").pop()!,
    lods: string[] = [];
  await mkdir(path.join(assetRoot, "models"), { recursive: true });
  for (let lod = 0; lod < 3; lod++) {
    const c = cloneDocument(d);
    if (lod)
      await c.transform(
        simplify({
          simplifier: permissiveSimplifier,
          ratio: lod === 1 ? 0.5 : 0.2,
          error: 0.01,
        }),
      );
    await c.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
    const filename = `${id}${lod ? `_lod${lod}` : ""}.glb`;
    await io.write(path.join(assetRoot, "models", filename), c);
    if (lod) lods.push(`/assets/models/${filename}`);
  }
  out.models.push({
    id: m.id,
    url: `/assets/models/${id}.glb`,
    lods,
    bbox: {
      w: bounds.max[0] - bounds.min[0],
      h: bounds.max[1] - bounds.min[1],
      d: bounds.max[2] - bounds.min[2],
    },
    triangles: count,
    credit: m.credit,
  });
  report.push({
    ...out.models.at(-1),
    optimization: { permissiveLod0: permissiveUsed },
  });
  console.log("built", m.id, count);
}
await mkdir(path.join(assetRoot, "hdri"), { recursive: true });
for (const h of l.hdris) {
  const id = h.id.split("/").pop()!;
  const b = await readFile(safePath(raw, h.file));
  if (!b.subarray(0, 20).toString().includes("#?")) throw Error("Not HDR");
  await copyFile(
    safePath(raw, h.file),
    path.join(assetRoot, "hdri", id + ".hdr"),
  );
  out.hdris.push({
    id: h.id,
    url: `/assets/hdri/${id}.hdr`,
    use: h.use,
    credit: h.credit,
  });
}
// Remove only pipeline-owned generated files absent from this successful build.
const keep = new Set<string>();
for (const t of out.textures)
  for (const url of Object.values(t.maps))
    for (const res of t.resolutions)
      keep.add(url!.replace("{res}", String(res)).replace("/assets/", ""));
for (const m of out.models)
  for (const url of [m.url, ...m.lods]) keep.add(url.replace("/assets/", ""));
for (const h of out.hdris) keep.add(h.url.replace("/assets/", ""));
for (const c of out.characters) for (const url of [c.url, ...c.lods]) keep.add(url.replace("/assets/", ""));
async function cleanGenerated(relative: string) {
  const dir = path.join(assetRoot, relative);
  for (const item of await readdir(dir, { withFileTypes: true }).catch(
    () => [],
  )) {
    const name = path.join(relative, item.name);
    if (item.isDirectory()) await cleanGenerated(name);
    else if (!keep.has(name)) await rm(path.join(assetRoot, name));
  }
}
for (const dir of ["textures", "models", "hdri"]) await cleanGenerated(dir);
await writeFile(
  path.join(assetRoot, "manifest.json"),
  JSON.stringify(out, null, 2) + "\n",
);
await writeFile(
  path.join(assetRoot, "CREDITS.md"),
  "# Asset credits\n\nGenerated from assets.lock.json; Poly Haven assets are CC0: https://polyhaven.com/license\n\n" +
    [...l.textures, ...l.models, ...l.hdris, ...out.characters]
      .map(
        (a) =>
          `- ${a.id}: [${a.credit.source}](${a.credit.url}), ${a.credit.author}; ${a.credit.license}`,
      )
      .join("\n") +
    "\n\n## Procedural / blocked\n\n" +
    JSON.stringify(l.procedural, null, 2) +
    "\n",
);
await writeFile(
  path.resolve(import.meta.dirname, "evidence/build-report.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  "manifest",
  out.textures.length,
  out.models.length,
  out.hdris.length,
  "avatars",
  out.characters.length,
);
