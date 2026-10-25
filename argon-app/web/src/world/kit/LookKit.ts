// OWNER: mahin
import * as T from "three";
import { createComposer } from "./post";
import type { QualityTier } from "./textures";
export function createRenderer(
  canvas: HTMLCanvasElement,
  tier: QualityTier = "high",
) {
  const renderer = new T.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.setPixelRatio(
    Math.min(
      globalThis.devicePixelRatio ?? 1,
      tier === "high" ? 1.5 : tier === "medium" ? 1 : 0.85,
    ),
  );
  return renderer;
}
export function createLookKit(
  canvas: HTMLCanvasElement,
  {
    quality = "high",
    scene,
    camera,
  }: { quality?: QualityTier; scene: T.Scene; camera: T.Camera },
) {
  const renderer = createRenderer(canvas, quality);
  let composer = createComposer(
    renderer,
    scene,
    camera,
    canvas.clientWidth || 1,
    canvas.clientHeight || 1,
    quality,
  );
  renderer.info.autoReset = false;
  return {
    renderer,
    render: () => {
      renderer.info.reset();
      composer.render();
    },
    setQuality(tier: QualityTier) {
      composer.passes.forEach((p) => p.dispose());
      composer.dispose();
      composer = createComposer(
        renderer,
        scene,
        camera,
        canvas.clientWidth || 1,
        canvas.clientHeight || 1,
        tier,
      );
    },
    resize(w: number, h: number) {
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
    },
    dispose() {
      composer.passes.forEach((p) => p.dispose());
      composer.dispose();
      renderer.dispose();
    },
  };
}
