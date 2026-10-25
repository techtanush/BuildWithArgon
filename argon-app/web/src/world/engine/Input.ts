// OWNER: mahin
export class Input {
  readonly keys = new Set<string>();
  private drag = false;
  private disposers: (() => void)[] = [];
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
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (
        [
          "Space",
          "ArrowUp",
          "ArrowDown",
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
        ].includes(e.code)
      )
        e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat) this.action(e.code, true);
    }) as EventListener);
    on(window, "keyup", ((e: KeyboardEvent) => {
      this.keys.delete(e.code);
      this.action(e.code, false);
    }) as EventListener);
    on(window, "blur", (() => {
      this.keys.clear();
      this.drag = false;
      this.action("KeyV", false);
    }) as EventListener);
    on(canvas, "pointerdown", (() => {
      this.drag = true;
      if (document.pointerLockElement !== canvas) {
        try {
          const p = canvas.requestPointerLock();
          p?.catch?.(() => {});
        } catch {}
      }
    }) as EventListener);
    on(window, "pointerup", (() => {
      this.drag = false;
    }) as EventListener);
    on(window, "mousemove", ((e: MouseEvent) => {
      if (document.pointerLockElement === canvas || this.drag)
        this.look(e.movementX, e.movementY);
    }) as EventListener);
  }
  down(code: string) {
    return this.keys.has(code);
  }
  unlock() {
    this.keys.clear();
    this.drag = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  dispose() {
    this.unlock();
    this.disposers.forEach((d) => d());
  }
}
