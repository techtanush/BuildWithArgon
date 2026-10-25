import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, CylinderGeometry, SphereGeometry, TorusGeometry, TubeGeometry, CatmullRomCurve3, Vector3, DoubleSide, type Material, type Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Original authored geometry. No downloaded model, textures, logos, or asset requests. */
export function buildRoadster(tail: MeshStandardMaterial): { model: Group; wheels: Object3D[] } {
  const model = new Group(); model.name = 'original-teal-roadster';
  model.userData.design = 'original-procedural-roadster-v1';
  const paint = new MeshPhysicalMaterial({ color: '#147e89', metalness: .57, roughness: .25, clearcoat: 1, clearcoatRoughness: .13 });
  const chrome = new MeshStandardMaterial({ color: '#d6e5e7', metalness: .92, roughness: .19 });
  const rubber = new MeshStandardMaterial({ color: '#171d20', roughness: .87 });
  const leather = new MeshStandardMaterial({ color: '#754630', roughness: .72 });
  const piping = new MeshStandardMaterial({ color: '#bb8b60', roughness: .75 });
  const dark = new MeshStandardMaterial({ color: '#162d32', roughness: .6 });
  const cream = new MeshStandardMaterial({ color: '#fff5cb', emissive: '#fff1bb', emissiveIntensity: .65, roughness: .22 });
  const glass = new MeshPhysicalMaterial({ color: '#b4e4e5', transparent: true, opacity: .24, roughness: .08, metalness: .05, side: DoubleSide, depthWrite: false });
  function mesh(name: string, geo: BufferGeometry, mat: Material, x=0,y=0,z=0, parent: Object3D=model) {
    const m = new Mesh(geo, mat); m.name=name; m.position.set(x,y,z); m.castShadow = m.receiveShadow = mat !== glass; parent.add(m); return m;
  }
  function rounded(name: string,w:number,h:number,d:number,r:number,mat:Material,x:number,y:number,z:number,parent:Object3D=model) {
    return mesh(name,new RoundedBoxGeometry(w,h,d,2,r),mat,x,y,z,parent);
  }
  function rod(name: string,a:number[],b:number[],radius:number,mat:Material,parent:Object3D=model) {
    const av=new Vector3(...a), bv=new Vector3(...b), delta=bv.clone().sub(av);
    const m=mesh(name,new CylinderGeometry(radius,radius,delta.length(),8),mat,0,0,0,parent);
    m.position.copy(av.add(bv).multiplyScalar(.5)); m.quaternion.setFromUnitVectors(new Vector3(0,1,0),delta.normalize()); return m;
  }
  // Longitudinal elliptical sections form smoothly crowned, tapered body panels.
  function shell(name:string, sections:number[][]) {
    const vertices:number[]=[], indices:number[]=[], n=20;
    for(const [z,width,center,height] of sections) for(let j=0;j<=n;j++) {
      const a=j/n*Math.PI*2; vertices.push(Math.cos(a)*width,center+Math.sin(a)*height,z);
    }
    for(let i=0;i<sections.length-1;i++) for(let j=0;j<n;j++) {
      const a=i*(n+1)+j,b=a+n+1; indices.push(a,a+1,b,b,a+1,b+1);
    }
    for(const i of [0,sections.length-1]) {
      const [z,,y]=sections[i], c=vertices.length/3; vertices.push(0,y,z);
      for(let j=0;j<n;j++) { const a=i*(n+1)+j; if(i===0) indices.push(c,a+1,a); else indices.push(c,a,a+1); }
    }
    const geo=new BufferGeometry(); geo.setAttribute('position',new Float32BufferAttribute(vertices,3)); geo.setIndex(indices); geo.computeVertexNormals(); return mesh(name,geo,paint);
  }
  shell('long-rounded-hood', [[-2,.57,.65,.11],[-1.88,.76,.73,.22],[-1.5,.83,.78,.30],[-.9,.80,.81,.32],[-.35,.75,.82,.31],[-.22,.74,.80,.28]]);
  shell('rounded-rear-deck', [[1.02,.76,.76,.25],[1.35,.83,.76,.28],[1.75,.80,.70,.25],[1.98,.63,.65,.13]]);
  rounded('cockpit-floor',1.52,.12,1.55,.05,dark,0,.47,.45);
  for(const side of [-1,1]) {
    rounded('sculpted-door-sill',.18,.40,1.55,.085,paint,side*.75,.67,.43);
    rod('chrome-cockpit-edge',[side*.75,.88,-.24],[side*.75,.88,1.12],.024,chrome);
    rod('side-running-trim',[side*.79,.48,-1.82],[side*.79,.48,1.8],.022,chrome);
    const x=side*.39;
    rounded('brown-leather-seat',.59,.17,.62,.075,leather,x,.62,.48);
    const back=rounded('brown-leather-seat-back',.60,.76,.20,.095,leather,x,.97,.89); back.rotation.x=-.12;
    for(const offset of [-.17,0,.17]) rod('seat-stitch',[x+offset,.74,.765],[x+offset,1.19,.82],.007,piping);
    const lamp=mesh('cream-round-headlight',new CylinderGeometry(.245,.245,.095,32),cream,side*.63,.93,-1.91); lamp.rotation.x=Math.PI/2;
    mesh('headlight-chrome-rim',new TorusGeometry(.253,.027,8,32),chrome,side*.63,.93,-1.97);
    const rear=mesh('red-tail-light',new CylinderGeometry(.095,.095,.07,16),tail,side*.59,.78,1.98); rear.rotation.x=Math.PI/2;
    rod('mirror-stalk',[side*.74,1.07,-.15],[side*.91,1.15,-.20],.025,chrome);
    const mirror=mesh('teal-wing-mirror',new SphereGeometry(1,16,10),paint,side*.91,1.17,-.2); mirror.scale.set(.09,.07,.14);
  }
  rounded('front-grille',.89,.21,.07,.025,dark,0,.59,-1.99);
  for(let i=-5;i<=5;i++) rod('grille-chrome-slat',[i*.073,.51,-2.035],[i*.073,.67,-2.035],.012,chrome);
  for(const z of [-2.06,2.06]) rod('chrome-bumper',[-.87,.43,z],[.87,.43,z],.04,chrome);
  rounded('dashboard',1.43,.20,.20,.06,dark,0,.92,-.18);
  for(const x of [-.43,-.20]) {
    const dial=mesh('cream-dashboard-dial',new CylinderGeometry(.065,.065,.015,16),cream,x,1.00,-.065); dial.rotation.x=Math.PI/2;
  }
  const windshield = new BufferGeometry();
  windshield.setAttribute('position', new Float32BufferAttribute([-.74,1.02,-.29,.74,1.02,-.29,-.65,1.59,-.05,.65,1.59,-.05],3));
  windshield.setIndex([0,1,2,2,1,3]); windshield.computeVertexNormals(); mesh('transparent-windshield',windshield,glass);
  const corners=[[-.74,1.02,-.29],[.74,1.02,-.29],[.65,1.59,-.05],[-.65,1.59,-.05]];
  for(let i=0;i<4;i++) rod('chrome-windshield-frame',corners[i],corners[(i+1)%4],.023,chrome);
  const steering = new Group(); steering.name='steering-wheel'; steering.position.set(-.39,1.12,.12); steering.rotation.x=-.42; model.add(steering);
  mesh('steering-leather-rim',new TorusGeometry(.22,.024,8,24),leather,0,0,0,steering);
  for(let i=0;i<3;i++) { const a=i*Math.PI*2/3; rod('steering-chrome-spoke',[0,0,0],[Math.sin(a)*.20,Math.cos(a)*.20,0],.012,chrome,steering); }
  rod('steering-column',[-.39,.92,-.15],[-.39,1.12,.12],.025,dark);
  rod('gear-stick',[0,.53,.41],[0,.79,.34],.018,chrome); mesh('gear-knob',new SphereGeometry(.045,10,8),leather,0,.79,.34);
  const wheels:Object3D[]=[];
  for(const side of [-1,1]) for(const z of [-1.30,1.30]) {
    const wheel=new Group(); wheel.name=`roadster-wheel-${side}-${z}`; wheel.position.set(side*.83,.39,z); model.add(wheel); wheels.push(wheel);
    const tire=mesh('exposed-rubber-tire',new CylinderGeometry(.38,.38,.30,24),rubber,0,0,0,wheel); tire.rotation.z=Math.PI/2;
    const hub=mesh('chrome-wheel-hub',new CylinderGeometry(.24,.24,.31,20),chrome,0,0,0,wheel); hub.rotation.z=Math.PI/2;
    const inset=mesh('wheel-inset',new CylinderGeometry(.19,.19,.317,20),dark,0,0,0,wheel); inset.rotation.z=Math.PI/2;
    for(let i=0;i<8;i++) { const a=i*Math.PI/4; rod('wheel-spoke',[side*.166,0,0],[side*.166,Math.sin(a)*.22,Math.cos(a)*.22],.018,chrome,wheel); }
    const cap=mesh('wheel-center-cap',new CylinderGeometry(.065,.065,.34,12),chrome,0,0,0,wheel); cap.rotation.z=Math.PI/2;
    // Curved fender ribbons leave the tire sides and lower halves exposed.
    const verts:number[]=[], idx:number[]=[];
    for(let i=0;i<=20;i++) { const a=.08+i/20*(Math.PI-.16); for(const x of [side*.66,side*.995]) verts.push(x,.39+Math.sin(a)*.46,z+Math.cos(a)*.46); }
    for(let i=0;i<20;i++){const a=i*2; if(side===1) idx.push(a,a+1,a+2,a+1,a+3,a+2); else idx.push(a,a+2,a+1,a+1,a+2,a+3);}
    const g=new BufferGeometry(); g.setAttribute('position',new Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();
    // The ribbon is visible from above; a rounded outer lip completes the arch.
    mesh('curved-wheel-arch',g,paint);
    const points=Array.from({length:17},(_,i)=>{const a=.08+i/16*(Math.PI-.16);return new Vector3(side*.98,.39+Math.sin(a)*.46,z+Math.cos(a)*.46);});
    mesh('rounded-fender-lip',new TubeGeometry(new CatmullRomCurve3(points),20,.022,6,false),paint);
  }
  return { model, wheels };
}
