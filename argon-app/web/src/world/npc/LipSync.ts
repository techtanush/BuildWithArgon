// OWNER: karthik — seed version; replace/extend freely but keep the exported names and signatures (mahin calls them).
// Drives the mouth of one Character while it speaks (05-world/05 §Lip-sync: alignment, analyser, browser boundary).
// mahin's Character.ts reads `lipSync.mouth` every frame after calling `lipSync.update(dt)`.
import type { Alignment } from '../../shared/contracts';
import { REST, type MouthShape } from './visemes';

export type LipSyncSource =
  | { kind: 'alignment'; audio: HTMLAudioElement; alignment: Alignment } // ElevenLabs
  | { kind: 'analyser'; analyser: AnalyserNode } // Gemini TTS (no alignment)
  | { kind: 'boundary' }; // browser speechSynthesis — call onBoundary() on each word

export class LipSync {
  /** Current smoothed mouth shape. */
  mouth: MouthShape = { ...REST };
  speaking = false;

  start(_source: LipSyncSource): void {
    this.speaking = true;
  }

  /** Browser speech word boundary (opens a 180 ms "word active" window). */
  onBoundary(): void {}

  /** Audio ended: ease to Rest over 120 ms. */
  stop(): void {
    this.speaking = false;
  }

  /** Advance by dt seconds; returns the new mouth. Seed: stays at Rest. */
  update(_dt: number): MouthShape {
    return this.mouth;
  }
}
