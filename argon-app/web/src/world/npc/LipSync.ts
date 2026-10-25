// OWNER: karthik
import type { Alignment } from '../../shared/contracts';
import { REST, VISEMES, charIndexAt, visemeForChar, type MouthShape } from './visemes';
export type LipSyncSource =
  | { kind: 'alignment'; audio: HTMLAudioElement; alignment: Alignment }
  | { kind: 'analyser'; analyser: AnalyserNode }
  | { kind: 'boundary' }
  | { kind: 'level'; level: () => number };
export class LipSync {
  mouth: MouthShape = { ...REST };
  speaking = false;
  private source: LipSyncSource | null = null;
  private boundaryAt = -Infinity;
  private samples = new Float32Array(1024);
  private easing = 0;
  private stopped: MouthShape = { ...REST };
  constructor(private now: () => number = () => performance.now() / 1000) {}
  start(source: LipSyncSource): void {
    this.source = source; this.speaking = true; this.boundaryAt = -Infinity; this.easing = 0;
    if (source.kind === 'analyser') { source.analyser.fftSize = 1024; this.samples = new Float32Array(1024); }
  }
  onBoundary(): void { this.boundaryAt = this.now(); }
  stop(): void {
    this.source = null; this.speaking = false; this.easing = 0.12; this.stopped = { ...this.mouth };
  }
  update(dt: number): MouthShape {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    let target = REST;
    const s = this.source;
    if (!s && this.easing > 0) {
      this.easing = Math.max(0, this.easing - dt);
      const f = this.easing / 0.12;
      this.mouth.open = REST.open + (this.stopped.open - REST.open) * f;
      this.mouth.width = REST.width + (this.stopped.width - REST.width) * f;
      return this.mouth;
    }
    if (s?.kind === 'alignment') {
      const t = s.audio.currentTime, k = charIndexAt(s.alignment, t);
      if (k >= 0) {
        target = VISEMES[visemeForChar(s.alignment.chars[k])];
        if (s.alignment.ends[k] - t <= 0.04 && k + 1 < s.alignment.chars.length) {
          const next = VISEMES[visemeForChar(s.alignment.chars[k + 1])];
          target = { open: target.open * 0.7 + next.open * 0.3, width: target.width * 0.7 + next.width * 0.3 };
        }
      }
    } else if (s?.kind === 'analyser' || s?.kind === 'level') {
      let level = 0;
      try {
        if (s.kind === 'analyser') { s.analyser.getFloatTimeDomainData(this.samples); level = Math.sqrt(this.samples.reduce((sum, x) => sum + x * x, 0) / this.samples.length); }
        else level = s.level();
      } catch { /* a disconnected source is silence */ }
      const open = Number.isFinite(level) ? Math.max(0, Math.min(0.07, (level - 0.02) * 0.9)) : 0;
      target = { open, width: 0.075 - open * 0.2 };
    } else if (s?.kind === 'boundary') {
      const t = this.now() - this.boundaryAt;
      if (t >= 0 && t < 0.18) target = { open: 0.03 + 0.03 * Math.abs(Math.sin(2 * Math.PI * 9 * t)), width: 0.075 };
    }
    const blend = 1 - Math.exp(-25 * dt);
    this.mouth.open += (target.open - this.mouth.open) * blend;
    this.mouth.width += (target.width - this.mouth.width) * blend;
    return this.mouth;
  }
}
