// OWNER: mahin
import { EMPTY_MANIFEST, type AssetManifest } from './manifest.contract';
/** Development-only, loopback-only bridge. Never changes the production manifest contract. */
export function manifestSource(search = '', development = false): string {
  const base = new URLSearchParams(search).get('assetBase');
  if (!development || !base) return '/assets/manifest.json';
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) return '/assets/manifest.json';
    url.pathname = url.pathname.replace(/\/$/, '') + '/manifest.json';
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return '/assets/manifest.json'; }
}
export function rebaseManifest(raw: AssetManifest, source: string): AssetManifest {
  const out = structuredClone(raw);
  if (!source.startsWith('http')) return out;
  const url = (value: string) => new URL(value, source).href.replace(/%7Bres%7D/gi, '{res}');
  for (const texture of out.textures) for (const key of Object.keys(texture.maps) as Array<keyof typeof texture.maps>) {
    const value = texture.maps[key]; if (value) texture.maps[key] = url(value);
  }
  for (const model of out.models) { model.url = url(model.url); model.lods = model.lods.map(url); }
  for (const hdri of out.hdris) hdri.url = url(hdri.url);
  for (const character of out.characters) { character.url = url(character.url); character.lods = character.lods.map(url); }
  for (const vehicle of out.vehicles) vehicle.url = url(vehicle.url);
  return out;
}
const pending = new Map<string, Promise<AssetManifest>>();
export function loadManifest(force = false): Promise<AssetManifest> {
  const source = manifestSource(typeof location === 'undefined' ? '' : location.search, import.meta.env.DEV);
  if (force || !pending.has(source)) pending.set(source, (async () => {
    try {
      const response = await fetch(source);
      if (!response.ok) return structuredClone(EMPTY_MANIFEST);
      const raw = await response.json();
      if (raw.version !== 1) return structuredClone(EMPTY_MANIFEST);
      const manifest = { ...structuredClone(EMPTY_MANIFEST), ...raw };
      for (const key of ['textures', 'models', 'hdris', 'characters', 'vehicles']) if (!Array.isArray(manifest[key])) return structuredClone(EMPTY_MANIFEST);
      return rebaseManifest(manifest, source);
    } catch { return structuredClone(EMPTY_MANIFEST); }
  })());
  return pending.get(source)!;
}
export const loadAssetManifest = loadManifest;
