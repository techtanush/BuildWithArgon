import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AssetCredit,
  AssetManifest,
  MaterialBinding,
} from "../../src/world/assets/manifest.contract";
import type { PropKind } from "../../src/world/kit/types";
export interface LockedFile {
  path: string;
  url: string;
  sha256: string;
  bytes: number;
  mirrors?: string[];
}
export interface SourceLock {
  version: 1;
  sourceDate: string;
  files: LockedFile[];
  textures: {
    id: string;
    tileMeters: number;
    colorProcessing?: "neutralize-luminance";
    maps: Record<string, string>;
    credit: AssetCredit;
  }[];
  models: {
    id: string;
    file: string;
    prop?: PropKind;
    target?: {
      w: number;
      d: number;
      h: number;
    };
    rotationY: number;
    rotationZ?: number;
    credit: AssetCredit;
  }[];
  hdris: {
    id: string;
    file: string;
    use: "interior" | "exterior";
    credit: AssetCredit;
  }[];
  materials: Record<string, MaterialBinding>;
  props: AssetManifest["props"];
  streetFurniture: AssetManifest["streetFurniture"];
  characters: unknown[];
  vehicles: unknown[];
  procedural: Record<string, unknown>;
}
export const assetRoot = path.resolve(
  import.meta.dirname,
  "../../public/assets",
);
export const hash = (b: Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export function safePath(root: string, rel: string) {
  const p = path.resolve(root, rel);
  if (
    path.isAbsolute(rel) ||
    rel.includes("\\") ||
    !p.startsWith(root + path.sep)
  )
    throw Error("Unsafe asset path");
  return p;
}
export function validateLock(l: SourceLock) {
  if (l.version !== 1) throw Error("Unsupported lock");
  const seen = new Set();
  for (const f of l.files) {
    safePath(assetRoot, f.path);
    if (
      !/^https:\/\//.test(f.url) ||
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      f.bytes <= 0 ||
      seen.has(f.path)
    )
      throw Error("Invalid locked file");
    seen.add(f.path);
  }
  for (const t of l.textures) {
    if (
      !(t.tileMeters > 0) ||
      !t.maps.color ||
      !t.maps.normal ||
      !t.maps.roughness
    )
      throw Error("Invalid PBR");
    for (const p of Object.values(t.maps))
      if (!seen.has(p)) throw Error("Unlocked map");
  }
  for (const s of [...l.models, ...l.hdris])
    if (!seen.has(s.file)) throw Error("Unlocked source");
  for (const s of [...l.textures, ...l.models, ...l.hdris])
    if (
      !["CC0", "MIT", "CC-BY-4.0"].includes(s.credit.license) ||
      !s.credit.url
    )
      throw Error("Missing license");
  if (l.characters.length || l.vehicles.length)
    throw Error(
      "Rig/vehicle inspection must be implemented before publishing these assets",
    );
}
export async function loadLock(): Promise<SourceLock> {
  const l = JSON.parse(
    await readFile(
      path.resolve(import.meta.dirname, "../assets.lock.json"),
      "utf8",
    ),
  );
  validateLock(l);
  return l;
}
