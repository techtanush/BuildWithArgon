// OWNER: karthik — seed version; replace/extend freely but keep the exported names and signatures (mahin calls them).
// Push-to-talk recording (hold V): MediaRecorder webm/opus, max 30 s (05-world/07-npc-conversation.md).
export class Mic {
  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined';
  }

  recording = false;

  /** Ask permission (first time) and start recording. Rejects if the mic is unavailable/denied. */
  async start(): Promise<void> {
    throw new Error('Mic not implemented yet (owner: karthik)');
  }

  /** Stop and return the recording (null if nothing was recorded). */
  async stop(): Promise<Blob | null> {
    this.recording = false;
    return null;
  }

  cancel(): void {
    this.recording = false;
  }
}
