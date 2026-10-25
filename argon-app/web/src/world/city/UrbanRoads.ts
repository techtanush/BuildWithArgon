// OWNER: mahin
import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../kit/materials';
import { STREET_COORDS, cityHeight } from './urbanLayout';
import { textSign } from './signage';
export function asphaltShade(x:number,z:number){return .88+.07*Math.sin(x*.21+z*.07)+.035*Math.sin(x*.81-z*.49);}
export function buildUrbanRoads(materials: MaterialLibrary) {
    const group = new T.Group();
    group.name = 'City streets and intersections';
    const bins = new Map<T.Material, T.BufferGeometry[]>();
    const owned = new Set<T.Material>();
    const material = (c: string) => { const m = new T.MeshStandardMaterial({ color: c, roughness: .85 }); owned.add(m); return m; };
    const asphalt = materials.get('road').clone();asphalt.vertexColors=true;owned.add(asphalt);
    const sidewalk = materials.get('sidewalk');
    const curb = materials.get('curb');
    const white = material('#d5d2b9'), yellow = material('#d8b45a'), red = material('#9d473c'), tram = material('#566269');
    const paintPixels=new Uint8Array(128*128*4);
    for(let i=0;i<128*128;i++){const hash=Math.imul(i^0x4ab6,0x45d9f3b)>>>0;const value=210+(hash%45);paintPixels.set([value,value,value,hash%83<3?0:255],i*4);}
    const paintTexture=new T.DataTexture(paintPixels,128,128);paintTexture.colorSpace=T.SRGBColorSpace;
    paintTexture.wrapS=paintTexture.wrapT=T.RepeatWrapping;paintTexture.generateMipmaps=true;paintTexture.minFilter=T.LinearMipmapLinearFilter;paintTexture.magFilter=T.LinearFilter;paintTexture.needsUpdate=true;
    for(const paint of [white,yellow]){paint.map=paintTexture;paint.alphaTest=.5;}
    const add = (g: T.BufferGeometry, m: T.Material) => { const a = bins.get(m) ?? []; a.push(g); bins.set(m, a); };
    const plane = (cx: number, cz: number, w: number, d: number, offset: number, m: T.Material, segments = 1) => { const g = new T.PlaneGeometry(w, d, Math.max(1, Math.ceil(w / segments)), Math.max(1, Math.ceil(d / segments))); g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz); const p = g.attributes.position, uv = g.attributes.uv;
      const tile=materials.tileMeters.get(m===asphalt?"road":m===sidewalk?"sidewalk":m===curb?"curb":"lane_marking")??4; for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        p.setY(i, cityHeight(x, z) + offset);
        uv.setXY(i, x / 4, z / 4);
    } if(m===asphalt){const colors=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){const v=asphaltShade(p.getX(i),p.getZ(i));colors.set([v,v,v],i*3);}g.setAttribute("color",new T.BufferAttribute(colors,3));}g.computeVertexNormals(); add(g, m); };
    // A continuous terrain mesh and individual block pavements eliminate the campus lawn.
    plane(-750, 0, 1950, 2400, -.55, materials.get('grass'), 25);
    plane(0, 0, 466, 466, -.045, materials.get('dirt'), 6);
    for (let ix = 0; ix < 6; ix++)
        for (let iz = 0; iz < 6; iz++) {
            const x = STREET_COORDS[ix] + 36, z = STREET_COORDS[iz] + 36;
            plane(x, z, 58, 58, .05, sidewalk, 4);
            plane(x, z, 52, 52, .055, materials.get('plaza_stone'), 4);
        }
    // Junctions share a single road plane. Parallel rows are offset slightly to prevent z-fighting.
    for (const x of STREET_COORDS)
        plane(x, 0, 14, 448, .075, asphalt, 4);
    for (const z of STREET_COORDS)
        plane(0, z, 448, 14, .08, asphalt, 4);
    for (const x of STREET_COORDS)
        for (let j = 0; j < 6; j++) {
            const z = STREET_COORDS[j] + 36;
            for (const side of [-1, 1]) {
                plane(x + side * 7.4, z, .5, 52, .18, curb, 4);
                plane(x + side * 9.3, z, 3.3, 52, .18, sidewalk, 4);
                plane(x + side * .19, z, .11, 49, .09, yellow, 4);
            }
            for (let d = -20; d <= 20; d += 9)
                plane(x - 3.6, z + d, .12, 3, .095, white, 3);
        }
    for (const z of STREET_COORDS)
        for (let i = 0; i < 6; i++) {
            const x = STREET_COORDS[i] + 36;
            for (const side of [-1, 1]) {
                plane(x, z + side * 7.4, 52, .5, .18, curb, 4);
                plane(x, z + side * 9.3, 52, 3.3, .18, sidewalk, 4);
                plane(x, z + side * .19, 49, .11, .095, yellow, 4);
            }
            for (let d = -20; d <= 20; d += 9)
                plane(x + d, z - 3.6, 3, .12, .095, white, 3);
        }
    // Zebra crossings and stop lines at every intersection. Nothing is painted across a block.
    for (const x of STREET_COORDS)
        for (const z of STREET_COORDS) {
            for (const side of [-1, 1]) {
                for (let n = -5; n <= 5; n += 2) {
                    plane(x + n, z + side * 9, .85, 3, .20, white, 3);
                    plane(x + side * 9, z + n, 3, .85, .20, white, 3);
                }
                plane(x, z + side * 12, 6, .23, .09, white, 3);
                plane(x + side * 12, z, .23, 6, .09, white, 3);
            }
        }
    // Twin tram rails down Market Street give the long road a distinctive city silhouette.
    for (const x of [-1.1, 1.1])
        plane(x, -36, .075, 360, .10, tram, 4);
    // Select corner red curbs / parking stripes, not a red perimeter around every block.
    for (const x of STREET_COORDS.slice(1, -1))
        for (const z of STREET_COORDS.slice(1, -1)) {
            plane(x + 8, z + 17, .32, 7, .20, red, 3);
        }
    // Small, functional-scale hardware breaks up immaculate slabs without cluttering lanes.
    const hardware=material('#404b50');hardware.metalness=.6;hardware.roughness=.65;
    const box=(x:number,z:number,w:number,h:number,d:number,base:number,m:T.Material)=>{
      const g=new T.BoxGeometry(w,h,d);g.translate(x,base+h/2,z);const p=g.attributes.position;
      for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+cityHeight(p.getX(i),p.getZ(i)));g.computeVertexNormals();add(g,m);
    };
    for(const x of [-72,0,72,144])for(const z of [-108,-36,36,108]){
      const cx=x+3.5,cz=z+14,y=cityHeight(cx,cz)+.096;
      const cover=new T.CircleGeometry(.44,32);cover.rotateX(-Math.PI/2);cover.translate(cx,y,cz);add(cover,hardware);
      for(const radius of [.20,.32,.42]){const ring=new T.TorusGeometry(radius,.006,3,32);ring.rotateX(Math.PI/2);ring.translate(cx,y+.008,cz);add(ring,tram);}
      for(const side of [-1,1]){const dx=x+side*6.65;box(dx,z+20,.42,.012,.85,.09,hardware);for(let n=-3;n<=3;n++)box(dx,z+20+n*.11,.4,.008,.035,.104,tram);}
    }
    for(const x of STREET_COORDS)for(let j=0;j<6;j++)for(const side of [-1,1])box(x+side*7.4,STREET_COORDS[j]+36,.5,.10,52,.08,curb);
    for(const z of STREET_COORDS)for(let i=0;i<6;i++)for(const side of [-1,1])box(STREET_COORDS[i]+36,z+side*7.4,52,.10,.5,.08,curb);
    for (const [m, list] of bins) {
        const geometry = mergeGeometries(list);
        list.forEach(g => g.dispose());
        if (geometry) {
            const mesh = new T.Mesh(geometry, m);
            mesh.receiveShadow = true;
            group.add(mesh);
        }
    }
    // Repeated poles/signals are instanced and grounded on the street grade.
    const dummy = new T.Object3D(), poleMat = material('#34433e'), signalMat = material('#d8b34d');
    const crossings = STREET_COORDS.slice(1, -1).flatMap(x => STREET_COORDS.slice(1, -1).map(z => [x + 10.2, z + 10.2]));
    const poles = new T.InstancedMesh(new T.CylinderGeometry(.06, .1, 5.4, 8), poleMat, crossings.length);
    const heads = new T.InstancedMesh(new T.BoxGeometry(.38, 1.05, .3), signalMat, crossings.length);
    const greens = new T.InstancedMesh(new T.SphereGeometry(.105, 6, 5), new T.MeshBasicMaterial({ color: '#7ab08c' }), crossings.length);
    owned.add(greens.material as T.Material);
    crossings.forEach(([x, z], i) => { const y = cityHeight(x, z); dummy.position.set(x, y + 2.7, z); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix); dummy.position.set(x, y + 4.75, z + .07); dummy.updateMatrix(); heads.setMatrixAt(i, dummy.matrix); dummy.position.set(x, y + 4.48, z + .23); dummy.updateMatrix(); greens.setMatrixAt(i, dummy.matrix); });
    poles.castShadow = true;
    group.add(poles, heads, greens);
    const names = ['PACIFIC ST', 'CALIFORNIA ST', 'FOUNDRY ST', 'MARKET ST', 'MISSION ST'];
    for (let i = 0; i < names.length; i++) {
        const sign = textSign(names[i], '', 2.4);
        const x = 10.2, z = STREET_COORDS[i + 1] + 10.2;
        sign.position.set(x, cityHeight(x, z) + 3.45, z);
        group.add(sign);
    }
    return { group, dispose() { group.traverse(o => { if (o instanceof T.Mesh) {
            o.geometry.dispose();
            if (o.userData.ownedTexture)
                o.userData.ownedTexture.dispose();
        } }); owned.forEach(m => m.dispose());paintTexture.dispose(); group.clear(); } };
}
