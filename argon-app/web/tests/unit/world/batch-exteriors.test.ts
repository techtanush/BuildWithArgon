import {afterEach,describe,it,expect,vi} from "vitest";
import * as THREE from "three";
import {batchExteriors} from "../../../src/world/city/batchExteriors";
import {MaterialLibrary} from "../../../src/world/kit/materials";
import {buildBuilding} from "../../../src/world/buildings";
import fallback from "../../../src/world/data/manifest.fallback.json";
const mesh=(root:THREE.Group,material:THREE.Material,geometry:THREE.BufferGeometry=new THREE.BoxGeometry())=>{const m=new THREE.Mesh(geometry,material);root.add(m);return m;};
const visible=(roots:THREE.Object3D[])=>{let n=0;roots.forEach(g=>g.traverseVisible(o=>{if(o instanceof THREE.Mesh)n++;}));return n;};
afterEach(()=>vi.unstubAllGlobals());
describe("cross-department static exterior batch",()=>{
  it("merges different libraries in world space with nested rotations and restores originals",()=>{
    const common=new MaterialLibrary(),a=new MaterialLibrary(),b=new MaterialLibrary(),r1=new THREE.Group(),r2=new THREE.Group(),nested=new THREE.Group();
    r1.position.set(50,4,-20);r1.rotation.y=.4;r2.position.set(-30,8,60);nested.position.set(2,3,4);nested.rotation.x=.6;r2.add(nested);
    const x=mesh(r1,a.get("trim")),y=mesh(nested,b.get("trim"));const originalX=x.geometry.getAttribute("position").array.slice();r1.updateMatrixWorld(true);r2.updateMatrixWorld(true);
    const expected=new THREE.Box3().setFromObject(r1).union(new THREE.Box3().setFromObject(r2));
    const result=batchExteriors([r1,r2],common),merged=result.group.children[0] as THREE.Mesh,bounds=new THREE.Box3().setFromObject(result.group);
    expect(result.group.children).toHaveLength(1);expect(merged.material).toBe(common.get("trim"));expect(bounds.min.distanceTo(expected.min)).toBeLessThan(1e-5);expect(bounds.max.distanceTo(expected.max)).toBeLessThan(1e-5);expect(x.parent).toBe(r1);expect(x.visible).toBe(false);expect(y.visible).toBe(false);expect(x.geometry.getAttribute("position").array).toEqual(originalX);
    const sourceDispose=vi.spyOn(x.geometry,"dispose"),originalMaterialDispose=vi.spyOn(a.get("trim"),"dispose"),commonDispose=vi.spyOn(common.get("trim"),"dispose"),mergedDispose=vi.spyOn(merged.geometry,"dispose");
    result.dispose();result.dispose();expect(mergedDispose).toHaveBeenCalledTimes(1);expect(sourceDispose).not.toHaveBeenCalled();expect(originalMaterialDispose).not.toHaveBeenCalled();expect(commonDispose).not.toHaveBeenCalled();expect(x.visible&&y.visible).toBe(true);
    a.dispose();b.dispose();common.dispose();
  });
  it("keeps distinct accent colors and retains their original materials",()=>{
    const common=new MaterialLibrary(),root=new THREE.Group(),red=new MaterialLibrary({accent:"#ff3322",accentDark:"#662211"}),blue=new MaterialLibrary({accent:"#2244ff",accentDark:"#112266"});
    for(let i=0;i<2;i++){mesh(root,red.get("accent"));mesh(root,blue.get("accent"));}
    const result=batchExteriors([root],common);expect(result.group.children).toHaveLength(2);expect(result.group.children.map(o=>(o as THREE.Mesh).material)).toEqual([red.get("accent"),blue.get("accent")]);result.dispose();red.dispose();blue.dispose();common.dispose();
  });
  it("converts only exterior glass into one owned opaque non-shadow material",()=>{
    const common=new MaterialLibrary(),root=new THREE.Group(),a=mesh(root,common.get("glass")),b=mesh(root,common.get("glass"));a.castShadow=b.receiveShadow=true;
    const interior=new THREE.Group(),inside=mesh(interior,common.get("glass"));const result=batchExteriors([root],common),m=result.group.children[0] as THREE.Mesh,material=m.material as THREE.MeshStandardMaterial;
    expect(result.group.children).toHaveLength(1);expect(material.color.getHexString()).toBe("4d6972");expect(material.transparent).toBe(false);expect(material.roughness).toBe(.22);expect(material.metalness).toBe(.35);expect(m.castShadow||m.receiveShadow).toBe(false);expect((material as THREE.MeshPhysicalMaterial).transmission).toBeUndefined();expect(inside.visible).toBe(true);expect(common.get("glass").transparent).toBe(true);
    const disposed=vi.spyOn(material,"dispose");result.dispose();result.dispose();expect(disposed).toHaveBeenCalledTimes(1);common.dispose();
  });
  it("leaves signs, unique textures, transparent effects, hidden and animated objects alone",()=>{
    const common=new MaterialLibrary(),root=new THREE.Group(),unknown=new THREE.MeshStandardMaterial(),effect=common.get("trim").clone();effect.transparent=true;
    const a=mesh(root,unknown),b=mesh(root,effect),c=mesh(root,common.get("wood_dark"));c.userData.ownedTexture=new THREE.Texture();
    const dynamic=new THREE.Group();dynamic.userData.animated=true;root.add(dynamic);const d=mesh(dynamic,common.get("trim"));const inst=new THREE.InstancedMesh(new THREE.BoxGeometry(),common.get("trim"),2);root.add(inst);const skin=new THREE.SkinnedMesh(new THREE.BoxGeometry(),common.get("trim"));root.add(skin);const h=mesh(root,common.get("trim"));h.visible=false;
    const result=batchExteriors([root],common);expect(result.group.children).toHaveLength(0);for(const o of [a,b,c,d,inst,skin])expect(o.visible).toBe(true);result.dispose();expect(h.visible).toBe(false);common.dispose();
  });
  it("separates incompatible attributes and shadow settings",()=>{
    const common=new MaterialLibrary(),root=new THREE.Group();for(let i=0;i<2;i++){mesh(root,common.get("trim"));const noUv=new THREE.BoxGeometry();noUv.deleteAttribute("uv");mesh(root,common.get("trim"),noUv);mesh(root,common.get("trim")).castShadow=true;}
    const result=batchExteriors([root],common);expect(result.group.children).toHaveLength(3);result.dispose();common.dispose();
  });
  it("repairs reflected winding without changing source geometry",()=>{
    const common=new MaterialLibrary(),root=new THREE.Group();const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));g.setIndex([0,1,2]);g.computeVertexNormals();const a=mesh(root,common.get("trim"),g),b=mesh(root,common.get("trim"),g);a.scale.x=-1;b.position.x=3;const result=batchExteriors([root],common),p=(result.group.children[0] as THREE.Mesh).geometry.getAttribute("position"),pts=[0,1,2].map(i=>new THREE.Vector3().fromBufferAttribute(p,i));expect(pts[1].sub(pts[0]).cross(pts[2].sub(pts[0])).z).toBeGreaterThan(0);expect(g.index!.array).toEqual(new Uint16Array([0,1,2]));result.dispose();common.dispose();
  });
  const buildDepartmentExteriors=(source:"fallback"|"generated")=>{
    vi.stubGlobal("navigator",{userAgent:"urban-batch-test"});vi.stubGlobal("document",{createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},strokeRect(){},fillText(){}})})});
    const common=new MaterialLibrary(),libraries=fallback.buildings.map(b=>new MaterialLibrary({accent:b.color,accentDark:new THREE.Color(b.color).multiplyScalar(.55).getStyle()}));
    const builds=fallback.buildings.map((b,i)=>{const build=buildBuilding(b.department_id,"exterior",{materials:libraries[i],source});build.group.position.set(b.plot_center[0],0,b.plot_center[1]);build.group.rotation.y=b.rotation_y;build.group.updateMatrixWorld(true);return build;});
    const roots=builds.map(b=>b.group),signs:THREE.Mesh[]=[];let glassSources=0;
    roots.forEach(g=>g.traverse(o=>{if(o instanceof THREE.Mesh){const material=o.material as THREE.MeshStandardMaterial;if(material.map instanceof THREE.CanvasTexture)signs.push(o);if(material.name==="glass")glassSources++;}}));
    return {common,libraries,builds,roots,signs,glassSources};
  };
  it("reduces fallback 13-department exteriors while preserving canvas signs and original owners",()=>{
    const fixture=buildDepartmentExteriors("fallback"),before=visible(fixture.roots),result=batchExteriors(fixture.roots,fixture.common),stats=result.group.userData.stats;console.log("Fallback cross-department exterior draw inventory",JSON.stringify(stats));
    expect(fixture.glassSources).toBe(59);expect(fixture.signs).toHaveLength(13);expect(fixture.signs.every(s=>s.visible)).toBe(true);expect(stats.before).toBe(before);expect(stats.after).toBe(visible([...fixture.roots,result.group]));expect(stats.after).toBeLessThan(90);expect(stats.after).toBeLessThan(before*.4);expect(stats.glassSources).toBe(59);
    result.dispose();expect(visible(fixture.roots)).toBe(before);fixture.builds.forEach(b=>b.dispose());fixture.libraries.forEach(l=>l.dispose());fixture.common.dispose();
  });
  it("batches generated 13-department exteriors without taking sign or source ownership",()=>{
    const fixture=buildDepartmentExteriors("generated"),before=visible(fixture.roots),signMaterials=fixture.signs.map(s=>s.material),signTextures=fixture.signs.map(s=>(s.material as THREE.MeshStandardMaterial).map),signDisposes=signTextures.map(texture=>vi.spyOn(texture!,"dispose")),result=batchExteriors(fixture.roots,fixture.common),stats=result.group.userData.stats;
    expect(fixture.glassSources).toBeGreaterThan(0);expect(fixture.signs).toHaveLength(13);expect(fixture.signs.every(s=>s.visible)).toBe(true);expect(fixture.signs.map(s=>s.material)).toEqual(signMaterials);expect(fixture.signs.map(s=>(s.material as THREE.MeshStandardMaterial).map)).toEqual(signTextures);expect(stats.glassSources).toBe(fixture.glassSources);expect(stats.after).toBe(visible([...fixture.roots,result.group]));
    result.dispose();expect(visible(fixture.roots)).toBe(before);expect(fixture.signs.every((s,i)=>s.material===signMaterials[i]&&(s.material as THREE.MeshStandardMaterial).map===signTextures[i])).toBe(true);expect(signDisposes.every(dispose=>dispose.mock.calls.length===0)).toBe(true);fixture.builds.forEach(b=>b.dispose());fixture.libraries.forEach(l=>l.dispose());fixture.common.dispose();
  });
});
