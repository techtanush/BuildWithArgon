// OWNER: mahin
import { Color } from "three";
import type { CharacterAsset } from "../assets/manifest.contract";
import { SKIN, type FaceSpec } from "./FaceSpec";
import { hashSeed } from "./faces";
export function pickAvatar(
  face: FaceSpec,
  assets: readonly CharacterAsset[],
  used: ReadonlySet<string> = new Set(),
): CharacterAsset | undefined {
  const skin = new Color(face.skin);
  let tone = 0,
    distance = Infinity;
  SKIN.forEach((s, i) => {
    const c = new Color(s);
    const d = (c.r - skin.r) ** 2 + (c.g - skin.g) ** 2 + (c.b - skin.b) ** 2;
    if (d < distance) {
      distance = d;
      tone = i;
    }
  });
  const hair = ["long", "bun", "ponytail"].includes(face.hair_style)
    ? "long"
    : face.hair_style === "bald"
      ? "bald"
      : "short";
  const pool = assets.some((a) => !used.has(a.id))
    ? assets.filter((a) => !used.has(a.id))
    : [...assets];
  const score = (a: CharacterAsset) =>
    Math.abs(a.skinTone - tone) * 4 +
    (a.hair === hair ? 0 : 2) +
    (a.build ===
    (face.build < 0.96 ? "slim" : face.build > 1.04 ? "broad" : "average")
      ? 0
      : 1);
  return pool.sort(
    (a, b) =>
      score(a) - score(b) ||
      hashSeed(face.agent_id + a.id) - hashSeed(face.agent_id + b.id),
  )[0];
}
