// OWNER: mahin
export class Loop {
  private id = 0;
  private last = 0;
  private accumulator = 0;
  constructor(
    private update: (dt: number) => void,
    private render: (dt: number) => void,
  ) {}
  start() {
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.0833);
      this.last = now;
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= 1 / 60 && steps++ < 5) {
        this.update(1 / 60);
        this.accumulator -= 1 / 60;
      }
      this.render(dt);
      this.id = requestAnimationFrame(tick);
    };
    this.id = requestAnimationFrame(tick);
  }
  stop() {
    cancelAnimationFrame(this.id);
  }
}
