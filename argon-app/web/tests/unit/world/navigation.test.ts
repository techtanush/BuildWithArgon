// OWNER: mahin
import { describe, it, expect } from "vitest";
import { RoadGraph, pathLength } from "../../../src/world/nav/RoadGraph";
import { astar } from "../../../src/world/nav/astar";
import { Race, makeCheckpoints } from "../../../src/world/nav/Race";
import { approachPose, FastTravel } from "../../../src/world/nav/FastTravel";
import { Player } from "../../../src/world/player/Player";
import { Car } from "../../../src/world/vehicle/Car";
describe("navigation", () => {
  it("routes spawn to all 13 department doors", () => {
    const g = new RoadGraph();
    for (let i = 0; i < 13; i++) {
      const p = g.path([0, 16], `D${i}`);
      expect(p[0]).toEqual([0, 16]);
      expect(p.at(-1)).toEqual(g.nodes.get(`D${i}`)!.pos);
    }
  });
  it("takes the specified 181±5m north route", () => {
    const g = new RoadGraph(),
      p = g.path([0, 16], "D0");
    expect([g.nodes.get("E6")!.pos, g.nodes.get("E7")!.pos]).toContainEqual(
      p[1],
    );
    expect(Math.abs(pathLength(p) - 181)).toBeLessThanOrEqual(5);
  });
  it("takes the short ring direction and rejects missing targets", () => {
    const g = new RoadGraph();
    expect(astar(g, "R0", "R12")).toEqual(["R0", "M12", "R12"]);
    expect(g.path([0, 16], "missing")).toEqual([]);
  });
  it("spaces bounded checkpoints and ends exactly at the door", () => {
    const path = new RoadGraph().path([0, 16], "D0"),
      cp = makeCheckpoints(path);
    expect(cp.length).toBeGreaterThanOrEqual(3);
    expect(cp.length).toBeLessThanOrEqual(10);
    expect(cp.at(-1)!.pos[0]).toBeCloseTo(path.at(-1)![0]);
    expect(cp.at(-1)!.pos[1]).toBeCloseTo(path.at(-1)![1]);
    expect(
      makeCheckpoints([
        [0, 0],
        [1000, 0],
      ]),
    ).toHaveLength(10);
  });
  it("enforces checkpoint order and safely survives denied storage", () => {
    const r = new Race({
      storage: {
        getItem() {
          throw Error("denied");
        },
        setItem() {
          throw Error("denied");
        },
      },
    });
    r.start(
      [
        [0, 0],
        [0, 180],
      ],
      "b-test",
    );
    for (let i = 0; i < 12; i++) r.update(0.25, [0, 180]);
    expect(r.state).toBe("running");
    expect(r.nextCheckpoint).toBe(0);
    r.update(0.1, [20, 180]);
    for (const cp of r.checkpoints) r.update(0.1, cp.pos);
    expect(r.state).toBe("finished");
    expect(r.result?.newBest).toBe(true);
    r.dispose();
  });
  it("places travel in front of an NPC looking back toward them", () => {
    expect(approachPose([0, 0, 0], 0)).toEqual({ pos: [0, 1.65, 2], yaw: 0 });
  });
  it("travels and marks repeat greetings", async () => {
    const greetings: boolean[] = [];
    const f = new FastTravel({
      fade() {},
      switchScene() {},
      engage(_id, returning) {
        greetings.push(returning);
      },
      wait: async () => {},
    });
    const t = {
      agentId: "test",
      scene: "city",
      name: "Plaza",
      pos: [0, 0, 0] as [number, number, number],
      facingY: 0,
    };
    await f.travel(t);
    await f.travel(t);
    expect(greetings).toEqual([false, true]);
  });
  it("moves forward without diagonal speed boost", () => {
    const p = new Player();
    for (let i = 0; i < 60; i++) p.update(1 / 60, { forward: 1, right: 1 });
    expect(Math.hypot(p.velocity.x, p.velocity.z)).toBeLessThanOrEqual(4.5);
    expect(p.position.z).toBeLessThan(16);
    p.dispose();
  });
  it("car steers only while moving and respects offroad cap", () => {
    const c = new Car();
    c.update(0.1, { throttle: 0, steer: 1 });
    expect(c.state.heading).toBe(0);
    for (let i = 0; i < 300; i++)
      c.update(1 / 60, { throttle: 1, steer: 0 }, [], () => false);
    expect(c.state.speed).toBeLessThanOrEqual(14);
    expect(c.state.z).toBeLessThan(18);
    c.dispose();
  });
});
