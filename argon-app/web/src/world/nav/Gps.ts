// OWNER: mahin
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  ShaderMaterial,
  CatmullRomCurve3,
  Vector3,
  DoubleSide,
} from "three";
import type { XZ } from "../../shared/contracts";
import { pathLength } from "./RoadGraph";
export function smoothPath(points: readonly XZ[], spacing = 2): XZ[] {
  const unique = points.filter(
    (p, i) =>
      !i || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-6,
  );
  if (unique.length < 2) return unique.map((p) => [...p]);
  const curve = new CatmullRomCurve3(
    unique.map((p) => new Vector3(p[0], 0, p[1])),
    false,
    "centripetal",
  );
  return curve
    .getSpacedPoints(Math.max(1, Math.ceil(curve.getLength() / spacing)))
    .map((p) => [p.x, p.z]);
}
export class Gps {
  readonly group = new Group();
  readonly material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { time: { value: 0 }, progress: { value: 0 } },
    vertexShader:
      "attribute float along; varying float vAlong; varying vec2 vUv; void main(){vAlong=along;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader:
      "uniform float time; uniform float progress; varying float vAlong; varying vec2 vUv; void main(){float arrow=step(0.57,fract(vAlong/3.0-time*0.5-abs(vUv.x-0.5)*0.65));float fade=smoothstep(progress-6.0,progress,vAlong); gl_FragColor=vec4(0.96,0.85,0.04,(0.25+0.60*arrow)*fade);}",
  });
  private points: XZ[] = [];
  private cumulative: number[] = [];
  needsReroute = false;
  setPath(path: readonly XZ[],options?:{heightAt:(x:number,z:number)=>number;orthogonal?:boolean}): void {
    this.clear();
    this.points = options?.orthogonal ? path.flatMap((a,i)=>{const b=path[i+1];if(!b)return [[...a] as XZ];const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));return Array.from({length:n},(_,j)=>[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n] as XZ);}) : smoothPath(path);
    if (this.points.length < 2) return;
    const pos: number[] = [],
      uv: number[] = [],
      along: number[] = [],
      indices: number[] = [];
    let total = 0;
    this.points.forEach((p, i) => {
      if (i)
        total += Math.hypot(
          p[0] - this.points[i - 1][0],
          p[1] - this.points[i - 1][1],
        );
      this.cumulative.push(total);
      const a = this.points[Math.max(0, i - 1)],
        b = this.points[Math.min(this.points.length - 1, i + 1)],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        l = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) {
        pos.push(
          p[0] - (dz / l) * 0.6 * side,
          options?options.heightAt(p[0],p[1])+.21:.06,
          p[1] + (dx / l) * 0.6 * side,
        );
        uv.push((side + 1) / 2, total / 3);
        along.push(total);
      }
      if (i) {
        const n = i * 2;
        indices.push(n - 2, n - 1, n, n - 1, n + 1, n);
      }
    });
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    geo.setAttribute("along", new Float32BufferAttribute(along, 1));
    geo.setIndex(indices);
    this.group.add(new Mesh(geo, this.material));
    this.material.uniforms.progress.value = 0;
  }
  update(dt: number, position: XZ): void {
    this.material.uniforms.time.value += Math.max(0, dt);
    let best = Infinity,
      progress = 0;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1],
        b = this.points[i],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((position[0] - a[0]) * dx + (position[1] - a[1]) * dz) /
              (dx * dx + dz * dz || 1),
          ),
        ),
        d = Math.hypot(
          position[0] - a[0] - t * dx,
          position[1] - a[1] - t * dz,
        );
      if (d < best) {
        best = d;
        progress = this.cumulative[i - 1] + t * Math.hypot(dx, dz);
      }
    }
    this.needsReroute = this.points.length > 0 && best > 12;
    this.material.uniforms.progress.value = progress;
  }
  clear(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.group.clear();
    this.points = [];
    this.cumulative = [];
    this.needsReroute = false;
  }
  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
export default Gps;
