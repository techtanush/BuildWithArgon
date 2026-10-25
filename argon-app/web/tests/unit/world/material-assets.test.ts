import {afterEach,describe,it,expect,vi} from 'vitest';
import * as T from 'three';
import {EMPTY_MANIFEST,type AssetManifest,type PbrTextureSet} from '../../../src/world/assets/manifest.contract';
import {manifestSource,rebaseManifest} from '../../../src/world/assets/loadManifest';
import {MaterialLibrary} from '../../../src/world/kit/materials';
import {acquireTextureSet,loadTextureSet} from '../../../src/world/kit/textures';
import {asphaltShade} from '../../../src/world/city/UrbanRoads';
const set:PbrTextureSet={id:'original/test',maps:{color:'/assets/color_{res}.webp',normal:'/assets/normal_{res}.webp',roughness:'/assets/roughness_{res}.webp'},resolutions:[1024,2048],tileMeters:1.7,credit:{source:'test',url:'https://example.com',license:'CC0'}};
const manifest=():AssetManifest=>({...structuredClone(EMPTY_MANIFEST),textures:[structuredClone(set)],materials:{wood_floor:{texture:set.id}}});
afterEach(()=>vi.restoreAllMocks());
describe('renderer asset integration',()=>{
 it('only permits explicit local development asset bridges',()=>{
  expect(manifestSource('?assetBase=http://127.0.0.1:5174/assets',true)).toBe('http://127.0.0.1:5174/assets/manifest.json');
  for(const value of ['https://example.com/assets','http://127.0.0.1.evil.test/assets','file:///assets','http://user:secret@localhost/assets'])expect(manifestSource('?assetBase='+encodeURIComponent(value),true)).toBe('/assets/manifest.json');
  expect(manifestSource('?assetBase=http://localhost:5174/assets',false)).toBe('/assets/manifest.json');
 });
 it('rebases texture templates without mutating the shared contract data',()=>{
  const input=manifest(),out=rebaseManifest(input,'http://localhost:5174/assets/manifest.json');
  expect(out.textures[0].maps.color).toBe('http://localhost:5174/assets/color_{res}.webp');
  expect(input.textures[0].maps.color).toBe('/assets/color_{res}.webp');
  expect(out.textures[0].credit.url).toBe('https://example.com');
 });
 it('shares map leases and disposes only after the last consumer releases',async()=>{
  const textures:T.Texture[]=[];const loader=vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>{const t=new T.Texture<HTMLImageElement>();textures.push(t);return t;});
  const [a,b]=await Promise.all([acquireTextureSet(set,'high'),acquireTextureSet(set,'high')]);
  const dispose=textures.map(t=>vi.spyOn(t,'dispose'));
  expect(loader).toHaveBeenCalledTimes(3);expect(a.maps.map).toBe(b.maps.map);
  expect(a.maps.map.colorSpace).toBe(T.SRGBColorSpace);expect(a.maps.normalMap.colorSpace).toBe(T.NoColorSpace);
  a.release();dispose.forEach(fn=>expect(fn).not.toHaveBeenCalled());b.release();b.release();dispose.forEach(fn=>expect(fn).toHaveBeenCalledTimes(1));
 });
 it('cleans up partial failures after all concurrent maps settle',async()=>{
  const good:T.Texture[]=[];
  vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async url=>{if(String(url).includes('normal'))throw Error('missing');const t=new T.Texture<HTMLImageElement>();vi.spyOn(t,'dispose');good.push(t);return t;});
  await expect(loadTextureSet(set,'high')).rejects.toThrow('Could not load texture set');
  good.forEach(t=>expect(t.dispose).toHaveBeenCalledTimes(1));
 });
 it('does not tint scanned color maps brown twice and sets scale synchronously',async()=>{
  vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>new T.Texture<HTMLImageElement>());
  const lib=new MaterialLibrary();try{const loading=lib.load(manifest());expect(lib.tileMeters.get('wood_floor')).toBe(1.7);await loading;
   const m=lib.get('wood_floor');expect(m.color.getHexString()).toBe('ffffff');expect(m.userData.assetTexture).toBe(set.id);expect(m.map).toBeTruthy();
  }finally{lib.dispose();}
 });
 it('supports physical bindings while preventing low-tier transmission',async()=>{
  const lib=new MaterialLibrary(undefined,'low');try{const input=manifest();input.materials={glass:{texture:null,physical:{transmission:.95,ior:1.5}},fabric_blue:{texture:null,physical:{sheen:.3,sheenColor:'#c0c8ee'}}};await lib.load(input,'low');
   expect((lib.get('glass') as T.MeshPhysicalMaterial).transmission).toBe(0);
   expect((lib.get('fabric_blue') as T.MeshPhysicalMaterial).sheenColor.getHexString()).toBe('c0c8ee');expect(lib.get('fabric_blue').map).toBeNull();
  }finally{lib.dispose();}
 });
 it('does not attach late textures to a disposed material library',async()=>{
  const resolvers:Array<()=>void>=[],textures:T.Texture[]=[];
  vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(()=>new Promise(resolve=>{const t=new T.Texture<HTMLImageElement>();textures.push(t);vi.spyOn(t,'dispose');resolvers.push(()=>resolve(t));}));
  const lib=new MaterialLibrary(),loading=lib.load(manifest());lib.dispose();resolvers.forEach(resolve=>resolve());await loading;
  expect(lib.cache.size).toBe(0);textures.forEach(t=>expect(t.dispose).toHaveBeenCalledTimes(1));
 });
 it('keeps road wear deterministic, subtle, and finite across the entire city',()=>{
  const values=[];for(let x=-240;x<=240;x+=12)for(let z=-240;z<=240;z+=12){const v=asphaltShade(x,z);expect(v).toBe(asphaltShade(x,z));expect(v).toBeGreaterThan(.77);expect(v).toBeLessThan(.99);values.push(v);}expect(Math.max(...values)-Math.min(...values)).toBeGreaterThan(.15);
 });
});
