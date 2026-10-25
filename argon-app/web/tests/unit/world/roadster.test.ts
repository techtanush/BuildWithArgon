import { describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { Car } from '../../../src/world/vehicle/Car';
import { GhostCar } from '../../../src/world/vehicle/GhostCar';
import { buildRoadster } from '../../../src/world/vehicle/Roadster';
import type { VehicleAsset } from '../../../src/world/assets/manifest.contract';

function meshes(car: Car) { const all:Mesh[]=[]; car.group.traverse(o=>{if(o instanceof Mesh) all.push(o);}); return all; }
describe('original runtime teal open-top roadster',()=>{
 it('has bounded 2 by 4.2 proportions, a long rounded hood and an open cockpit',()=>{
  const car=new Car(); car.teleport(0,0);
  const bounds=new Box3().setFromObject(car.group), size=bounds.getSize(new Vector3());
  expect(size.x).toBeGreaterThan(1.95); expect(size.x).toBeLessThan(2.10);
  expect(size.z).toBeCloseTo(4.2,2); expect(size.y).toBeLessThan(1.65);
  const hood=car.group.getObjectByName('long-rounded-hood') as Mesh;
  const hoodSize=new Box3().setFromObject(hood).getSize(new Vector3()); expect(hoodSize.z).toBeGreaterThan(1.7);
  expect((hood.material as MeshStandardMaterial).color.getHexString()).toBe('147e89');
  expect(car.group.getObjectByName('roof')).toBeUndefined();
  // No enclosing body mesh across the cockpit: floor, separate side sills and rear deck.
  const floor=car.group.getObjectByName('cockpit-floor')!;
  expect(new Box3().setFromObject(floor).max.y).toBeLessThan(.6);
  car.dispose();
 });
 it('includes cream round lamps, brown leather, chrome, steering and four separate rotating wheels',()=>{
  const car=new Car(), all=meshes(car);
  const named=(name:string)=>all.filter(m=>m.name===name);
  expect(named('cream-round-headlight')).toHaveLength(2);
  expect((named('cream-round-headlight')[0].material as MeshStandardMaterial).color.getHexString()).toBe('fff5cb');
  expect(named('brown-leather-seat')).toHaveLength(2);
  expect((named('brown-leather-seat')[0].material as MeshStandardMaterial).color.getHexString()).toBe('754630');
  expect(named('brown-leather-seat-back')).toHaveLength(2);
  expect(named('chrome-windshield-frame')).toHaveLength(4);
  expect(named('chrome-bumper')).toHaveLength(2);
  expect(named('curved-wheel-arch')).toHaveLength(4);
  expect(named('exposed-rubber-tire')).toHaveLength(4);
  expect(car.group.getObjectByName('steering-wheel')).toBeDefined();
  const glass=named('transparent-windshield')[0].material as MeshStandardMaterial;
  expect(glass.transparent).toBe(true); expect(glass.opacity).toBeLessThan(.4);
  const wheel=named('exposed-rubber-tire')[0].parent!;
  car.update(.1,{throttle:1,steer:0},[],()=>true);
  expect(wheel.rotation.x).toBeLessThan(0);
  car.update(.1,{throttle:0,brake:true,steer:0},[],()=>true);
  expect((named('red-tail-light')[0].material as MeshStandardMaterial).emissiveIntensity).toBe(3);
  car.followTerrain((x,z)=>x*.1+z*.2);
  expect(car.group.position.y).toBeCloseTo(car.state.x*.1+car.state.z*.2);
  car.dispose();
 });
 it('keeps mesh and triangle budgets bounded with finite geometry and no external textures',()=>{
  const car=new Car(), all=meshes(car); let triangles=0;
  expect(all.length).toBeLessThan(150);
  for(const m of all){
   const positions=m.geometry.getAttribute('position');
   expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
   triangles+=(m.geometry.index?.count??positions.count)/3;
   expect((m.material as MeshStandardMaterial).map).toBeNull();
  }
  expect(triangles).toBeLessThan(15000);
  car.dispose();
 });
 it('never lets a legacy cached GLB replace the original runtime roadster',async()=>{
  const car=new Car(); const original=car.group.getObjectByName('original-teal-roadster');
  const fetchSpy=vi.spyOn(globalThis,'fetch');
  expect(await car.loadAsset({url:'/cache/generic-car.glb'} as VehicleAsset)).toBe(false);
  expect(await car.loadAsset()).toBe(false);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(car.group.getObjectByName('original-teal-roadster')).toBe(original);
  fetchSpy.mockRestore(); car.dispose();
  expect(await car.loadAsset({url:'/cache/generic-car.glb'} as VehicleAsset)).toBe(false);
 });
 it('disposes every unique geometry and material exactly once',()=>{
  const car=new Car(), all=meshes(car);
  const geometrySpies=[...new Set(all.map(m=>m.geometry))].map(g=>vi.spyOn(g,'dispose'));
  const materials=[...new Set(all.flatMap(m=>Array.isArray(m.material)?m.material:[m.material]))];
  const materialSpies=materials.map(m=>vi.spyOn(m,'dispose'));
  car.dispose();car.dispose();
  for(const spy of [...geometrySpies,...materialSpies])expect(spy).toHaveBeenCalledTimes(1);
  expect(car.group.children).toHaveLength(0);
 });
 it('preserves translucent teal ghost materials without changing the real car',()=>{
  const real=new Car(), ghost=new GhostCar([[0,0],[0,10]]);
  ghost.group.traverse(o=>{if(o instanceof Mesh){
   expect(o.castShadow).toBe(false);
   for(const m of Array.isArray(o.material)?o.material:[o.material]){
    expect(m.transparent).toBe(true);expect(m.opacity).toBe(.58);expect(m.depthWrite).toBe(false);
    expect((m as MeshStandardMaterial).color.getHexString()).toBe('43ddeb');
   }
  }});
  const hood=real.group.getObjectByName('long-rounded-hood') as Mesh;
  expect((hood.material as MeshStandardMaterial).color.getHexString()).toBe('147e89');
  expect((hood.material as MeshStandardMaterial).opacity).toBe(1);
  real.dispose();ghost.dispose();
 });
 it('exposes four wheel pivots at the unchanged axle spacing',()=>{
  const {model,wheels}=buildRoadster(new MeshStandardMaterial());
  expect(wheels).toHaveLength(4);
  expect(wheels.map(w=>w.position.z)).toEqual([-1.3,1.3,-1.3,1.3]);
  model.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});
  const materials=new Set<MeshStandardMaterial>();model.traverse(o=>{if(o instanceof Mesh)materials.add(o.material as MeshStandardMaterial);}); materials.forEach(m=>m.dispose());
 });
});
