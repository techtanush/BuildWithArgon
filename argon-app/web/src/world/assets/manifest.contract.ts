// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)
// The photoreal asset manifest (architecture-files/05-world/12-photoreal-look.md §4).
// - karthik: web/assets-pipeline/ writes web/public/assets/manifest.json matching these types.
// - mahin:   the kit, city, characters and car read ONLY this manifest (fetch('/assets/manifest.json')).
// Every entry is optional at runtime: a missing entry or a failed load falls back to procedural PBR.
import type { MaterialKey, PropKind } from '../kit/types';

export type License = 'CC0' | 'MIT' | 'CC-BY-4.0';
export interface AssetCredit { source: string; url: string; author?: string; license: License }

/** Map URLs contain `{res}` (e.g. '/assets/textures/red_brick_03/color_{res}.webp'); res ∈ resolutions. */
export interface PbrTextureSet {
  id: string; // e.g. 'polyhaven/red_brick_03'
  maps: { color: string; normal: string; roughness: string; ao?: string; metalness?: string; height?: string };
  resolutions: number[]; // e.g. [1024, 2048]
  tileMeters: number; // real-world width of one tile
  credit: AssetCredit;
}

/** City-only surfaces that are not part of the kit API. */
export type CityMaterialKey = 'road' | 'sidewalk' | 'curb' | 'grass' | 'lane_marking' | 'dirt';

export interface MaterialBinding {
  texture: string | null; // PbrTextureSet id, or null = physical material without maps
  tint?: string; // hex multiplied into the color map
  roughness?: number;
  metalness?: number;
  physical?: { clearcoat?: number; transmission?: number; ior?: number; sheen?: number; sheenColor?: string };
}

export interface ModelAsset {
  id: string;
  url: string; // meshopt-compressed .glb under /assets/models/
  lods: string[]; // lower LODs, may be empty
  bbox: { w: number; d: number; h: number }; // meters, after normalization (origin at floor center, +Z front)
  triangles: number; // LOD0
  credit: AssetCredit;
}

export interface HdriAsset {
  id: string;
  url: string; // .hdr (1k–4k) under /assets/hdri/
  use: 'exterior' | 'interior';
  sunDirection?: [number, number, number]; // unit vector toward the sun (exterior)
  exposure?: number;
  credit: AssetCredit;
}

export type Viseme = 'A' | 'E' | 'O' | 'U' | 'M' | 'F' | 'C';

export interface CharacterAsset {
  id: string;
  url: string; // .glb with skeleton (and morph targets if any)
  lods: string[];
  skinTone: 0 | 1 | 2 | 3 | 4 | 5; // nearest index into SKIN (npc/FaceSpec.ts)
  hair: 'short' | 'long' | 'bald' | 'covered' | 'other';
  build: 'slim' | 'average' | 'broad';
  heightM: number;
  bones: { head: string; neck: string; spine: string; jaw?: string; eyeL?: string; eyeR?: string; armL?: string; armR?: string };
  visemes?: Partial<Record<Viseme, string>>; // morph target names, if the avatar has them
  blink?: { left: string; right: string } | { both: string }; // morph target names, if any
  outfitMaterial?: string; // material name that can be tinted with FaceSpec.outfit_color
  animations: string[]; // clip names inside the glb, e.g. ['idle', 'talk']
  triangles: number;
  credit: AssetCredit;
}

export interface VehicleAsset {
  id: string;
  url: string;
  bbox: { w: number; d: number; h: number };
  wheels?: { fl: string; fr: string; rl: string; rr: string }; // node names
  paintMaterial?: string;
  credit: AssetCredit;
}

export type StreetFurnitureKind = 'bench' | 'street_lamp' | 'trash_bin' | 'bollard' | 'planter' | 'bike_rack';

export interface AssetManifest {
  version: 1;
  generatedAt: string | null;
  textures: PbrTextureSet[];
  materials: Partial<Record<MaterialKey | CityMaterialKey, MaterialBinding>>;
  models: ModelAsset[];
  props: Partial<Record<PropKind, string>>; // PropKind -> ModelAsset id
  streetFurniture: Partial<Record<StreetFurnitureKind, string>>; // -> ModelAsset id
  hdris: HdriAsset[];
  characters: CharacterAsset[];
  vehicles: VehicleAsset[];
}

export const EMPTY_MANIFEST: AssetManifest = {
  version: 1, generatedAt: null, textures: [], materials: {}, models: [], props: {}, streetFurniture: {},
  hdris: [], characters: [], vehicles: [],
};
