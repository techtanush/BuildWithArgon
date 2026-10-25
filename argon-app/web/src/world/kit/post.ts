// OWNER: mahin
import * as T from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { QualityTier } from "./textures";
export function createComposer(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  camera: T.Camera,
  w: number,
  h: number,
  tier: QualityTier = "high",
) {
  const composer = new EffectComposer(
    renderer,
    new T.WebGLRenderTarget(w, h, { type: T.HalfFloatType }),
  );
  composer.addPass(new RenderPass(scene, camera));
  if (tier !== "low") {
    if(tier === "high"){
    const ao = new GTAOPass(scene, camera, Math.ceil(w*.6), Math.ceil(h*.6));
    ao.updateGtaoMaterial({
      radius: 0.6,
      distanceExponent: 1.2,
      thickness: 1,
      scale: 1,
    });
    ao.blendIntensity = 0.75;
    composer.addPass(ao);
    }
    composer.addPass(new UnrealBloomPass(new T.Vector2(w, h), 0.035, 0.35, 1.3));
  }
  composer.addPass(new SMAAPass());
  composer.addPass(new OutputPass());
  return composer;
}
