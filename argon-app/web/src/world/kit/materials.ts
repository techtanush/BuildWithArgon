// OWNER: mahin
import * as T from "three";
import type { MaterialKey } from "./types";
import type {
  AssetManifest,
  CityMaterialKey,
} from "../assets/manifest.contract";
import {
  proceduralTextures,
  acquireTextureSet,
  type QualityTier,
} from "./textures";
export type SurfaceKey = MaterialKey | CityMaterialKey;
export const MATERIAL_COLORS: Record<SurfaceKey, string> = {
  wood_floor: "#a67b54",
  wood_dark: "#503a2a",
  wood_light: "#c3a17a",
  plaster_wall: "#d9dcd9",
  plaster_warm: "#e7dfcf",
  trim: "#efede6",
  brick: "#a86a50",
  stucco: "#ded7c7",
  roof: "#424954",
  roof_red: "#8b4839",
  plaza_stone: "#aaa79c",
  metal_dark: "#30363b",
  metal_light: "#b6bec0",
  glass: "#c6dfdf",
  window_glow: "#f4dfb6",
  screen: "#243f52",
  paper: "#f0e9d9",
  fabric_lavender: "#8d829f",
  fabric_blue: "#748f9e",
  fabric_pink: "#b98e93",
  fabric_cream: "#c9c0a9",
  fabric_coral: "#b27660",
  fabric_coral_dark: "#80503d",
  cable: "#25282a",
  plant: "#4c6840",
  pot: "#b47c60",
  accent: "#b97958",
  accent_dark: "#79503f",
  road: "#293139",
  sidewalk: "#beb7a6",
  curb: "#999b94",
  grass: "#677654",
  lane_marking: "#ded8c3",
  dirt: "#7c6a50",
};
export class MaterialLibrary {
  readonly cache = new Map<SurfaceKey, T.MeshStandardMaterial>();
  readonly tileMeters = new Map<SurfaceKey, number>();
  private ownedTextures=new Set<T.Texture>();
  private leases=new Map<SurfaceKey,()=>void>();
  private disposed=false;
  private revision=0;
  constructor(
    public colors = { accent: "#b97958", accentDark: "#79503f" },
    public tier: QualityTier = "high",
  ) {}
  get(key: SurfaceKey): T.MeshStandardMaterial {
    let m = this.cache.get(key);
    if (m) return m;
    const color =
      key === "accent"
        ? this.colors.accent
        : key === "accent_dark"
          ? this.colors.accentDark
          : MATERIAL_COLORS[key];
    m = new T.MeshPhysicalMaterial();
    m.color.set(color);
    m.roughness = key.includes("metal")
      ? 0.34
      : key.includes("wood")
        ? 0.54
        : 0.88;
    m.metalness = key.includes("metal") ? 0.75 : 0;
    if (key === "glass") {
      Object.assign(m, {
        roughness: 0.08,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      Object.assign(m, {
        transmission: this.tier === "high" ? 0.65 : 0,
        thickness: 0.04,
        ior: 1.5,
      });
    } else {
      const maps=proceduralTextures(key);
      Object.values(maps).forEach(t=>this.ownedTextures.add(t));
      Object.assign(m, maps);
      m.normalScale.set(0.22, 0.22);
    }
    if (key.startsWith("fabric"))
      Object.assign(m, { sheen: 0.4, sheenColor: new T.Color(color) });
    if (key === "screen" || key === "window_glow") {
      m.emissive.set(color);
      m.emissiveIntensity = key === "screen" ? 0.5 : 0.35;
    }
    m.name = key;
    this.cache.set(key, m);
    this.tileMeters.set(
      key,
      key === "brick" ? 2 : key.startsWith("fabric") ? 0.5 : 2,
    );
    return m;
  }
  async load(manifest: AssetManifest, tier = this.tier) {
    if(this.disposed)return;
    const revision=++this.revision;this.tier=tier;
    await Promise.all(Object.entries(manifest.materials).map(async ([key,b])=>{
      if(!b||!(key in MATERIAL_COLORS))return;
      const surface=key as SurfaceKey,m=this.get(surface) as T.MeshPhysicalMaterial;
      if(b.tint)m.color.set(b.tint);
      if(b.roughness!==undefined)m.roughness=b.roughness;
      if(b.metalness!==undefined)m.metalness=b.metalness;
      if(b.physical){
        const {sheenColor,...physical}=b.physical;Object.assign(m,physical);
        if(sheenColor)m.sheenColor.set(sheenColor);
        if(tier!=="high")m.transmission=0;
      }
      const set=manifest.textures.find(t=>t.id===b.texture);
      if(set){
        // Set scale before the first await so newly-built geometry uses real metres.
        this.tileMeters.set(surface,set.tileMeters);
        try{
          const lease=await acquireTextureSet(set,tier);
          if(this.disposed||revision!==this.revision){lease.release();return;}
          this.leases.get(surface)?.();this.leases.set(surface,lease.release);
          m.map=m.normalMap=m.roughnessMap=m.aoMap=m.metalnessMap=m.bumpMap=null;
          Object.assign(m,lease.maps);m.userData.assetTexture=set.id;m.color.set(b.tint??"#ffffff");
          m.normalScale.set(.65,.65);m.bumpScale=.015;
        }catch{/* Keep the usable procedural surface on a missing map. */}
      }else if(b.texture===null){
        this.leases.get(surface)?.();this.leases.delete(surface);delete m.userData.assetTexture;
        m.map=m.normalMap=m.roughnessMap=m.aoMap=m.metalnessMap=m.bumpMap=null;
      }
      m.needsUpdate=true;
    }));
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;this.revision++;
    for(const m of this.cache.values())m.dispose();
    this.ownedTextures.forEach(t=>t.dispose());this.ownedTextures.clear();
    this.leases.forEach(release=>release());this.leases.clear();this.cache.clear();
  }
}
export const createMaterials = (
  colors?: { accent: string; accentDark: string },
  tier?: QualityTier,
) => new MaterialLibrary(colors, tier);
