import { describe, it, expect } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AssetManifest } from "../../../src/world/assets/manifest.contract";
import { PROP_FOOTPRINTS } from "../../../src/world/kit/props.contract";
import { loadLock, hash, safePath } from "../../../assets-pipeline/lib/lock";
import { download } from "../../../assets-pipeline/fetch";
const root = path.resolve(import.meta.dirname, "../../../public/assets");
const manifest: AssetManifest = JSON.parse(
  await readFile(path.join(root, "manifest.json"), "utf8"),
);
describe("asset manifest", () => {
  it("has valid source lock with measured digests and licenses", async () => {
    const l = await loadLock();
    expect(l.files.length).toBeGreaterThan(0);
    expect(l.textures.length).toBeGreaterThan(0);
  });
  it("references real models and material maps", () => {
    expect(manifest.textures.length).toBeGreaterThan(0);
    expect(manifest.models.length).toBeGreaterThan(0);
    expect(manifest.hdris).toHaveLength(2);
    const models = new Set(manifest.models.map((m) => m.id)),
      textures = new Set(manifest.textures.map((t) => t.id));
    for (const id of Object.values({
      ...manifest.props,
      ...manifest.streetFurniture,
    }))
      expect(models.has(id!)).toBe(true);
    for (const m of Object.values(manifest.materials))
      if (m?.texture) expect(textures.has(m.texture)).toBe(true);
    for (const [kind, id] of Object.entries(manifest.props)) {
      const m = manifest.models.find((m) => m.id === id)!;
      const p = PROP_FOOTPRINTS[kind as keyof typeof PROP_FOOTPRINTS];
      for (const dim of ["w", "d", "h"] as const)
        expect(Math.abs(m.bbox[dim] - p[dim]) / p[dim]).toBeLessThan(0.05);
    }
  });
  it("has complete credits and honest rig inventory", async () => {
    for (const a of [
      ...manifest.textures,
      ...manifest.models,
      ...manifest.hdris,
      ...manifest.characters,
      ...manifest.vehicles,
    ]) {
      expect(a.credit.url).toMatch(/^https:/);
      expect(["CC0", "MIT", "CC-BY-4.0"]).toContain(a.credit.license);
    }
    for (const c of manifest.characters) {
      expect(c.bones.head).toBeTruthy();
      expect(c.bones.neck).toBeTruthy();
      expect(c.bones.spine).toBeTruthy();
      expect(c.skinTone).toBeGreaterThanOrEqual(0);
    }
    const lock = await loadLock();
    if (!manifest.characters.length)
      expect(String(lock.procedural.characters)).toMatch(
        /Rocketbox|blocked|inspection/i,
      );
    if (!manifest.vehicles.length)
      expect(String(lock.procedural.vehicle)).toMatch(/car|vehicle/i);
    for (const c of manifest.characters)
      expect(c.skinTone).toBeLessThanOrEqual(5);
  });
  it("built files resolve and budgets hold", async () => {
    for (const t of manifest.textures)
      for (const url of Object.values(t.maps))
        for (const res of t.resolutions)
          expect(
            (
              await readFile(
                path.join(
                  root,
                  url!.replace("/assets/", "").replace("{res}", String(res)),
                ),
              )
            ).length,
          ).toBeGreaterThan(0);
    for (const m of manifest.models) {
      expect(m.triangles).toBeLessThanOrEqual(15000);
      expect(m.lods).toHaveLength(2);
      for (const u of [m.url, ...m.lods])
        expect(
          (await readFile(path.join(root, u.replace("/assets/", ""))))
            .subarray(0, 4)
            .toString(),
        ).toBe("glTF");
    }
  });
});
describe("download integrity", () => {
  it("rejects traversal", () => {
    expect(() => safePath("/tmp/root", "../escape")).toThrow();
  });
  it("caches checked files and uses mirrors without trusting bad bytes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "asset-test-"));
    try {
      const good = Buffer.from("verified");
      const f = {
        path: "a.bin",
        url: "https://source.invalid/a",
        mirrors: ["https://mirror.invalid/a"],
        bytes: good.length,
        sha256: hash(good),
      };
      let calls = 0;
      const request = (async (url: string) => {
        calls++;
        return new Response(url.includes("mirror") ? good : Buffer.from("bad"));
      }) as typeof fetch;
      expect(await download(f, dir, request)).toBe("downloaded");
      expect(calls).toBe(2);
      expect(await download(f, dir, request)).toBe("cached");
      expect(calls).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it("publishes every locked A1 source and no stale sample inventory", async () => {
  const lock = await loadLock();
  expect(manifest.textures.map((t) => t.id).sort()).toEqual(
    lock.textures.map((t) => t.id).sort(),
  );
  expect(manifest.models.map((t) => t.id).sort()).toEqual(
    lock.models.map((t) => t.id).sort(),
  );
  expect(manifest.hdris.map((t) => t.id).sort()).toEqual(
    lock.hdris.map((t) => t.id).sort(),
  );
  expect(manifest.materials).toEqual(lock.materials);
  expect(manifest.props).toEqual(lock.props);
  expect(manifest.streetFurniture).toEqual(lock.streetFurniture);
});

it("has unique asset IDs and no duplicate locked paths", async () => {
  const lock = await loadLock();
  for (const assets of [
    manifest.textures,
    manifest.models,
    manifest.hdris,
    manifest.characters,
    manifest.vehicles,
  ])
    expect(new Set(assets.map((x) => x.id)).size).toBe(assets.length);
  expect(new Set(lock.files.map((f) => f.path)).size).toBe(lock.files.length);
});
