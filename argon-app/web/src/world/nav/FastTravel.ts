// OWNER: mahin
export interface TravelTarget {
  agentId: string;
  scene: string;
  name: string;
  pos: [number, number, number];
  facingY: number;
}
export interface TravelPose {
  pos: [number, number, number];
  yaw: number;
}
export function approachPose(
  pos: readonly number[],
  facingY: number,
  distance = 2,
): TravelPose {
  return {
    pos: [
      pos[0] + Math.sin(facingY) * distance,
      1.65,
      pos[2] + Math.cos(facingY) * distance,
    ],
    yaw: facingY,
  };
}
export interface FastTravelHooks {
  fade: (
    black: boolean,
    durationMs: number,
    label?: string,
  ) => void | Promise<void>;
  switchScene: (scene: string, pose: TravelPose) => void | Promise<void>;
  engage: (agentId: string, returning: boolean) => void | Promise<void>;
  wait?: (ms: number) => Promise<void>;
}
/** Engine owns scene changes and fades; generation token prevents stale automatic engagement. */
export class FastTravel {
  private generation = 0;
  private visited = new Set<string>();
  active = false;
  constructor(private hooks: FastTravelHooks) {}
  cancel(): void {
    this.generation++;
    this.active = false;
    void this.hooks.fade(false, 300);
  }
  async travel(target: TravelTarget): Promise<boolean> {
    const token = ++this.generation,
      wait =
        this.hooks.wait ??
        ((ms: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.active = true;
    try {
      await Promise.all([
        this.hooks.fade(true, 300, `Heading to ${target.name}…`),
        wait(400),
      ]);
      if (token !== this.generation) return false;
      await this.hooks.switchScene(
        target.scene,
        approachPose(target.pos, target.facingY),
      );
      if (token !== this.generation) return false;
      await this.hooks.fade(false, 300);
      await wait(500);
      if (token !== this.generation) return false;
      const returning = this.visited.has(target.agentId);
      this.visited.add(target.agentId);
      await this.hooks.engage(target.agentId, returning);
      return true;
    } finally {
      if (token === this.generation) {
        this.active = false;
        await this.hooks.fade(false, 0);
      }
    }
  }
}
export default FastTravel;
