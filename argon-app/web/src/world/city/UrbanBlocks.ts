/** Original procedural street-wall architecture. No assets, global state or shared-resource ownership. */
import * as THREE from "three";
import type { Manifest } from "../../shared/contracts";
import type { MaterialLibrary } from "../kit/materials";
import type { Collider } from "../player/Collision";

export interface UrbanBlocks {
  group: THREE.Group;
  colliders: Collider[];
  dispose(): void;
  setQuality(tier: string): void;
}
type OBB = Extract<Collider, { kind: "obb" }>;
type Batch = { p: number[]; n: number[]; uv: number[]; indices: number[] };
const CENTERS = [-180, -108, -36, 36, 108, 180];
// Pale sandstone, lime plaster and warm masonry, not eight painted copies of one surface.
const PALETTE = ["#d4c7af", "#e2d7c1", "#b2b7a6", "#b79580", "#c6a38e", "#bdb8a6", "#ddd4bf", "#aab7b8"];
const WALL_KEYS = ["stucco", "plaster_warm", "stucco", "brick", "brick", "plaster_warm", "stucco", "plaster_warm"] as const;
const BUSINESS_NAMES = ["JUNIPER CAFE", "NORTH BOOKS", "COMMON GOODS", "ATELIER", "BLOOM", "CORNER DELI", "FIELD BAKERY", "STUDIO"];
// Original tiny bitmap lettering: no canvas, browser dependency, network font or per-letter geometry.
const GLYPHS: Record<string,string> = {
 A:"01110/10001/10001/11111/10001/10001/10001", B:"11110/10001/10001/11110/10001/10001/11110",
 C:"01111/10000/10000/10000/10000/10000/01111", D:"11110/10001/10001/10001/10001/10001/11110",
 E:"11111/10000/10000/11110/10000/10000/11111", F:"11111/10000/10000/11110/10000/10000/10000",
 G:"01111/10000/10000/10111/10001/10001/01111", H:"10001/10001/10001/11111/10001/10001/10001",
 I:"11111/00100/00100/00100/00100/00100/11111", J:"00111/00010/00010/00010/10010/10010/01100",
 K:"10001/10010/10100/11000/10100/10010/10001", L:"10000/10000/10000/10000/10000/10000/11111",
 M:"10001/11011/10101/10101/10001/10001/10001", N:"10001/11001/10101/10011/10001/10001/10001",
 O:"01110/10001/10001/10001/10001/10001/01110", P:"11110/10001/10001/11110/10000/10000/10000",
 R:"11110/10001/10001/11110/10100/10010/10001", S:"01111/10000/10000/01110/00001/00001/11110",
 T:"11111/00100/00100/00100/00100/00100/00100", U:"10001/10001/10001/10001/10001/10001/01110",
 Y:"10001/10001/01010/00100/00100/00100/00100",
};
const hash = (x: number, z: number, seed: number) => {
  let h = Math.imul(Math.round(x * 100) ^ seed, 374761393) ^ Math.imul(Math.round(z * 100), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};
/** SAT uses the same local +Z convention as the player and department meshes. */
function overlaps(a: OBB, b: OBB): boolean {
  const axes = (r: number) => [[Math.cos(r), -Math.sin(r)], [Math.sin(r), Math.cos(r)]];
  const aa = axes(a.rotY), bb = axes(b.rotY);
  for (const [x, z] of [...aa, ...bb]) {
    const ra = Math.abs(x * aa[0][0] + z * aa[0][1]) * a.hw + Math.abs(x * aa[1][0] + z * aa[1][1]) * a.hd;
    const rb = Math.abs(x * bb[0][0] + z * bb[0][1]) * b.hw + Math.abs(x * bb[1][0] + z * bb[1][1]) * b.hd;
    if (Math.abs((a.x - b.x) * x + (a.z - b.z) * z) >= ra + rb - 1e-5) return false;
  }
  return true;
}

/** Daylight glazing, independently varied blinds, shop interiors and small business lettering.
 * All authored in one deterministic atlas, also usable without a DOM in headless tests. */
function facadeAtlas(): THREE.DataTexture {
  const size = 512, tile = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const tx = Math.floor(x / tile), ty = Math.floor(y / tile), u = x % tile, v = y % tile;
    const inner = u > 6 && u < 57 && v > 5 && v < 58;
    let c = [213, 202, 181];
    if (inner) {
      const occupied = ty === 0 && tx === 5;
      const shine = (u + v * 0.36) % 48 < 14;
      c = occupied ? [87 + v * .23, 79 + v * .23, 65 + v * .23] : [34 + v * .31, 48 + v * .37, 54 + v * .42];
      // Lower shop glazing has dark interior shelves and reflected sky, not luminous panels.
      if (ty === 2 || ty === 3) {
        c = [25 + v * .32, 36 + v * .4, 38 + v * .44];
        if (v < 27 && (v % 11 < 2 || (u + tx * 5) % 17 < 4)) c = [49, 46, 37];
      }
      if (shine) c = c.map(n => n + 14);
      if (ty < 2 && ((tx % 3 === 1 && u < 16) || (tx % 3 === 2 && v > 42))) c = [140 + tx * 3, 137 + tx * 2, 122 + tx * 2];
      if (u === 31 || u === 32 || (ty !== 1 && v >= 31 && v <= 33) || (ty === 2 && v >= 44 && v <= 46)) c = [190, 186, 167];
      if (u < 10 || v > 54) c = c.map(n => n * .64);
    }
    if (!inner && (u < 3 || v < 3 || u > 60 || v > 60)) c = [110, 103, 91];
    const i = (y * size + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  // Signs occupy otherwise unused atlas rows; stored bottom-up like the glazing UVs.
  BUSINESS_NAMES.forEach((name, index) => {
    const left = (index % 4) * 128, bottom = 256 + Math.floor(index / 4) * 32;
    const bg = index % 3 === 0 ? [42,57,51] : index % 3 === 1 ? [51,60,66] : [78,57,45];
    for (let y=0;y<32;y++) for(let x=0;x<128;x++) data.set([...bg,255], ((bottom+y)*size+left+x)*4);
    const start = left + Math.floor((128 - name.length * 6 + 1) / 2);
    [...name].forEach((letter, n) => {
      const rows = GLYPHS[letter]?.split("/");
      rows?.forEach((row,y) => [...row].forEach((bit,x) => {
        // Fascias are much wider than the atlas cell: 3px-tall strokes restore
        // ordinary letter proportions after mapping to a 5.65m x .43m sign.
        if(bit === "1") for(let dy=0;dy<3;dy++) data.set([219,210,187,255], ((bottom+25-y*3-dy)*size+start+n*6+x)*4);
      }));
    });
  });
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
  texture.name = "Urban / original daylight-sash-shopfront-lettering atlas";
  return texture;
}

export function buildUrbanBlocks(materials: MaterialLibrary, manifest: Manifest, heightAt: (x: number, z: number) => number): UrbanBlocks {
  const group = new THREE.Group(); group.name = "Urban street walls / San Foundry";
  const colliders: Collider[] = [], owned: THREE.Material[] = [], meshes: THREE.Mesh[] = [];
  const atlas = facadeAtlas();
  const meters = new Map<THREE.Material, number>();
  const walls = PALETTE.map((color, index) => {
    const key = WALL_KEYS[index], source = materials.get(key), m = source.clone();
    // Clone only the material: loaded PBR maps remain shared with the library.
    m.color.set(color); m.name = `Urban / ${key} / ${color}`;
    meters.set(m, materials.tileMeters.get(key) || 2); owned.push(m); return m;
  });
  const windows = new THREE.MeshStandardMaterial({ map: atlas, roughness: .38, metalness: .16 });
  windows.name = "Urban / recessed facade glazing"; owned.push(windows);
  const trim = materials.get("trim"), roof = materials.get("roof"), metal = materials.get("metal_dark"), stone = materials.get("sidewalk");
  const awnings = ["#697a69", "#a2604d", "#526b7a", "#b69862"].map(color => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: .92 }); owned.push(m); return m;
  });
  for (const [m,key] of [[trim,"trim"],[roof,"roof"],[metal,"metal_dark"],[stone,"sidewalk"]] as const) meters.set(m, materials.tileMeters.get(key) || 2);
  const batches = new Map<THREE.Material, Batch>();
  const getBatch = (m: THREE.Material) => {
    let b = batches.get(m);
    if (!b) { b = { p: [], n: [], uv: [], indices: [] }; batches.set(m, b); }
    return b;
  };
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const bp = boxGeometry.getAttribute("position"), bn = boxGeometry.getAttribute("normal"), buv = boxGeometry.getAttribute("uv"), bi = boxGeometry.index!;
  function box(m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, rotation = 0, facadeDetail = false, revealSide = 0) {
    const b = getBatch(m), offset = b.p.length / 3, co = Math.cos(rotation), si = Math.sin(rotation);
    for (let i = 0; i < bp.count; i++) {
      const xx = bp.getX(i) * w, zz = bp.getZ(i) * d;
      b.p.push(x + co * xx + si * zz, y + bp.getY(i) * h, z - si * xx + co * zz);
      b.n.push(co * bn.getX(i) + si * bn.getZ(i), bn.getY(i), -si * bn.getX(i) + co * bn.getZ(i));
      // BoxGeometry's unit UVs stretched one image over a 60m wall. Scale each
      // face by its physical dimensions; preserve atlas UVs in pane() below.
      const tile = meters.get(m) || 2, nx = Math.abs(bn.getX(i)), ny = Math.abs(bn.getY(i));
      const spanU = nx > .5 ? d : w, spanV = ny > .5 ? d : h;
      b.uv.push(buv.getX(i) * spanU / tile, buv.getY(i) * spanV / tile);
    }
    // Relief uses its front and one exposed return: top of sill, inner jamb, or
    // underside of lintel. Buried faces are omitted without flattening the reveal.
    const returnStart = revealSide === 1 ? 0 : revealSide === -1 ? 6 : revealSide === 2 ? 18 : 12;
    for (let i = 0; i < bi.count; i++) {
      if (facadeDetail && !((i >= returnStart && i < returnStart+6) || (i >= 24 && i < 30))) continue;
      b.indices.push(offset + bi.getX(i));
    }
  }
  function pane(x: number, y: number, z: number, w: number, h: number, rot: number, column: number, row: number, sign = false) {
    const b = getBatch(windows), offset = b.p.length / 3, c = Math.cos(rot), s = Math.sin(rot);
    const u0 = (column * (sign ? 128 : 64) + 1) / 512, u1 = (column * (sign ? 128 : 64) + (sign ? 127 : 63)) / 512;
    const v0 = (sign ? 256 + row * 32 + 1 : row * 64 + 1) / 512, v1 = (sign ? 256 + row * 32 + 31 : row * 64 + 63) / 512;
    for (const [xx, yy] of [[-w/2, -h/2], [w/2, -h/2], [w/2, h/2], [-w/2, h/2]]) {
      b.p.push(x + xx * c, y + yy, z - xx * s); b.n.push(s, 0, c);
    }
    b.uv.push(u0,v0,u1,v0,u1,v1,u0,v1); b.indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  const reserves: OBB[] = [];
  for (const dept of manifest.buildings) {
    const [x,z] = dept.plot_center, r = dept.rotation_y;
    reserves.push({kind:"obb",x,z,hw:14,hd:14,rotY:r});
    // Door approach is 10m wide, and continues all the way through the perimeter to the street.
    reserves.push({kind:"obb",x:x+Math.sin(r)*28,z:z+Math.cos(r)*28,hw:5,hd:14,rotY:r});
  }
  const records: Array<{x:number;z:number;blockX:number;blockZ:number;base:number;bottom:number;height:number;style:string}> = [];
  const facades: Array<{x:number;z:number;face:number;columns:number;streetFacing:boolean;business:string|null;awning:boolean}> = [];
  for (const blockX of CENTERS) for (const blockZ of CENTERS) {
    if (blockX === 36 && blockZ === 36) continue;
    const department = manifest.buildings.some(b => Math.abs(b.plot_center[0]-blockX)<1 && Math.abs(b.plot_center[1]-blockZ)<1);
    // Department plots have four corners ONLY. Ordinary plots use nearly continuous perimeter rows.
    const steps = department ? [-20,20] : [-20,-20/3,20/3,20];
    for (const ox of steps) for (const oz of steps) {
      if (Math.abs(ox) !== 20 && Math.abs(oz) !== 20) continue;
      const x = blockX+ox, z = blockZ+oz;
      const collider: OBB = {kind:"obb", x,z,hw:6,hd:6,rotY:0};
      if (reserves.some(r => overlaps(collider,r))) continue;
      const seed = hash(x,z,manifest.seed), downtown = blockX >= 108 && blockZ <= -36;
      const tower = downtown && seed % 5 === 0;
      const hotel = !tower && seed % 5 === 1;
      const floors = tower ? 13 + seed % 6 : hotel ? 6 + seed % 3 : 3 + seed % 4;
      const height = 1.1 + floors * 3.25;
      const ground = [heightAt(x,z), ...[-6,6].flatMap(dx => [-6,6].map(dz => heightAt(x+dx,z+dz)))];
      if (ground.some(n => !Number.isFinite(n))) continue;
      const base = Math.max(...ground), bottom = Math.min(...ground)-.5;
      records.push({x,z,blockX,blockZ,base,bottom,height,style:tower?"office":hotel?"hotel":"rowhouse"});
      colliders.push(collider);
      const wall = walls[seed % walls.length], awning = awnings[seed % awnings.length];
      box(stone,x,(base+bottom)/2,z,12,base-bottom,12);
      box(wall,x,base+height/2,z,12,height,12);
      box(stone,x,base+.32,z,12.08,.64,12.08);
      box(trim,x,base+3.5,z,12.15,.24,12.15);
      // Layered cornice, recessed roof membrane, parapet and real rooftop equipment.
      box(trim,x,base+height-.15,z,12.4,.32,12.4);
      box(trim,x,base+height+.13,z,12.65,.18,12.65);
      box(roof,x,base+height+.26,z,11.7,.12,11.7);
      for (const side of [-1,1]) {
        box(wall,x+side*5.8,base+height+.6,z,.27,.8,11.8);
        box(wall,x,base+height+.6,z+side*5.8,11.8,.8,.27);
      }
      box(metal,x+2.8,base+height+.85,z-2.8,2.1,1.2,1.5);
      box(trim,x-3.7,base+height+.95,z-3.6,.8,1.6,.8);
      box(roof,x-3.7,base+height+1.8,z-3.6,1.1,.16,1.1);
      if (tower) { // A stepped crown, not an isolated monolithic extrusion.
        box(wall,x,base+height+1.6,z,8,2.6,8);
        box(trim,x,base+height+3,z,8.5,.25,8.5);
        for (const side of [-1,1]) box(metal,x+side*4.8,base+height/2,z,.22,height,12.16);
      }
      // All four elevations are finished: visible courtyards never reveal blank toy backs.
      for (let face=0; face<4; face++) {
        const r = face*Math.PI/2, c = Math.cos(r), s = Math.sin(r);
        const streetFacing = (face===0 && oz===20) || (face===1 && ox===20) || (face===2 && oz===-20) || (face===3 && ox===-20);
        const localBox = (m:THREE.Material,u:number,y:number,depth:number,w:number,h:number,d:number,revealSide=0) => { if (streetFacing) box(m,x+c*u+s*depth,base+y,z-s*u+c*depth,w,h,d,r,true,revealSide); };
        const localPane = (u:number,y:number,depth:number,w:number,h:number,col:number,row:number) => pane(x+c*u+s*depth,base+y,z-s*u+c*depth,w,h,r,col,row);
        const columns = tower ? 4 : seed % 3 === 0 ? 2 : 3;
        const spacing = columns === 2 ? 4.7 : columns === 4 ? 2.65 : 3.55;
        const windowW = tower ? 1.98 : columns === 2 ? 1.95 : 1.55 + (seed % 3) * .12;
        const windowH = tower ? 2.12 : 1.88 + (seed % 4) * .09;
        const groundFloor = 4.05, floorPitch = (height - groundFloor) / (floors - 1);
        const business = (seed + face * 3) % BUSINESS_NAMES.length;
        const hasAwning = streetFacing && [0,5,6].includes(business);
        facades.push({x,z,face,columns,streetFacing,business:streetFacing?BUSINESS_NAMES[business]:null,awning:hasAwning});
        for (let floor=1;floor<floors;floor++) {
          const y = groundFloor + (floor - .5) * floorPitch;
          for (let col=0;col<columns;col++) {
            const u=(col-(columns-1)/2)*spacing;
            // A restrained stack of projecting bays only on selected street elevations.
            const bay = streetFacing && !tower && floor<4 && columns===3 && col===1 && (seed+face)%3===0;
            if (bay) {
              localBox(wall,u,y,6.21,2.4,floorPitch-.12,.42);
              localBox(trim,u,y-floorPitch/2+.08,6.32,2.65,.16,.68);
              localBox(trim,u,y+floorPitch/2-.12,6.31,2.7,.14,.66);
            }
            const depth = bay ? 6.435 : 6.035;
            // Atlas selection is independently hashed, avoiding diagonal checkerboard rooms.
            const variant = hash(x+col*.13,z+floor*.17,seed ^ (face*119)) % 8;
            localPane(u,y,depth,windowW,windowH,variant,tower?1:0);
            if (streetFacing) {
              const front = bay ? 6.51 : 6.12;
              localBox(trim,u,y-windowH/2-.10,front,windowW+.3,.14,.3);
              // Real shadow-casting jambs and lintels at pedestrian-visible levels.
              if (floor<=2 || bay) {
                for (const side of [-1,1]) localBox(trim,u+side*(windowW/2+.065),y,front,.11,windowH+.14,.20,-side);
                localBox(trim,u,y+windowH/2+.065,front,windowW+.24,.11,.2,2);
              }
            }
          }
          if ((hotel && floor%2===0) || (!tower && seed%4===0 && floor===1)) localBox(trim,0,groundFloor+floor*floorPitch-.1,6.08,12,.12,.16);
        }
        // Glass sits behind a projecting stone surround. Two display bays flank a narrow
        // door rather than three identical window stickers; every added solid stays street-side.
        for (const u of [-3.55,3.55]) localPane(u,1.78,6.035,3.45,2.65,(seed+face+(u>0?3:0))%8,2);
        localPane(0,1.53,6.032,1.36,2.7,(seed+face)%8,3);
        for (const u of [-5.65,-1.6,1.6,5.65]) localBox(trim,u,1.78,6.16,.27,3.52,.32);
        localBox(trim,0,.28,6.15,11.5,.34,.3);
        localBox(trim,0,3.3,6.17,11.6,.19,.34);
        for (const u of [-.77,.77]) localBox(metal,u,1.55,6.11,.09,2.95,.17,u<0?1:-1);
        localBox(metal,0,2.96,6.11,1.62,.10,.17,2);
        localBox(metal,.43,1.33,6.17,.045,.38,.07);
        // Only cafes, bakeries and delis have compact fabric canopies; other shops expose
        // their transoms. No pavement objects or new walkable/collision obstructions.
        if (hasAwning) {
          const width = business===0 ? 8.5 : 6.1;
          localBox(awning,0,3.14,6.43,width,.12,.86);
          localBox(awning,0,2.98,6.83,width,.24,.08);
          for (const u of [-width/2+.15,width/2-.15]) localBox(metal,u,2.91,6.43,.045,.04,.8);
        }
        if (streetFacing) {
          localBox(trim,0,3.7,6.105,6.0,.55,.21);
          pane(x+s*6.218,base+3.7,z+c*6.218,5.65,.43,r,business%4,Math.floor(business/4),true);
        }
        // Fire escapes are actual dark iron balconies with handrails and ladders.
        if (!tower && face===((seed>>>3)%4) && seed%2===0) {
          for (let floor=1;floor<Math.min(floors,6);floor++) {
            const y=groundFloor+(floor-1)*floorPitch+.12;
            localBox(metal,-3.55,y,6.45,2.7,.13,.85);
            localBox(metal,-3.55,y+.9,6.85,2.7,.07,.07);
            for (const u of [-4.8,-3.55,-2.3]) localBox(metal,u,y+.45,6.85,.055,.9,.055);
            for (const u of [-4.45,-3.85]) localBox(metal,u,y+floorPitch/2,6.68,.065,floorPitch,.065);
            for (let rung=0;rung<7;rung++) localBox(metal,-4.15,y+rung*floorPitch/7,6.68,.65,.055,.055);
          }
        }
      }
    }
  }
  boxGeometry.dispose();
  let triangles = 0;
  for (const [material,b] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(b.p,3));
    geometry.setAttribute("normal",new THREE.Float32BufferAttribute(b.n,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(b.uv,2));
    geometry.setIndex(b.indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry,material); mesh.name = `Street-wall batch / ${material.name || material.type}`;
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); meshes.push(mesh); triangles += b.indices.length/3;
  }
  group.userData.urbanBlocks = {buildings:records,facades,drawCalls:meshes.length,triangles,atlasSize:512,wallTileMeters:walls.map(m=>meters.get(m)),businessNames:[...BUSINESS_NAMES]};
  let disposed = false;
  return {
    group,colliders,
    setQuality(tier:string) { if (disposed) return; for (const mesh of meshes) mesh.castShadow = tier !== "low"; atlas.anisotropy = tier === "high" ? 8 : tier === "low" ? 1 : 4; atlas.needsUpdate = true; },
    dispose() { if (disposed) return; disposed=true; for (const mesh of meshes) mesh.geometry.dispose(); for (const m of owned) m.dispose(); atlas.dispose(); group.clear(); colliders.length=0; },
  };
}
