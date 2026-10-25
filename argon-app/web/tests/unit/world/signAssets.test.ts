import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import { createKit, type KitBuild } from "../../../src/world/kit/primitives";
import type { MaterialLibrary } from "../../../src/world/kit/materials";

describe("optional generated sign assets", () => {
  const builds: KitBuild[] = [];
  let loads: { url: string; texture: T.Texture; success: () => void; fail: () => void }[];
  beforeEach(() => {
    vi.useFakeTimers();
    loads = [];
    const ctx = { fillRect() {}, strokeRect() {}, fillText() {} };
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ctx }) });
    vi.stubGlobal("navigator", { userAgent: "sign-test" });
    vi.spyOn(T.TextureLoader.prototype, "load").mockImplementation((url, onLoad, _progress, onError) => {
      const texture = new T.Texture<HTMLImageElement>();
      loads.push({ url, texture, success: () => onLoad?.(texture), fail: () => onError?.(new Error("404")) });
      return texture;
    });
  });
  afterEach(() => {
    builds.splice(0).forEach((build) => build.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const make = (departmentId?: string) => {
    const boardMaterial = new T.MeshStandardMaterial();
    const materials = {
      colors: { accent: "#123456", accentDark: "#123456" },
      tileMeters: new Map(), get: () => boardMaterial,
    } as unknown as MaterialLibrary;
    const build = createKit({ mode: "exterior", departmentId, materials });
    builds.push(build);
    build.kit.sign({ pos: [0, 3, 0], width: 4 });
    const board = build.recording.signs[0].mesh;
    const face = board.children[0] as T.Mesh<T.PlaneGeometry, T.MeshStandardMaterial>;
    return { build, face };
  };
  it("uses an encoded same-origin URL and no request without a department", async () => {
    const absent = make();
    await absent.build.ready();
    expect(loads).toHaveLength(0);
    make("engineering/../a & b");
    expect(loads[0].url).toBe("/generated/signs/engineering%2F..%2Fa%20%26%20b.png");
  });
  it("keeps the immediate canvas, replaces it in sRGB and disposes both textures once", async () => {
    const { build, face } = make("engineering");
    expect(face.material.map).toBeInstanceOf(T.CanvasTexture);
    const oldDispose = vi.spyOn(face.material.map!, "dispose");
    const newDispose = vi.spyOn(loads[0].texture, "dispose");
    let ready = false;
    const waiting = build.ready().then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    loads[0].success();
    await waiting;
    expect(face.material.map).toBe(loads[0].texture);
    expect(loads[0].texture.colorSpace).toBe(T.SRGBColorSpace);
    expect(oldDispose).toHaveBeenCalledTimes(1);
    build.dispose(); build.dispose();
    expect(newDispose).toHaveBeenCalledTimes(1);
    expect(oldDispose).toHaveBeenCalledTimes(1);
  });
  it("settles on 404 without replacing the canvas", async () => {
    const { build, face } = make("engineering");
    const fallback = face.material.map;
    const release = vi.spyOn(loads[0].texture, "dispose");
    loads[0].fail();
    await build.ready();
    expect(face.material.map).toBe(fallback);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("bounds readiness and ignores/disposes a late success", async () => {
    const { build, face } = make("engineering");
    const fallback = face.material.map;
    const release = vi.spyOn(loads[0].texture, "dispose");
    const waiting = build.ready();
    await vi.advanceTimersByTimeAsync(2500);
    await waiting;
    loads[0].success();
    expect(face.material.map).toBe(fallback);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("settles on teardown and safely discards late loader callbacks", async () => {
    const { build, face } = make("engineering");
    const fallback = face.material.map;
    const oldRelease = vi.spyOn(fallback!, "dispose");
    const release = vi.spyOn(loads[0].texture, "dispose");
    const waiting = build.ready();
    build.dispose();
    await waiting;
    loads[0].success(); loads[0].fail();
    expect(face.material.map).toBe(fallback);
    expect(oldRelease).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
