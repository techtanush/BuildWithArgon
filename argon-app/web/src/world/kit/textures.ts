// OWNER: mahin
import * as T from "three";
import type { PbrTextureSet } from "../assets/manifest.contract";
export type QualityTier = "high" | "medium" | "low";
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function seededRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function proceduralTextures(key: string, size = 128) {
  const rand = seededRandom(hashSeed(key)),
    color = new Uint8Array(size * size * 4),
    normal = color.slice(),
    roughness = color.slice();
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        wood = key.includes("wood"),
        brick = key === "brick",
        fabric = key.includes("fabric");
      let h =
        0.55 +
        (rand() - 0.5) * 0.12 +
        0.05 * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI * 4);
      if (wood)
        h +=
          0.12 * Math.sin((u * 32 + 0.16 * Math.sin(v * 30)) * Math.PI * 2) -
          (x % 12 === 0 ? 0.24 : 0);
      if (brick) {
        const row = Math.floor(v * 16);
        if (y % 8 < 1 || (x + (row % 2) * 16) % 32 < 1) h = 0.22;
      }
      if (fabric) h += (x + y) % 2 ? -0.1 : 0.1;
      if (key.includes("stone") || key === "sidewalk")
        if (x % 32 === 0 || y % 32 === 0) h = 0.3;
      height[y * size + x] = h;
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4,
        h = height[y * size + x];
      color.set([h * 140 + 100, h * 140 + 100, h * 140 + 100, 255], i);
      normal.set(
        [
          128 + (h - height[y * size + ((x + 1) % size)]) * 100,
          128 + (h - height[((y + 1) % size) * size + x]) * 100,
          250,
          255,
        ],
        i,
      );
      roughness.set([190 + h * 45, 190 + h * 45, 190 + h * 45, 255], i);
    }
  const make = (data: Uint8Array, srgb = false) => {
    const t = new T.DataTexture(data, size, size);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return {
    map: make(color, true),
    normalMap: make(normal),
    roughnessMap: make(roughness),
  };
}
export function textureUrl(
  url: string,
  resolutions: number[],
  tier: QualityTier,
) {
  const target = tier === "high" ? 2048 : 1024;
  const sorted = [...resolutions].sort((a, b) => a - b);
  const res = sorted.filter((n) => n <= target).pop() ?? sorted[0] ?? target;
  return url.replaceAll("{res}", String(res));
}
export async function loadTextureSet(set: PbrTextureSet, tier: QualityTier) {
  const loader = new T.TextureLoader();
  const out: Record<string, T.Texture> = {};
  const results = await Promise.allSettled(
    Object.entries(set.maps).map(async ([key, url]) => {
      const tex = await loader.loadAsync(
        textureUrl(url, set.resolutions, tier),
      );
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.colorSpace = key === "color" ? T.SRGBColorSpace : T.NoColorSpace;
      tex.anisotropy = tier === "high" ? 8 : 4;
      out[key === "color" ? "map" : key === "height" ? "bumpMap" : `${key}Map`] = tex;
    }),
  );
  if(results.some(result=>result.status==="rejected")){Object.values(out).forEach(texture=>texture.dispose());throw new Error(`Could not load texture set ${set.id}`);}
  return out;
}

// Share decoded/GPU textures across department libraries instead of loading the full
// inventory thirteen times. Each binding owns a lease, not the texture itself.
type TextureLease={maps:Record<string,T.Texture>;release:()=>void};
const texturePool=new Map<string,{refs:number;pending:Promise<Record<string,T.Texture>>}>();
export async function acquireTextureSet(set:PbrTextureSet,tier:QualityTier):Promise<TextureLease>{
 const key=JSON.stringify([set.maps,set.resolutions,tier]);
 let entry=texturePool.get(key);
 if(!entry){entry={refs:0,pending:loadTextureSet(set,tier)};texturePool.set(key,entry);}
 entry.refs++;const current=entry;
 try{const maps=await current.pending;let released=false;return{maps,release(){if(released)return;released=true;current.refs--;if(current.refs===0){if(texturePool.get(key)===current)texturePool.delete(key);new Set(Object.values(maps)).forEach(t=>t.dispose());}}};}
 catch(error){current.refs--;if(current.refs===0&&texturePool.get(key)===current)texturePool.delete(key);throw error;}
}
