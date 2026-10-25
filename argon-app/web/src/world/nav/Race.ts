// OWNER: mahin
import { Group, Mesh, MeshStandardMaterial, TorusGeometry } from "three";
import type { XZ } from "../../shared/contracts";
import { pathLength } from "./RoadGraph";
export interface Checkpoint {
  pos: XZ;
  heading: number;
  distance: number;
}
export interface RaceResult {
  buildingId: string;
  time: number;
  best: number;
  newBest: boolean;
}
export interface RaceOptions {
  storage?: Pick<Storage, "getItem" | "setItem">;
  onFinish?: (result: RaceResult) => void;
  onCheckpoint?: (index: number) => void;
}
export function makeCheckpoints(path: readonly XZ[]): Checkpoint[] {
  const total = pathLength(path);
  if (path.length < 2 || total <= 0) return [];
  const count = Math.max(3, Math.min(10, Math.round(total / 45))),
    out: Checkpoint[] = [];
  for (let k = 1; k <= count; k++) {
    const d = (total * k) / count;
    let walked = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i],
        len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (walked + len >= d - 1e-8 || i === path.length - 1) {
        const t = len ? Math.max(0, Math.min(1, (d - walked) / len)) : 0;
        out.push({
          pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
          heading: Math.atan2(b[0] - a[0], b[1] - a[1]),
          distance: d,
        });
        break;
      }
      walked += len;
    }
  }
  return out;
}
export class Race {
  readonly group = new Group();
  state: "idle" | "countdown" | "running" | "finished" | "abandoned" = "idle";
  checkpoints: Checkpoint[] = [];
  nextCheckpoint = 0;
  elapsed = 0;
  countdown = 3;
  result: RaceResult | null = null;
  buildingId = "";
  private countdownTime = 0;
  private previous: XZ | null = null;
  private finishDelay = 0;
  private notified = false;
  constructor(private options: RaceOptions = {}) {}
  start(path: readonly XZ[], buildingId: string): void {
    this.clear();
    this.checkpoints = makeCheckpoints(path);
    this.buildingId = buildingId;
    this.nextCheckpoint = 0;
    this.elapsed = 0;
    this.countdown = 3;
    this.countdownTime = 0;
    this.result = null;
    this.previous = null;
    this.notified = false;
    this.finishDelay = 0;
    this.state = this.checkpoints.length ? "countdown" : "idle";
    this.checkpoints.forEach((p, i) => {
      const material = new MeshStandardMaterial({
        color: "#f5d90a",
        emissive: "#f5d90a",
        emissiveIntensity: i ? 0.5 : 2,
        transparent: true,
        opacity: i ? 0.35 : 0.9,
        depthWrite: false,
      });
      const mesh = new Mesh(new TorusGeometry(4.5, 0.18, 8, 48), material);
      mesh.position.set(p.pos[0], 3.4, p.pos[1]);
      mesh.rotation.y = p.heading;
      this.group.add(mesh);
    });
  }
  get frozen(): boolean {
    return this.state === "countdown";
  }
  private storage(): Pick<Storage, "getItem" | "setItem"> | undefined {
    try {
      return this.options.storage ?? globalThis.localStorage;
    } catch {
      return undefined;
    }
  }
  update(dt: number, pos: XZ): void {
    dt = Math.max(0, Math.min(0.25, dt));
    if (this.state === "finished") {
      this.finishDelay += dt;
      if (this.finishDelay >= 1.2 && !this.notified && this.result) {
        this.notified = true;
        this.options.onFinish?.(this.result);
      }
      return;
    }
    if (this.state === "countdown") {
      this.countdownTime += dt;
      this.countdown = Math.max(
        0,
        3 - Math.floor((this.countdownTime + 1e-9) / 0.6),
      );
      this.previous = [...pos];
      if (this.countdownTime < 1.8 - 1e-9) return;
      dt = Math.max(0, this.countdownTime - 1.8);
      this.state = "running";
    }
    if (this.state !== "running") return;
    this.elapsed += dt;
    const cp = this.checkpoints[this.nextCheckpoint];
    if (!cp) return;
    const a = this.previous ?? pos,
      dx = pos[0] - a[0],
      dz = pos[1] - a[1],
      t = Math.max(
        0,
        Math.min(
          1,
          ((cp.pos[0] - a[0]) * dx + (cp.pos[1] - a[1]) * dz) /
            (dx * dx + dz * dz || 1),
        ),
      );
    // A single next gate is consumed per update; out-of-order gates are never credited.
    if (Math.hypot(cp.pos[0] - a[0] - dx * t, cp.pos[1] - a[1] - dz * t) <= 7) {
      this.group.children[this.nextCheckpoint].visible = false;
      this.options.onCheckpoint?.(this.nextCheckpoint);
      this.nextCheckpoint++;
      const next = this.group.children[this.nextCheckpoint] as Mesh | undefined;
      if (next) {
        const m = next.material as MeshStandardMaterial;
        m.opacity = 0.9;
        m.emissiveIntensity = 2;
      } else this.finish();
    }
    this.previous = [...pos];
  }
  private finish(): void {
    const key = `foundry.race.best.${this.buildingId}`;
    let old = Infinity;
    try {
      const stored = this.storage()?.getItem(key);
      const value =
        stored === null || stored === undefined ? NaN : Number(stored);
      if (Number.isFinite(value) && value > 0) old = value;
    } catch {}
    const newBest = this.elapsed < old;
    const best = Math.min(old, this.elapsed);
    if (newBest)
      try {
        this.storage()?.setItem(key, String(best));
      } catch {}
    this.result = {
      buildingId: this.buildingId,
      time: this.elapsed,
      best,
      newBest,
    };
    this.state = "finished";
  }
  cancel(): void {
    this.state = "abandoned";
    this.clear();
    this.previous = null;
  }
  private clear(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        (o.material as MeshStandardMaterial).dispose();
      }
    });
    this.group.clear();
  }
  dispose(): void {
    this.clear();
  }
}
export default Race;
