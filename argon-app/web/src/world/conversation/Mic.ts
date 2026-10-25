// OWNER: karthik
/** One permission request per recording, with no idle microphone left open. */
export class Mic {
  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }
  recording = false;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private pending: Promise<void> | null = null;
  private result: Promise<Blob | null> = Promise.resolve(null);
  private finish: ((blob: Blob | null) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private since = 0;
  start(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.recording) return Promise.resolve();
    const generation = ++this.generation;
    const pending = this.begin(generation).finally(() => { if (this.pending === pending) this.pending = null; });
    this.pending = pending;
    return pending;
  }
  private async begin(generation: number): Promise<void> {
    if (!Mic.supported()) throw new Error('Microphone recording is unavailable. Type instead.');
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
    catch { throw new Error('Microphone permission denied or unavailable. Type instead.'); }
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream;
    try {
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported?.(m));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      this.result = new Promise(resolve => { this.finish = resolve; });
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { if (this.recorder === recorder) this.cancel(); };
      recorder.onstop = () => {
        if (this.recorder !== recorder) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
        this.cleanup(generation === this.generation && performance.now() - this.since >= 300 && blob.size ? blob : null);
      };
      this.since = performance.now(); recorder.start(); this.recording = true;
      this.timer = setTimeout(() => { void this.stop(); }, 30_000);
    } catch { this.cleanup(null); throw new Error('Microphone recording could not start. Type instead.'); }
  }
  async stop(): Promise<Blob | null> {
    // Permission prompts cannot be aborted, but releasing must never wait for one.
    if (this.pending && !this.recorder) { this.cancel(); return null; }
    try {
      if (this.recorder?.state === 'recording') {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.cancel(), 1500);
        this.recorder.stop();
      }
    } catch { this.cancel(); }
    // Stop capture immediately, even when the recorder delays its final data event.
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.recording = false;
    return this.result;
  }
  cancel(): void {
    ++this.generation;
    this.pending = null;
    try { if (this.recorder?.state === 'recording') this.recorder.stop(); } catch { /* already stopped */ }
    this.cleanup(null);
  }
  private cleanup(blob: Blob | null): void {
    clearTimeout(this.timer); this.recording = false;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.recorder = null;
    this.finish?.(blob); this.finish = null;
  }
}
