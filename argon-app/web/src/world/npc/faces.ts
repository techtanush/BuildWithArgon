// OWNER: mahin
import {
  ACCESSORIES,
  BROWS,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  NOSES,
  OUTFITS,
  SKIN,
  type FaceSpec,
} from "./FaceSpec";
import type { ManifestNpc } from "../../shared/contracts";
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (v: unknown): v is string =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
export function validFace(face: unknown): face is FaceSpec {
  if (!face || typeof face !== "object") return false;
  const f = face as FaceSpec;
  return (
    typeof f.agent_id === "string" &&
    [f.skin, f.hair_color, f.eye_color, f.outfit_color, f.pants_color].every(
      hex,
    ) &&
    HAIR_STYLES.includes(f.hair_style) &&
    BROWS.includes(f.brow) &&
    NOSES.includes(f.nose) &&
    ACCESSORIES.includes(f.accessory) &&
    OUTFITS.includes(f.outfit) &&
    f.height >= 0.92 &&
    f.height <= 1.08 &&
    f.build >= 0.9 &&
    f.build <= 1.1 &&
    !!f.names &&
    ["skin", "hair", "eyes", "outfit", "accessory"].every(
      (k) => typeof f.names[k as keyof FaceSpec["names"]] === "string",
    )
  );
}
export function fallbackFace(
  agentId: string,
  color = "#394D59",
  seed = hashSeed(agentId),
): FaceSpec {
  const rng = mulberry32(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)];
  const skin = pick(SKIN),
    hair_style = pick(HAIR_STYLES),
    hair_color = pick(HAIR_COLORS),
    eye_color = pick(EYE_COLORS),
    brow = pick(BROWS),
    nose = pick(NOSES),
    accessory = pick(ACCESSORIES),
    outfit = pick(OUTFITS);
  return {
    agent_id: agentId,
    skin,
    hair_style,
    hair_color,
    eye_color,
    brow,
    nose,
    accessory,
    outfit,
    outfit_color: hex(color) ? color : "#394D59",
    pants_color: pick(["#242932", "#343A40", "#3E3430"]),
    height: 0.92 + rng() * 0.16,
    build: 0.9 + rng() * 0.2,
    names: {
      skin,
      hair: `${hair_color} ${hair_style}`,
      eyes: eye_color,
      outfit,
      accessory,
    },
  };
}
export function faceForNpc(
  npc: Pick<ManifestNpc, "agent_id" | "face">,
  color?: string,
): FaceSpec {
  return validFace(npc.face)
    ? { ...npc.face, agent_id: npc.agent_id }
    : fallbackFace(npc.agent_id, color);
}
