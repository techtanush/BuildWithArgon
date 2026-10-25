// OWNER: mahin
import { describe, expect, it, vi } from "vitest";
import { Mesh } from "three";
import type { XZ, Manifest } from "../../../src/shared/contracts";
import { Race } from "../../../src/world/nav/Race";
import { GhostCar, sampleRoadPath } from "../../../src/world/vehicle/GhostCar";
import { createUrbanManifest, cityOnRoad } from "../../../src/world/city/urbanLayout";
import { RoadGraph } from "../../../src/world/nav/RoadGraph";
import data from "../../../src/world/data/manifest.fallback.json";

const route: XZ[] = [[0, 0], [0, 72], [72, 72], [72, 144]];
const start: XZ = [0, 0];
function ghost(race: Race) { return race.group.getObjectByName("Route ghost / scripted pace car"); }
function driveGates(race: Race, seconds = 0.1) {
  for (const checkpoint of race.checkpoints) race.update(seconds, checkpoint.pos);
}

describe("road-following scripted rival", () => {
  it("samples full road segments, turns at the corner, and clamps to the endpoint", () => {
    expect(sampleRoadPath(route, 36)?.pos).toEqual([0, 36]);
    expect(sampleRoadPath(route, 90)?.pos).toEqual([18, 72]);
    expect(sampleRoadPath(route, 180)?.pos).toEqual([72, 108]);
    expect(sampleRoadPath(route, 10000)?.pos).toEqual([72, 144]);
    expect(sampleRoadPath(route, -100)?.pos).toEqual([0, 0]);
    expect(sampleRoadPath(route, 90)?.heading).toBeCloseTo(-Math.PI / 2);
  });

  it("handles duplicate nodes, empty paths, and single-node routes deterministically", () => {
    expect(sampleRoadPath([], 3)).toBeNull();
    expect(sampleRoadPath([[3, 5]], 100)?.pos).toEqual([3, 5]);
    expect(sampleRoadPath([[0, 0], [0, 0], [0, 10]], 5)?.pos).toEqual([0, 5]);
  });

  it("moves by elapsed time on the same polyline and follows terrain", () => {
    const rival = new GhostCar(route, 18);
    rival.update(5, (x, z) => x * .1 + z * .2);
    expect(rival.group.position.x).toBeCloseTo(18);
    expect(rival.group.position.z).toBeCloseTo(72);
    expect(rival.group.position.y).toBeCloseTo(16.2);
    expect(rival.distance).toBe(90);
    expect(rival.finished).toBe(false);
    rival.update(100);
    expect(rival.group.position.toArray()).toEqual([72, 0, 144]);
    expect(rival.finished).toBe(true);
    rival.dispose();
    rival.dispose();
    expect(rival.group.children).toHaveLength(0);
  });

  it("copies its source route so external mutations cannot redirect the rival", () => {
    const path: XZ[] = [[0, 0], [0, 100]];
    const rival = new GhostCar(path, 10);
    path[1][0] = 500;
    rival.update(5);
    expect(rival.group.position.toArray()).toEqual([0, 0, 50]);
    rival.dispose();
  });

  it("stays on streets for every distinct urban department-to-department path", () => {
    const city = createUrbanManifest(data as Manifest), graph = new RoadGraph(city.roads);
    for (const from of city.buildings) for (const to of city.buildings) {
      if (from === to) continue;
      const path = graph.path(graph.nodes.get(from.door_node)!.pos, to.door_node);
      const rival = new GhostCar(path);
      for (let d = 0; d <= rival.length; d += 4) {
        const pose = sampleRoadPath(path, d)!;
        expect(cityOnRoad(...pose.pos)).toBe(true);
      }
      rival.dispose();
    }
  });
});

