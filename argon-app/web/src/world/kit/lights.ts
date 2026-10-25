// OWNER: mahin
import * as T from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { AssetManifest } from '../assets/manifest.contract';
import type { QualityTier } from './textures';
export const COASTAL_LOOK = {
  exposure: 0.92, sunIntensity: 3.1, skyIntensity: 0.32, environmentIntensity: 0.52,
  sunDirection: [-0.6, 0.62, 0.5] as [number, number, number],
  sunColor: '#fff0dc', skyColor: '#c1d7ef', groundColor: '#5e584a', fogColor: '#c6d8dd', fogDensity: 0.00075,
};
const revisions = new WeakMap<T.Scene, number>();
export async function applyEnvironment(
  renderer: T.WebGLRenderer, scene: T.Scene, mode: 'exterior' | 'interior' = 'exterior',
  manifest?: AssetManifest, isCurrent: () => boolean = () => true,
) {
  const revision = (revisions.get(scene) ?? 0) + 1;
  revisions.set(scene, revision);
  const current = () => isCurrent() && revisions.get(scene) === revision;
  const pmrem = new T.PMREMGenerator(renderer);
  let target: T.WebGLRenderTarget | undefined, source: T.Texture | undefined;
  let usedAsset=false;
  let background: T.Texture | T.Color = new T.Color(mode === 'exterior' ? '#accbdc' : '#cbc4b7');
  const asset = manifest?.hdris.find(h => h.use === mode);
  try {
    if (asset) {
      source = await new RGBELoader().loadAsync(asset.url);
      if (!current()) { source.dispose(); pmrem.dispose(); return () => {}; }
      source.mapping = T.EquirectangularReflectionMapping;
      target = pmrem.fromEquirectangular(source);usedAsset=true;
      if (mode === 'exterior') background = source;
    }
  } catch { source?.dispose(); source = undefined; }
  if (!current()) { source?.dispose(); target?.dispose(); pmrem.dispose(); return () => {}; }
  if (!target) {
    if (mode === 'interior') {
      const room = new RoomEnvironment(); target = pmrem.fromScene(room, .04); room.dispose();
    } else {
      const sky = new Sky(); sky.scale.setScalar(1000);
      sky.material.uniforms.sunPosition.value.fromArray(COASTAL_LOOK.sunDirection);
      sky.material.uniforms.turbidity.value = 2.4; sky.material.uniforms.rayleigh.value = 1.6;
      const skyScene = new T.Scene(); skyScene.add(sky); target = pmrem.fromScene(skyScene);
      sky.geometry.dispose(); sky.material.dispose();
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 512;
      const ctx = canvas.getContext('2d')!, gradient = ctx.createLinearGradient(0, 0, 0, 512);
      gradient.addColorStop(0, '#3f83b9'); gradient.addColorStop(.36, '#76b0d0');
      gradient.addColorStop(.5, '#d0e2e4'); gradient.addColorStop(1, '#9caeaa');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 16, 512);
      source = new T.CanvasTexture(canvas); source.colorSpace = T.SRGBColorSpace;
      source.mapping = T.EquirectangularReflectionMapping; background = source;
    }
  }
  scene.environment = target.texture; scene.background = background;
  scene.environmentIntensity = mode === 'exterior' ? COASTAL_LOOK.environmentIntensity : .8;
  renderer.toneMappingExposure = (usedAsset ? asset?.exposure : undefined) ?? (mode === 'exterior' ? COASTAL_LOOK.exposure : .95);
  scene.userData.environmentSource = usedAsset ? asset!.id : 'procedural';
  pmrem.dispose();
  let disposed = false;
  return () => {
    if (disposed) return; disposed = true;
    if (scene.environment === target?.texture) scene.environment = null;
    if (scene.background === source) scene.background = new T.Color('#b8cdd5');
    target?.dispose(); source?.dispose();
  };
}
export function createLights(
  scene: T.Scene, camera: T.Camera, mode: 'exterior' | 'interior' = 'exterior',
  tier: QualityTier = 'high', manifest?: AssetManifest,
) {
  const root = new T.Group(); scene.add(root);
  root.add(new T.HemisphereLight(COASTAL_LOOK.skyColor, COASTAL_LOOK.groundColor, mode === 'exterior' ? COASTAL_LOOK.skyIntensity : .5));
  const sunDirection = new T.Vector3(...(manifest?.hdris.find(h => h.use === 'exterior')?.sunDirection ?? COASTAL_LOOK.sunDirection)).normalize();
  let csm: CSM | undefined, followSun: T.DirectionalLight | undefined;
  const csmMaterials = new Set<T.Material>();
  if (mode === 'exterior' && tier !== 'low') {
    csm = new CSM({ camera: camera as T.PerspectiveCamera, parent: root, cascades: tier === 'high' ? 3 : 2,
      maxFar: 240, shadowMapSize: tier === 'high' ? 2048 : 1024,
      lightDirection: sunDirection.clone().negate(), lightIntensity: COASTAL_LOOK.sunIntensity });
    for (const light of csm.lights) {
      light.color.set(COASTAL_LOOK.sunColor); light.shadow.autoUpdate = false; light.shadow.needsUpdate = true;
      light.shadow.normalBias = .04; light.shadow.bias = -.00002;
    }
    scene.traverseVisible(o => {
      if (o instanceof T.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m instanceof T.MeshStandardMaterial && !csmMaterials.has(m)) { csm!.setupMaterial(m); csmMaterials.add(m); }
      }
    });
  } else {
    const sun = new T.DirectionalLight(COASTAL_LOOK.sunColor, mode === 'exterior' ? COASTAL_LOOK.sunIntensity : 2.3);
    sun.position.set(-12, 18, 8); sun.castShadow = true;
    sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true; sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -25; sun.shadow.camera.right = sun.shadow.camera.top = 25;
    sun.shadow.normalBias = .04;
    if (mode === 'exterior') {
      followSun = sun; sun.shadow.camera.left = sun.shadow.camera.bottom = -50;
      sun.shadow.camera.right = sun.shadow.camera.top = 50; sun.shadow.camera.far = 350; sun.shadow.camera.updateProjectionMatrix();
    }
    root.add(sun, sun.target);
    if (mode === 'interior') { const lamp = new T.PointLight('#ffe4c4', 25, 18, 2); lamp.position.set(0, 3.9, 0); root.add(lamp); }
  }
  scene.fog = mode === 'exterior' ? new T.FogExp2(COASTAL_LOOK.fogColor, COASTAL_LOOK.fogDensity) : null;
  const lastPosition = new T.Vector3(Infinity, Infinity, Infinity), lastRotation = new T.Quaternion();
  let shadowTime = -Infinity;
  return {
    update() {
      const now = performance.now(), moved = lastPosition.distanceToSquared(camera.position) > .04 || lastRotation.angleTo(camera.quaternion) > .025;
      if ((moved && now - shadowTime >= 80) || now - shadowTime >= 1000) {
        csm?.update(); if (csm) for (const light of csm.lights) light.shadow.needsUpdate = true;
        if (followSun) {
          followSun.position.copy(camera.position).addScaledVector(sunDirection, 150);
          followSun.target.position.copy(camera.position); followSun.target.updateMatrixWorld(); followSun.shadow.needsUpdate = true;
        }
        shadowTime = now; lastPosition.copy(camera.position); lastRotation.copy(camera.quaternion);
      }
    },
    dispose() {
      csm?.remove(); csm?.dispose();
      // CSM deletes injected uniforms: invalidate renderer caches before reusing these materials.
      csmMaterials.forEach(m => m.dispose()); csmMaterials.clear();
      root.traverse(o => { if (o instanceof T.Light) o.dispose(); }); root.removeFromParent();
    },
  };
}
