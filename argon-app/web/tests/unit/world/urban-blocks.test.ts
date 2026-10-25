import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { buildUrbanBlocks } from "../../../src/world/city/UrbanBlocks";
import { MaterialLibrary } from "../../../src/world/kit/materials";
import type { Manifest } from "../../../src/shared/contracts";
import fallback from "../../../src/world/data/manifest.fallback.json";
import { resolveCircle } from "../../../src/world/player/Collision";
const empty = (): Manifest => ({...structuredClone(fallback) as Manifest, buildings:[]});
describe("original urban perimeter architecture", () => {
  it("makes dense deterministic street walls, mixed silhouettes and stays inside render budgets", () => {
    const materials=new MaterialLibrary();
    const a=buildUrbanBlocks(materials,empty(),()=>0);
    const stats=a.group.userData.urbanBlocks;
    console.log("Urban render budget",{buildings:stats.buildings.length,drawCalls:stats.drawCalls,triangles:stats.triangles});
    expect(stats.buildings.length).toBeGreaterThan(300);
    expect(stats.drawCalls).toBeLessThanOrEqual(30);
    expect(stats.triangles).toBeLessThanOrEqual(260000);
    expect(new Set(stats.buildings.map((b:any)=>b.style)).size).toBe(3);
    expect(stats.buildings.some((b:any)=>b.height>45)).toBe(true);
    for (const b of stats.buildings) {
      expect(b.blockX===36 && b.blockZ===36).toBe(false);
      expect(Math.abs(b.x-b.blockX)===20 || Math.abs(b.z-b.blockZ)===20).toBe(true);
    }
    const b=buildUrbanBlocks(materials,empty(),()=>0);
    expect(b.group.userData.urbanBlocks.buildings).toEqual(stats.buildings);
    a.dispose();b.dispose();materials.dispose();
  });
  it.each([0,1,2026,4294967295])("keeps the complete 420-building city within the budget at seed %s", seed=>{
    const manifest=empty(); manifest.seed=seed;
    const materials=new MaterialLibrary(), built=buildUrbanBlocks(materials,manifest,()=>0);
    const stats=built.group.userData.urbanBlocks;
    console.log("Urban multi-seed budget",{seed,buildings:stats.buildings.length,batches:stats.drawCalls,triangles:stats.triangles});
    expect(stats.buildings).toHaveLength(420);
    expect(stats.drawCalls).toBeLessThanOrEqual(30);
    expect(stats.triangles).toBeLessThanOrEqual(260000);
    built.dispose();materials.dispose();
  });
  it("uses physical metre-scaled masonry UVs and inherits shared loaded PBR maps",()=>{
    const materials=new MaterialLibrary();
    const keys=["stucco","plaster_warm","brick"] as const;
    keys.forEach((key,i)=>{ materials.get(key);materials.tileMeters.set(key,1.25+i*.75); });
    const built=buildUrbanBlocks(materials,empty(),()=>0);
    const walls=(built.group.children as THREE.Mesh[]).filter(m=>m.material instanceof THREE.MeshStandardMaterial && m.material.name.startsWith("Urban / ") && keys.some(key=>m.material instanceof THREE.Material && m.material.name.includes(key)));
    expect(walls).toHaveLength(8);
    for(const mesh of walls) {
      const material=mesh.material as THREE.MeshStandardMaterial;
      const key=keys.find(k=>material.name.includes(k))!, shared=materials.get(key), tile=materials.tileMeters.get(key)!;
      expect(material).not.toBe(shared);
      expect(material.map).toBe(shared.map);expect(material.normalMap).toBe(shared.normalMap);expect(material.roughnessMap).toBe(shared.roughnessMap);
      const position=mesh.geometry.getAttribute("position"),uv=mesh.geometry.getAttribute("uv");
      // First box in each palette batch is the 12m-wide full-height building shell.
      for(let face=0;face<6;face++) {
        const coords=Array.from({length:4},(_,i)=>face*4+i);
        const span=(axis:"X"|"Y"|"Z")=>Math.max(...coords.map(i=>position[axis==="X"?"getX":axis==="Y"?"getY":"getZ"](i)))-Math.min(...coords.map(i=>position[axis==="X"?"getX":axis==="Y"?"getY":"getZ"](i)));
        const us=coords.map(i=>uv.getX(i)),vs=coords.map(i=>uv.getY(i));
        expect(Math.max(...us)-Math.min(...us)).toBeCloseTo((face<2?span("Z"):span("X"))/tile,4);
        expect(Math.max(...vs)-Math.min(...vs)).toBeCloseTo((face===2||face===3?span("Z"):span("Y"))/tile,4);
      }
      expect(Math.max(...Array.from({length:24},(_,i)=>uv.getY(i)))).toBeGreaterThan(3);
    }
    built.dispose();materials.dispose();
  });
  it("varies facade proportions and businesses without covering every shop in awnings",()=>{
    const materials=new MaterialLibrary(),built=buildUrbanBlocks(materials,empty(),()=>0),stats=built.group.userData.urbanBlocks;
    expect(new Set(stats.facades.map((f:any)=>f.columns))).toEqual(new Set([2,3,4]));
    const street=stats.facades.filter((f:any)=>f.streetFacing),back=stats.facades.filter((f:any)=>!f.streetFacing);
    expect(street.length).toBe(560); expect(back.every((f:any)=>!f.awning&&f.business===null)).toBe(true);
    expect(new Set(street.map((f:any)=>f.business)).size).toBe(8);
    expect(street.filter((f:any)=>f.awning).length/street.length).toBeLessThan(.5);
    const mesh=(built.group.children as THREE.Mesh[]).find(m=>(m.material as THREE.Material).name==="Urban / recessed facade glazing")!;
    const material=mesh.material as THREE.MeshStandardMaterial, uv=mesh.geometry.getAttribute("uv"),atlas=material.map as THREE.DataTexture;
    expect(material.emissiveIntensity).toBe(1);expect(material.emissive.getHex()).toBe(0);
    for(let i=0;i<uv.count;i++) {expect(uv.getX(i)).toBeGreaterThanOrEqual(0);expect(uv.getX(i)).toBeLessThanOrEqual(1);expect(uv.getY(i)).toBeGreaterThanOrEqual(0);expect(uv.getY(i)).toBeLessThanOrEqual(1);}
    // The first original 64px glazing tile still has its atlas inset, never metre-scaled UVs.
    expect(uv.getX(1)-uv.getX(0)).toBeCloseTo(62/512);
    expect(uv.getY(2)-uv.getY(1)).toBeCloseTo(62/512);
    const data=atlas.image.data as Uint8Array;
    for(let y=7;y<58;y++)for(let x=7;x<57;x++) {
      const i=(y*512+x)*4;
      expect(data[i]>180&&data[i+1]>160&&data[i+2]<120).toBe(false);
    }
    // Tiny lettering is in the same shared atlas, authored in Node without document/canvas.
    const lettering=new Set<string>();for(let y=256;y<320;y++)for(let x=0;x<512;x++){const i=(y*512+x)*4;lettering.add(data[i]+","+data[i+1]+","+data[i+2]);}
    expect(lettering.has("219,210,187")).toBe(true);
    built.dispose();materials.dispose();
  });
  it("keeps entire plaza and every street lane clear",()=>{
    const materials=new MaterialLibrary(), built=buildUrbanBlocks(materials,empty(),()=>0);
    for(let x=10;x<=62;x+=2) for(let z=10;z<=62;z+=2) expect(resolveCircle(x,z,.5,built.colliders).hit).toBe(false);
    for(const street of [-216,-144,-72,0,72,144,216]) for(let k=-215;k<=215;k+=3) {
      expect(resolveCircle(street,k,6.9,built.colliders).hit).toBe(false);
      expect(resolveCircle(k,street,6.9,built.colliders).hit).toBe(false);
    }
    built.dispose();materials.dispose();
  });
  it.each([0, Math.PI/2, Math.PI, -Math.PI/2, Math.PI/4])("preserves rotated department footprint and +Z approach at %s", rotation=>{
    const manifest=empty(); manifest.buildings=[{...(fallback as Manifest).buildings[0],plot_center:[-108,36],rotation_y:rotation}];
    const materials=new MaterialLibrary(), built=buildUrbanBlocks(materials,manifest,()=>0);
    const c=Math.cos(rotation),s=Math.sin(rotation);
    for(let u=-13;u<=13;u+=2) for(let v=-13;v<=13;v+=2) expect(resolveCircle(-108+c*u+s*v,36-s*u+c*v,.3,built.colliders).hit).toBe(false);
    for(let v=14;v<=40;v++) for(const u of [-4,0,4]) expect(resolveCircle(-108+c*u+s*v,36-s*u+c*v,.3,built.colliders).hit).toBe(false);
    for(const b of built.group.userData.urbanBlocks.buildings.filter((b:any)=>b.blockX===-108&&b.blockZ===36)) {
      expect(Math.abs(b.x+108)).toBe(20); expect(Math.abs(b.z-36)).toBe(20);
    }
    built.dispose();materials.dispose();
  });
  it("keeps rendered facade projections out of road lanes and the central plaza",()=>{
    const materials=new MaterialLibrary(), built=buildUrbanBlocks(materials,empty(),()=>0);
    const streets=[-216,-144,-72,0,72,144,216];
    let nearestRoad=Infinity,plazaIntrusions=0,triangles=0;
    for(const mesh of built.group.children as THREE.Mesh[]) {
      const p=mesh.geometry.getAttribute("position");triangles+=mesh.geometry.index!.count/3;
      for(let i=0;i<p.count;i++) {
        const x=p.getX(i),z=p.getZ(i);
        for(const street of streets) nearestRoad=Math.min(nearestRoad,Math.abs(x-street),Math.abs(z-street));
        if(x>=10&&x<=62&&z>=10&&z<=62) plazaIntrusions++;
      }
    }
    expect(nearestRoad).toBeGreaterThan(9);expect(plazaIntrusions).toBe(0);
    expect(triangles).toBe(built.group.userData.urbanBlocks.triangles);
    built.dispose();materials.dispose();
  });
  it("samples terrain corners and closes sloped foundations",()=>{
    const materials=new MaterialLibrary(), built=buildUrbanBlocks(materials,empty(),(x,z)=>-x*.12+z*.025);
    for(const b of built.group.userData.urbanBlocks.buildings) {
      expect(b.base).toBeCloseTo(-b.x*.12+b.z*.025+.87);
      expect(b.bottom).toBeCloseTo(-b.x*.12+b.z*.025-.87-.5);
    }
    built.dispose();materials.dispose();
  });
  it("owns only its resources, disposes once and keeps quality topology stable",()=>{
    const materials=new MaterialLibrary(), shared=materials.get("trim"), spy=vi.spyOn(shared,"dispose");
    const built=buildUrbanBlocks(materials,empty(),()=>0), count=built.colliders.length;
    const meshes=built.group.children as THREE.Mesh[], disposals=meshes.map(m=>vi.spyOn(m.geometry,"dispose"));
    built.setQuality("low");expect(meshes.every(m=>!m.castShadow)).toBe(true);expect(built.colliders.length).toBe(count);
    built.setQuality("high");expect(meshes.every(m=>m.castShadow)).toBe(true);
    built.dispose();built.dispose(); expect(built.group.children).toHaveLength(0); expect(spy).not.toHaveBeenCalled();
    disposals.forEach(s=>expect(s).toHaveBeenCalledTimes(1)); materials.dispose();
  });
});