describe("department race countdown and lifecycle", () => {
  it("shows 3, 2, 1 for one second each, freezes until GO, and keeps the ghost still", () => {
    const race = new Race();
    race.start(route, "department");
    expect(race.countdownLabel).toBe("3");
    expect(race.frozen).toBe(true);
    const rival = ghost(race)!;
    for (const [seconds, label] of [[.999, "3"], [.001, "2"], [1, "1"], [.999, "1"]] as const) {
      race.update(seconds, start);
      expect(race.countdownLabel).toBe(label);
      expect(race.frozen).toBe(true);
      expect(race.elapsed).toBe(0);
      expect(rival.position.toArray()).toEqual([0, 0, 0]);
    }
    race.update(.001, start);
    expect(race.state).toBe("running");
    expect(race.countdown).toBe(0);
    expect(race.countdownLabel).toBe("GO");
    expect(race.go).toBe(true);
    expect(race.frozen).toBe(false);
    race.update(.5, start);
    expect(race.go).toBe(true);
    expect(rival.position.z).toBeCloseTo(9);
    race.update(.4, start);
    expect(race.countdownLabel).toBe("");
    expect(race.group.getObjectByName("Race start signal")?.visible).toBe(false);
    race.dispose();
  });

  it("uses real elapsed time across a long frame, carrying only GO overshoot into race time", () => {
    const race = new Race();
    race.start(route, "department");
    race.update(3.25, start);
    expect(race.state).toBe("running");
    expect(race.elapsed).toBeCloseTo(.25);
    expect(race.rivalProgress).toBeCloseTo(4.5);
    expect(ghost(race)?.position.z).toBeCloseTo(4.5);
    race.update(-4, start);
    race.update(NaN, start);
    expect(race.elapsed).toBeCloseTo(.25);
    race.dispose();
  });

  it("resets legacy one-off terrain offsets during countdown and while driving", () => {
    const race = new Race({ heightAt: (x, z) => x * .1 + z * .2 });
    race.start([[0, 72], [72, 72], [72, 144]], "hill");
    const rival = ghost(race)!;
    rival.position.y += 100;
    race.update(.25, [0, 72]);
    expect(rival.position.y).toBeCloseTo(14.4);
    race.update(3.75, [0, 72]);
    expect(rival.position.toArray()).toEqual([18, 16.2, 72]);
    race.dispose();
  });

  it("cleans up every owned mesh on cancel and makes abandoned races inert", () => {
    const finish = vi.fn(), race = new Race({ onFinish: finish });
    race.start(route, "department");
    const rival = ghost(race)!;
    const mesh = rival.getObjectByProperty("type", "Mesh") as Mesh;
    const dispose = vi.spyOn(mesh.geometry, "dispose");
    race.cancel();
    expect(race.group.children).toHaveLength(0);
    expect(rival.parent).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(race.frozen).toBe(false);
    race.update(20, [72, 144]);
    expect(race.state).toBe("abandoned");
    expect(finish).not.toHaveBeenCalled();
    race.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("restart clears old rivals and resets progress, results, and countdown", () => {
    const race = new Race();
    race.start(route, "first");
    race.update(5, start);
    const old = ghost(race)!;
    expect(race.rivalProgress).toBe(36);
    race.start([[72, 72], [72, 216]], "second");
    expect(old.parent).toBeNull();
    expect(old.children).toHaveLength(0);
    expect(ghost(race)).not.toBe(old);
    expect(ghost(race)?.position.toArray()).toEqual([72, 0, 72]);
    expect(race.countdownLabel).toBe("3");
    expect(race.rivalProgress).toBe(0);
    expect(race.elapsed).toBe(0);
    expect(race.nextCheckpoint).toBe(0);
    expect(race.result).toBeNull();
    race.dispose();
  });

  it("finishes despite extra group children, preserves department bests, and notifies once", () => {
    const values = new Map<string, string>(), finish = vi.fn();
    const race = new Race({ storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }, onFinish: finish });
    race.start(route, "engineering");
    race.update(3, start);
    driveGates(race, 1);
    const best = race.result!.time;
    expect(race.state).toBe("finished");
    expect(race.result?.newBest).toBe(true);
    expect(race.group.children).toHaveLength(0);
    expect(values.get("foundry.race.best.engineering")).toBe(String(best));
    race.update(1.19, route.at(-1)!);
    expect(finish).not.toHaveBeenCalled();
    race.update(.01, route.at(-1)!);
    race.update(5, route.at(-1)!);
    expect(finish).toHaveBeenCalledTimes(1);
    race.start(route, "engineering");
    race.update(3, start);
    driveGates(race, 2);
    expect(race.result?.newBest).toBe(false);
    expect(race.result?.best).toBe(best);
    race.start(route, "design");
    race.update(3, start);
    driveGates(race, 2);
    expect(race.result?.newBest).toBe(true);
    expect(values.has("foundry.race.best.design")).toBe(true);
    race.dispose();
  });

  it("dispose during countdown cancels callbacks, and invalid routes do not allocate visuals", () => {
    const finish = vi.fn(), race = new Race({ onFinish: finish });
    race.start(route, "department");
    race.dispose();
    race.update(100, [72, 144]);
    expect(race.state).toBe("abandoned");
    expect(race.group.children).toHaveLength(0);
    expect(finish).not.toHaveBeenCalled();
    race.start([[0, 0], [0, 0]], "empty");
    expect(race.state).toBe("idle");
    expect(race.group.children).toHaveLength(0);
    expect(race.frozen).toBe(false);
    race.dispose();
  });
});
