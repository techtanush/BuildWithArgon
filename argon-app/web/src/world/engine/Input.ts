// OWNER: mahin
export class Input {
  readonly keys = new Set<string>();
  private disposers: (() => void)[] = [];
  private editable(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
    );
  }
  get blocked(): boolean {
    return this.editable(document.activeElement) || !!document.querySelector(
      '[role="dialog"][aria-modal="true"]:not([hidden]),dialog[open]',
    );
  }
  clear() {
    const held = [...this.keys];
    this.keys.clear();
    held.forEach((key) => this.action(key, false));
  }
  constructor(
    readonly canvas: HTMLCanvasElement,
    private look: (dx: number, dy: number) => void,
    private action: (code: string, down: boolean) => void,
  ) {
    const on = (target: EventTarget, type: string, listener: EventListener) => {
      target.addEventListener(type, listener);
      this.disposers.push(() => target.removeEventListener(type, listener));
    };
    on(window, "keydown", ((e: KeyboardEvent) => {
      if (this.editable(e.target) || this.editable(document.activeElement)) {
        this.clear();
        return;
      }
      if (this.blocked && e.code !== "Escape") {
        this.clear();
        return;
      }
      // A held key must be released and pressed again after focus is lost.
      if (e.repeat && !this.keys.has(e.code)) return;
      if (["Space", "ArrowUp", "ArrowDown", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code))
        e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat) this.action(e.code, true);
    }) as EventListener);
    on(window, "keyup", ((e: KeyboardEvent) => {
      if (this.keys.delete(e.code)) this.action(e.code, false);
    }) as EventListener);
    on(window, "blur", (() => this.clear()) as EventListener);
    on(document, "visibilitychange", (() => { if (document.hidden) this.clear(); }) as EventListener);
    on(document, "focusin", ((e: FocusEvent) => {
      if (this.editable(e.target) || this.blocked) this.clear();
    }) as EventListener);
    on(canvas, "pointerdown", (() => {
      if (this.blocked) return;
      if (document.pointerLockElement !== canvas) {
        try {
          const p = canvas.requestPointerLock();
          p?.catch?.(() => {});
        } catch {}
      }
    }) as EventListener);
    on(window, "mousemove", ((e: MouseEvent) => {
      if (!this.blocked && document.pointerLockElement === canvas)
        this.look(e.movementX, e.movementY);
    }) as EventListener);
  }
  down(code: string) {
    if (this.blocked) { this.clear(); return false; }
    return this.keys.has(code);
  }
  unlock() {
    this.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  dispose() {
    this.unlock();
    this.disposers.forEach((d) => d());
  }
}
