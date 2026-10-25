// OWNER: mahin
import { PerspectiveCamera, Vector3 } from "three";
import type { CarState } from "./Car";
export class ChaseCamera {
  constructor(public readonly camera: PerspectiveCamera) {}
  update(dt: number, state: CarState, snap = false, groundY=0,heightAt?:(x:number,z:number)=>number): void {
    const s = Math.sin(state.heading),
      c = Math.cos(state.heading),
      target = new Vector3(state.x + s * 6.5, groundY+2.4, state.z + c * 6.5);
    target.y=Math.max(target.y,(heightAt?.(target.x,target.z)??groundY)+1.6);
    this.camera.position.lerp(
      target,
      snap ? 1 : 1 - Math.exp(-6 * Math.max(0, dt)),
    );
    this.camera.lookAt(state.x - s * 4, (heightAt?.(state.x-s*4,state.z-c*4)??groundY)+1.2, state.z - c * 4);
    this.camera.fov = 70 + 8 * Math.min(1, Math.abs(state.speed) / 36);
    this.camera.updateProjectionMatrix();
  }
}
export default ChaseCamera;
