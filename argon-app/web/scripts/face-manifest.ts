// OWNER: ayan
// Offline adapter for a renderer's capture manifest. It does not change the renderer or imply photoreal avatars.
// tsx scripts/face-manifest.ts --manifest INPUT.json --faces kernel/data/faces.json --out OUTPUT.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCESSORIES, BROWS, HAIR_STYLES, NOSES, OUTFITS, type FaceSpec } from '../src/world/npc/FaceSpec';

type CaptureManifest = { npcs: { agent_id: string; face?: FaceSpec | null; [key: string]: unknown }[]; [key: string]: unknown };
const hex = (v: unknown): boolean => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
export function withGeneratedFaces(manifest: CaptureManifest, faces: FaceSpec[]): CaptureManifest {
  const byId = new Map<string, FaceSpec>();
  for (const face of faces) {
    if (!face || typeof face.agent_id !== 'string' || byId.has(face.agent_id)
      || ![face.skin, face.hair_color, face.eye_color, face.outfit_color, face.pants_color].every(hex)
      || !HAIR_STYLES.includes(face.hair_style) || !BROWS.includes(face.brow) || !NOSES.includes(face.nose)
      || !ACCESSORIES.includes(face.accessory) || !OUTFITS.includes(face.outfit)
      || !(face.height >= .92 && face.height <= 1.08 && face.build >= .9 && face.build <= 1.1)
      || !face.names || !['skin', 'hair', 'eyes', 'outfit', 'accessory'].every(k => typeof face.names[k as keyof FaceSpec['names']] === 'string')) {
      throw new Error('Invalid or duplicate generated FaceSpec');
    }
    byId.set(face.agent_id, face);
  }
  const ids = new Set(manifest.npcs.map(n => n.agent_id));
  if (ids.size !== manifest.npcs.length || byId.size !== ids.size || [...ids].some(id => !byId.has(id))) {
    throw new Error('Generated face identities must match manifest NPCs exactly');
  }
  return { ...manifest, npcs: manifest.npcs.map(n => ({ ...n, face: byId.get(n.agent_id)! })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name: string): string => {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0 || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error(`--${name} required`);
    return resolve(process.argv[i + 1]);
  };
  const manifestPath = arg('manifest'), facesPath = arg('faces'), out = arg('out');
  if ([manifestPath, facesPath].includes(out)) throw new Error('Use a new output path; source files must remain unchanged');
  const manifestText = readFileSync(manifestPath, 'utf8'), facesText = readFileSync(facesPath, 'utf8');
  const result = withGeneratedFaces(JSON.parse(manifestText), JSON.parse(facesText));
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(`${out}.provenance.json`, `${JSON.stringify({
    adapter: 'generated FaceSpecs injected into capture manifest by agent_id',
    identities: result.npcs.length, faces_source: facesPath,
    faces_sha256: createHash('sha256').update(facesText).digest('hex'),
    manifest_source: manifestPath, manifest_sha256: createHash('sha256').update(manifestText).digest('hex'),
    photoreal_verified: false, portraits_captured: false,
  }, null, 2)}\n`);
  console.log(`Wrote ${result.npcs.length} generated identities; avatar realism and portrait capture remain unverified`);
}
