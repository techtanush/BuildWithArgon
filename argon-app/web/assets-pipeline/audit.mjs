// OWNER: karthik. Run after build and tests; records measured inventory, never intended counts.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "../public/assets");
const digest = (b) => createHash("sha256").update(b).digest("hex");
const lockBytes = await fs.readFile(
  path.join(import.meta.dirname, "assets.lock.json"),
);
const lock = JSON.parse(lockBytes),
  manifestBytes = await fs.readFile(path.join(root, "manifest.json")),
  m = JSON.parse(manifestBytes);
const urls = new Set();
for (const t of m.textures)
  for (const url of Object.values(t.maps))
    for (const res of t.resolutions)
      urls.add(url.replace("{res}", String(res)));
for (const x of [...m.models, ...m.characters])
  for (const url of [x.url, ...x.lods]) urls.add(url);
for (const x of [...m.hdris, ...m.vehicles]) urls.add(x.url);
let sourceBytes = 0;
for (const f of lock.files) {
  const b = await fs.readFile(path.join(root, "raw", f.path));
  if (b.length !== f.bytes || digest(b) !== f.sha256)
    throw Error(`Corrupt source ${f.path}`);
  sourceBytes += b.length;
}
let outputBytes = 0;
const outputs = [];
for (const url of [...urls].sort()) {
  const b = await fs.readFile(path.join(root, url.replace("/assets/", "")));
  outputBytes += b.length;
  outputs.push({ url, bytes: b.length, sha256: digest(b) });
}
if (sourceBytes > 600 * 1024 * 1024 || outputBytes > 300 * 1024 * 1024)
  throw Error("Asset byte budget exceeded");
let tests = null;
if (process.argv[2]) {
  const t = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
  if (t.numFailedTests || !t.success) throw Error("Tests failed");
  tests = { passed: t.numPassedTests, failed: t.numFailedTests };
}
const report = {
  validatedAt: new Date().toISOString(),
  lockSha256: digest(lockBytes),
  manifestSha256: digest(manifestBytes),
  rawFiles: lock.files.length,
  rawBytes: sourceBytes,
  outputFiles: outputs.length,
  outputBytes,
  textureSets: m.textures.length,
  materialBindings: Object.keys(m.materials).length,
  models: m.models.length,
  props: Object.keys(m.props),
  streetFurniture: Object.keys(m.streetFurniture),
  hdris: m.hdris.map((x) => ({ id: x.id, use: x.use })),
  characters: m.characters.length,
  vehicles: m.vehicles.length,
  modelTriangles: m.models.reduce((n, x) => n + x.triangles, 0),
  tests,
  procedural: lock.procedural,
  outputs,
};
await fs.writeFile(
  path.join(import.meta.dirname, "evidence/validation.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify({ ...report, outputs: undefined }, null, 2));
