import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MATERIAL_COLORS, type MaterialLibrary, type SurfaceKey } from "../kit/materials";

export interface ExteriorBatch {
  /** World-space vertices: attach beneath an identity world/City group. */
  group: THREE.Group;
  /** Call BEFORE original building disposal. Restores visibility; never owns source resources. */
  dispose(): void;
}
interface Bucket { sources: THREE.Mesh[]; material: THREE.Material; cast: boolean; receive: boolean }

/**
 * Caller certifies these roots are STATIC EXTERIORS, never interiors or animated characters.
 * Roots must not move after batching. World transforms (including nested nodes) are baked.
 * Known library surfaces share the supplied library; department accents retain their source
 * material per exact color. Glass alone is intentionally replaced with opaque blue-green panes.
 * Unknown/custom signs, owned textures, transparent effects, morphs, instances and dynamic
 * subtrees remain untouched. Originals stay attached but hidden for their owner's disposal.
 */
export function batchExteriors(roots: THREE.Group[], materials: MaterialLibrary): ExteriorBatch {
  const group = new THREE.Group(); group.name = "Batched static department exteriors";
  const glass = new THREE.MeshStandardMaterial({color:"#4d6972",roughness:.22,metalness:.35});
  glass.name = "Exterior opaque blue-green panes";
  const buckets = new Map<string,Bucket>(), accentMaterials = new Map<string,THREE.Material>();
  const visited = new Set<THREE.Object3D>(), hidden: THREE.Mesh[] = [], ownedGeometry: THREE.BufferGeometry[] = [];
  let before = 0, glassSources = 0;
  const proto = THREE.Mesh.prototype;
  const attributesKey = (g:THREE.BufferGeometry):string|null => {
    const p=g.getAttribute("position");
    if (!p || Object.keys(g.morphAttributes).length) return null;
    const count=g.index?.count??p.count;
    if (count<3 || count%3 || g.drawRange.start!==0 || g.drawRange.count<count) return null;
    const attrs=Object.entries(g.attributes) as Array<[string,THREE.BufferAttribute|THREE.InterleavedBufferAttribute]>;
    if(attrs.some(([,a])=> a instanceof THREE.InterleavedBufferAttribute || (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute || (a as THREE.BufferAttribute).usage!==THREE.StaticDrawUsage || a.count!==p.count)) return null;
    return attrs.sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}:${(a as THREE.BufferAttribute).gpuType}`).join("|");
  };
  function walk(object:THREE.Object3D, protectedTree=false) {
    if(visited.has(object)) return; visited.add(object);
    if(!object.visible) return;
    const data=object.userData;
    const protectedHere=protectedTree || !!data.ownedTexture || data.batchExteriors===false || data.dynamic===true || data.animated===true || data.static===false || object.animations.length>0 || object instanceof THREE.LOD;
    if(object instanceof THREE.Mesh) {
      before++;
      const material=object.material;
      const safe=!protectedHere && !(object instanceof THREE.SkinnedMesh) && !(object instanceof THREE.InstancedMesh) && !(object as THREE.Mesh & {isBatchedMesh?:boolean}).isBatchedMesh && object.children.length===0 &&
        !Array.isArray(material) && !(material instanceof THREE.ShaderMaterial) && material.visible &&
        object.onBeforeRender===proto.onBeforeRender && object.onAfterRender===proto.onAfterRender &&
        object.onBeforeShadow===proto.onBeforeShadow && object.onAfterShadow===proto.onAfterShadow &&
        !object.customDepthMaterial && !object.customDistanceMaterial && Math.abs(object.matrixWorld.determinant())>1e-12;
      if(safe && !Array.isArray(material)) {
        const key=material.name as SurfaceKey, isGlass=key==="glass";
        const ownedMap=(material as THREE.MeshStandardMaterial).map instanceof THREE.CanvasTexture;
        const attributes=attributesKey(object.geometry);
        if(attributes!==null && !ownedMap && Object.prototype.hasOwnProperty.call(MATERIAL_COLORS,key) && (isGlass || (!material.transparent && !((material as THREE.MeshPhysicalMaterial).transmission>0)))) {
          let target:THREE.Material, materialKey:string;
          if(isGlass) { target=glass; materialKey="exterior-glass"; }
          else if(key==="accent" || key==="accent_dark") {
            const color=(material as THREE.MeshStandardMaterial).color;
            if(!color) return;
            materialKey=`${key}:${color.toArray().join(",")}`;
            target=accentMaterials.get(materialKey)??material;accentMaterials.set(materialKey,target);
          } else { target=materials.get(key); materialKey=key; }
          // Canonical library may have been configured transparent; do not accidentally re-order it.
          if(!target.transparent) {
            const cast=isGlass?false:object.castShadow,receive=isGlass?false:object.receiveShadow;
            const bucketKey=[materialKey,cast,receive,object.layers.mask,object.renderOrder,object.frustumCulled,attributes].join("/");
            const bucket=buckets.get(bucketKey)??{sources:[],material:target,cast,receive};
            bucket.sources.push(object);buckets.set(bucketKey,bucket);
          }
        }
      }
    }
    const childProtection=protectedHere || object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh || (object instanceof THREE.Group && object.renderOrder!==0);
    for(const child of object.children) walk(child,childProtection);
  }
  for(const root of roots) { root.updateWorldMatrix(true,true); walk(root); }
  for(const bucket of buckets.values()) {
    // A singleton opaque object saves no draws. A singleton pane still removes transmission.
    if(bucket.sources.length<2 && bucket.material!==glass) continue;
    const copies:THREE.BufferGeometry[]=[];
    let merged:THREE.BufferGeometry|null=null;
    try {
      for(const source of bucket.sources) {
        const copy=source.geometry.index?source.geometry.toNonIndexed():source.geometry.clone();copies.push(copy);
        copy.applyMatrix4(source.matrixWorld);
        if(source.matrixWorld.determinant()<0) {
          // Baking a reflection removes GL's object-level winding flip. Preserve front faces.
          for(const value of Object.values(copy.attributes)) {
            const attr=value as THREE.BufferAttribute;
            for(let i=0;i<attr.count;i+=3) for(let c=0;c<attr.itemSize;c++) {
              const a=(i+1)*attr.itemSize+c,b=(i+2)*attr.itemSize+c,v=attr.array[a];attr.array[a]=attr.array[b];attr.array[b]=v;
            }
          }
          const tangent=copy.getAttribute("tangent");if(tangent)for(let i=0;i<tangent.count;i++)tangent.setW(i,-tangent.getW(i));
        }
      }
      merged=mergeGeometries(copies,false);
    } catch { merged?.dispose();merged=null; }
    finally { copies.forEach(g=>g.dispose()); }
    if(!merged) continue;
    merged.computeBoundingBox();merged.computeBoundingSphere();ownedGeometry.push(merged);
    const first=bucket.sources[0],mesh=new THREE.Mesh(merged,bucket.material);
    mesh.name=`Department surface / ${bucket.material.name} (${bucket.sources.length})`;
    mesh.castShadow=bucket.cast;mesh.receiveShadow=bucket.receive;
    mesh.layers.mask=first.layers.mask;mesh.renderOrder=first.renderOrder;mesh.frustumCulled=first.frustumCulled;
    group.add(mesh);
    for(const source of bucket.sources) {source.visible=false;hidden.push(source);}
    if(bucket.material===glass)glassSources+=bucket.sources.length;
  }
  group.userData.stats={before,after:before-hidden.length+group.children.length,batchedSources:hidden.length,batches:group.children.length,glassSources};
  let disposed=false;
  return {group,dispose(){
    if(disposed)return;disposed=true;
    group.removeFromParent();group.clear();
    ownedGeometry.forEach(g=>g.dispose());glass.dispose();
    hidden.forEach(mesh=>{mesh.visible=true;});
    ownedGeometry.length=0;hidden.length=0;
  }};
}
