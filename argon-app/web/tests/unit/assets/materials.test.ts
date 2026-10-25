import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { assetRoot, loadLock } from "../../../assets-pipeline/lib/lock";
const kit = [
  "wood_floor",
  "wood_dark",
  "wood_light",
  "plaster_wall",
  "plaster_warm",
  "trim",
  "brick",
  "stucco",
  "roof",
  "roof_red",
  "plaza_stone",
  "metal_dark",
  "metal_light",
  "glass",
  "window_glow",
  "screen",
  "paper",
  "fabric_lavender",
  "fabric_blue",
  "fabric_pink",
  "fabric_cream",
  "fabric_coral",
  "fabric_coral_dark",
  "cable",
  "plant",
  "pot",
  "accent",
  "accent_dark",
];
it("covers every frozen material key and all city surfaces", async () => {
  const l = await loadLock();
  if (l.textures.length > 1) {
    for (const key of [
      ...kit,
      "road",
      "sidewalk",
      "curb",
      "grass",
      "lane_marking",
      "dirt",
    ])
      expect(l.materials[key], key).toBeDefined();
  }
});
it("outputs WebP maps at declared actual dimensions and credits every source", async () => {
  const m = JSON.parse(
      await readFile(path.join(assetRoot, "manifest.json"), "utf8"),
    ),
    credits = await readFile(path.join(assetRoot, "CREDITS.md"), "utf8");
  for (const t of m.textures) {
    expect(t.resolutions).toEqual([1024, 2048]);
    expect(t.tileMeters).toBeGreaterThan(0);
    for (const url of Object.values(t.maps) as string[])
      for (const res of t.resolutions) {
        const info = await sharp(
          path.join(
            assetRoot,
            url.replace("/assets/", "").replace("{res}", String(res)),
          ),
        ).metadata();
        expect(info.format).toBe("webp");
        expect(info.width).toBe(res);
        expect(info.height).toBe(res);
      }
  }
  for (const a of [
    ...m.textures,
    ...m.models,
    ...m.hdris,
    ...m.characters,
    ...m.vehicles,
  ])
    expect(credits).toContain(a.credit.url);
});

it("keeps referenced generated output under the 300 MB budget", async () => {
  const m = JSON.parse(
    await readFile(path.join(assetRoot, "manifest.json"), "utf8"),
  );
  const paths = new Set<string>();
  for (const t of m.textures)
    for (const u of Object.values(t.maps) as string[])
      for (const res of t.resolutions)
        paths.add(u.replace("{res}", String(res)));
  for (const model of [...m.models, ...m.characters])
    for (const u of [model.url, ...model.lods]) paths.add(u);
  for (const asset of [...m.hdris, ...m.vehicles]) paths.add(asset.url);
  let bytes = 0;
  for (const u of paths)
    bytes += (await readFile(path.join(assetRoot, u.replace("/assets/", ""))))
      .length;
  expect(bytes).toBeLessThan(300_000_000);
});
