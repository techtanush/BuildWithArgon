// OWNER: mahin
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry } from "three";
import { GhostCar } from "../vehicle/GhostCar";
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
  /** Optional terrain sampler; the ghost follows the same grade as the player. */
  heightAt?: (x: number, z: number) => number;
  ghostSpeed?: number;
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
  private gates: Mesh[] = [];
  private ghost: GhostCar | null = null;
  private signal: Group | null = null;
  private signalLabel = "";
  /** True briefly after release; state remains running for existing HUD/Engine clients. */
  get go(): boolean { return this.state === "running" && this.elapsed < 0.85; }
  get countdownLabel(): string { return this.state === "countdown" ? String(this.countdown) : this.go ? "GO" : ""; }
  get rivalProgress(): number { return this.ghost?.distance ?? 0; }
  get rivalFinished(): boolean { return this.ghost?.finished ?? false; }
  setHeightAt(heightAt?: (x: number, z: number) => number): void { this.options.heightAt = heightAt; }
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
      this.gates.push(mesh);
      this.group.add(mesh);
    });
    if (this.checkpoints.length) {
      this.ghost = new GhostCar(path, this.options.ghostSpeed);
      this.ghost.update(0, this.options.heightAt);
      this.group.add(this.ghost.group);
      this.signal = new Group();
      this.signal.name = "Race start signal";
      this.signal.position.set(path[0][0], 6, path[0][1]);
      const next = path.find(p => Math.hypot(p[0] - path[0][0], p[1] - path[0][1]) > 1e-8);
      if (next) this.signal.rotation.y = Math.atan2(-(next[0] - path[0][0]), -(next[1] - path[0][1]));
      this.group.add(this.signal);
      this.updateSignal();
    }
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
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
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
        3 - Math.floor(this.countdownTime + 1e-9),
      );
      this.previous = [...pos];
      this.ghost?.update(0, this.options.heightAt);
      if (this.countdownTime < 3 - 1e-9) {
        this.updateSignal();
        return;
      }
      dt = Math.max(0, this.countdownTime - 3);
      this.state = "running";
    }
    if (this.state !== "running") return;
    this.elapsed += dt;
    this.ghost?.update(this.elapsed, this.options.heightAt);
    this.updateSignal();
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
      this.gates[this.nextCheckpoint].visible = false;
      this.options.onCheckpoint?.(this.nextCheckpoint);
      this.nextCheckpoint++;
      const next = this.gates[this.nextCheckpoint];
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
    this.clear();
  }
  cancel(): void {
    this.state = "abandoned";
    this.clear();
    this.previous = null;
  }
  private updateSignal(): void {
    if (!this.signal) return;
    const label = this.countdownLabel;
    this.signal.visible = !!label;
    // Also reset terrain each frame; Engine's legacy one-off child offset is harmless.
    const [x, z] = [this.signal.position.x, this.signal.position.z];
    this.signal.position.y = 6 + (this.options.heightAt?.(x, z) ?? 0);
    if (!label || label === this.signalLabel) return;
    this.signalLabel = label;
    this.disposeMeshes(this.signal);
    this.signal.clear();
    const patterns: Record<string, string[]> = {
      "3": ["111", "001", "111", "001", "111"],
      "2": ["111", "001", "111", "100", "111"],
      "1": ["010", "110", "010", "010", "111"],
      G: ["111", "100", "101", "101", "111"],
      O: ["111", "101", "101", "101", "111"],
    };
    const width = label.length * 4 - 1;
    const background = new Mesh(new BoxGeometry(width * .48 + .6, 2.9, .15), new MeshBasicMaterial({ color: "#10242c" }));
    this.signal.add(background);
    const ink = new MeshBasicMaterial({ color: label === "GO" ? "#6bffb3" : "#ffdf61", toneMapped: false });
    [...label].forEach((letter, i) => patterns[letter]?.forEach((row, y) => [...row].forEach((bit, x) => {
      if (bit !== "1") return;
      const pixel = new Mesh(new BoxGeometry(.38, .38, .22), ink);
      pixel.position.set((i * 4 + x - (width - 1) / 2) * .48, (2 - y) * .48, 0);
      this.signal!.add(pixel);
    })));
  }
  private disposeMeshes(root: Group): void {
    const materials = new Set<MeshStandardMaterial | MeshBasicMaterial>();
    root.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) materials.add(material);
      }
    });
    materials.forEach(material => material.dispose());
  }
  private clear(): void {
    this.ghost?.dispose();
    this.ghost = null;
    this.disposeMeshes(this.group);
    this.group.clear();
    this.gates = [];
    this.signal = null;
    this.signalLabel = "";
  }
  dispose(): void {
    this.cancel();
    this.result = null;
  }
}
export default Race;
