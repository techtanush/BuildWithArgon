import { it, expect } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { getBounds } from "@gltf-transform/functions";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assetRoot,
  loadLock,
  hash,
  safePath,
} from "../../../assets-pipeline/lib/lock";
it("all raw sources match exact locked SHA256 bytes", async () => {
  for (const f of (await loadLock()).files) {
    const b = await readFile(safePath(path.join(assetRoot, "raw"), f.path));
    expect(hash(b)).toBe(f.sha256);
    expect(b.length).toBe(f.bytes);
  }
});
it("decodes actual meshopt GLBs and measures floor centered bounding boxes", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(assetRoot, "manifest.json"), "utf8"),
  );
  expect(manifest.models.length).toBeGreaterThan(0);
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  for (const m of manifest.models) {
    const d = await io.read(
      path.join(assetRoot, m.url.replace("/assets/", "")),
    );
    const b = getBounds(d.getRoot().listScenes()[0]);
    expect(Math.abs(b.min[1])).toBeLessThan(0.02);
    expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(0.02);
    expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(0.02);
    expect(b.max[0] - b.min[0]).toBeCloseTo(m.bbox.w, 2);
  }
});

it("checks actual skeleton, animation and material names for any published avatar", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(assetRoot, "manifest.json"), "utf8"),
  );
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  for (const c of manifest.characters) {
    const doc = await io.read(
      path.join(assetRoot, c.url.replace("/assets/", "")),
    );
    const nodes = new Set(
      doc
        .getRoot()
        .listNodes()
        .map((n) => n.getName()),
    );
    expect(doc.getRoot().listSkins().length).toBeGreaterThan(0);
    for (const key of ["head", "neck", "spine"])
      expect(nodes.has(c.bones[key]), `${c.id}/${key}`).toBe(true);
    for (const name of Object.values(c.bones))
      expect(nodes.has(String(name))).toBe(true);
    expect(
      Number.isInteger(c.skinTone) && c.skinTone >= 0 && c.skinTone <= 5,
    ).toBe(true);
    const clips = new Set(
      doc
        .getRoot()
        .listAnimations()
        .map((a) => a.getName()),
    );
    for (const clip of c.animations) expect(clips.has(clip)).toBe(true);
    if (c.outfitMaterial)
      expect(
        doc
          .getRoot()
          .listMaterials()
          .some((m) => m.getName() === c.outfitMaterial),
      ).toBe(true);
    const targets = new Set(
      doc
        .getRoot()
        .listMeshes()
        .flatMap((m) =>
          m
            .listPrimitives()
            .flatMap((p) => p.listTargets().map((t) => t.getName())),
        ),
    );
    for (const name of Object.values(c.visemes || {}))
      expect(targets.has(String(name))).toBe(true);
    for (const name of Object.values(c.blink || {}))
      expect(targets.has(String(name))).toBe(true);
  }
});

it("measures actual rendered GLB triangle budgets and all bbox dimensions", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(assetRoot, "manifest.json"), "utf8"),
  );
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  for (const m of manifest.models) {
    for (const [index, url] of [m.url, ...m.lods].entries()) {
      const doc = await io.read(
          path.join(assetRoot, url.replace("/assets/", "")),
        ),
        scene = doc.getRoot().listScenes()[0];
      let triangles = 0;
      scene.traverse((node) => {
        const mesh = node.getMesh();
        if (mesh)
          for (const p of mesh.listPrimitives()) {
            expect(p.getMode()).toBe(4);
            triangles +=
              (p.getIndices()?.getCount() ??
                p.getAttribute("POSITION")!.getCount()) / 3;
          }
      });
      expect(triangles, `${m.id} LOD${index}`).toBeLessThanOrEqual(15000);
      if (index === 0) {
        expect(triangles).toBe(m.triangles);
        const b = getBounds(scene);
        expect(b.max[0] - b.min[0]).toBeCloseTo(m.bbox.w, 2);
        expect(b.max[1] - b.min[1]).toBeCloseTo(m.bbox.h, 2);
        expect(b.max[2] - b.min[2]).toBeCloseTo(m.bbox.d, 2);
      } else expect(triangles).toBeLessThan(m.triangles);
    }
  }
});

it("actually applies every reviewed source pose before normalization", async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  for (const source of (await loadLock()).models) {
    if (!source.rotationY && !source.rotationZ) continue;
    const model = JSON.parse(
      await readFile(path.join(assetRoot, "manifest.json"), "utf8"),
    ).models.find((m: { id: string }) => m.id === source.id);
    const doc = await io.read(
      path.join(assetRoot, model.url.replace("/assets/", "")),
    );
    if (source.rotationZ) {
      const node = doc
        .getRoot()
        .listNodes()
        .find((n) => n.getName() === "reviewed-flat-book-stack");
      expect(node, source.id).toBeDefined();
      expect(node!.getRotation()[2]).toBeCloseTo(
        Math.sin(source.rotationZ / 2),
        5,
      );
    }
    if (source.rotationY) {
      const node = doc
        .getRoot()
        .listNodes()
        .find((n) => n.getName() === "reviewed-source-front");
      expect(node, source.id).toBeDefined();
      expect(node!.getRotation()[1]).toBeCloseTo(
        Math.sin(source.rotationY / 2),
        5,
      );
    }
  }
});
