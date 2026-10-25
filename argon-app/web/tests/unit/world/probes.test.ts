// OWNER: mahin
import { describe, it, expect } from "vitest";
import {
  colliderDistance,
  overlapVolume,
  runProbes,
  unreachableSlots,
  type ProbeCollider,
  type ProbeEvidence,
  type ProbeRecording,
} from "../../../src/world/probes/probes";
const box = (x = 0, z = 0): ProbeCollider => ({
  x,
  z,
  halfX: 0.5,
  halfZ: 0.5,
  yaw: 0,
  minY: 0,
  maxY: 1,
});
const recording = (): ProbeRecording => ({
  calls: 20,
  colliders: [],
  slots: [
    [-5, -2],
    [5, -2],
    [-2.5, 1.5],
    [2.5, 1.5],
    [-6, 3.5],
    [6, 3.5],
  ].map(([x, z], i) => ({ id: `s${i + 1}`, pos: [x, 0, z], facingY: 0 })),
  entrances: [],
  signs: [],
  lights: 1,
});
const evidence = (): ProbeEvidence => ({
  building: "engineering",
  mode: "interior",
  source: "fallback",
  recording: recording(),
  bounds: [{ min: [-8, 0, -6], max: [8, 4, 6] }],
  triangles: 2000,
  drawCalls: 12,
});
const pass = (e: ProbeEvidence, id: string) =>
  runProbes(e).probes.find((p) => p.id === id)?.pass;
describe("pure recorded geometry probes", () => {
  it("reports required interior checks and no screenshot P9", () => {
    const result = runProbes(evidence());
    expect(result.probes.map((p) => p.id)).toEqual([
      "P1",
      "P2",
      "P4",
      "P5",
      "P6",
      "P7",
      "P8",
    ]);
    expect(result.probes.every((p) => p.pass)).toBe(true);
  });
  it("reports exception and console failure instead of an always-pass load check", () => {
    const e = evidence();
    e.consoleErrors = ["shader failed"];
    expect(pass(e, "P1")).toBe(false);
    e.consoleErrors = [];
    e.buildError = "build failed";
    expect(pass(e, "P1")).toBe(false);
  });
  it("enforces bound tolerance and finite geometry", () => {
    const e = evidence();
    e.bounds[0].max[0] = 9.051;
    expect(pass(e, "P2")).toBe(false);
    e.bounds[0].max[0] = 9.049;
    expect(pass(e, "P2")).toBe(true);
    e.bounds[0].min[0] = NaN;
    expect(pass(e, "P2")).toBe(false);
  });
  it("rejects duplicate slots and blocked approaches", () => {
    const e = evidence();
    e.recording.slots[1].id = "s1";
    expect(pass(e, "P4")).toBe(false);
    e.recording = recording();
    e.recording.colliders = [{ ...box(0, 4.8), halfX: 9, halfZ: 0.2 }];
    expect(unreachableSlots(e.recording)).toContain("s1");
    expect(pass(e, "P5")).toBe(false);
  });
  it("detects slot wall clearance and spacing", () => {
    const e = evidence();
    e.recording.slots[0].pos = [8.3, 0, 0];
    expect(pass(e, "P4")).toBe(false);
    e.recording = recording();
    e.recording.slots[1].pos = [-4.9, 0, -2];
    expect(pass(e, "P4")).toBe(false);
  });
  it("uses oriented distances rather than axis aligned shortcuts", () => {
    const c = { ...box(), halfX: 2, halfZ: 0.2, yaw: Math.PI / 2 };
    expect(colliderDistance(c, 0, 1)).toBe(0);
    expect(colliderDistance(c, 1, 0)).toBeCloseTo(0.8);
  });
  it("computes collider intersection volume including vertical separation", () => {
    expect(overlapVolume(box(), box(0.5, 0))).toBeCloseTo(0.5);
    expect(overlapVolume(box(), { ...box(), minY: 2, maxY: 3 })).toBe(0);
    expect(
      overlapVolume(box(), { ...box(), yaw: Math.PI / 4 }),
    ).toBeGreaterThan(0.8);
  });
  it("fails overlap, excessive lights and real budget excess", () => {
    const e = evidence();
    e.recording.colliders = [box(), box(0.5)];
    expect(pass(e, "P6")).toBe(false);
    e.recording.lights = 4;
    expect(pass(e, "P8")).toBe(false);
    e.drawCalls = 151;
    expect(pass(e, "P7")).toBe(false);
    e.drawCalls = 20;
    e.triangles = 400001;
    expect(pass(e, "P7")).toBe(false);
  });
  it("requires measured sign area and unoccluded raycast on exterior", () => {
    const e = evidence();
    e.mode = "exterior";
    e.recording.entrances = [{ z: 8 }];
    e.recording.signs = [{ pos: [0, 5, 6], width: 6 }];
    expect(pass(e, "P3")).toBe(true);
    expect(pass(e, "P10")).toBe(false);
    e.signVisibility = { areaRatio: 0.015, unoccluded: true };
    expect(pass(e, "P10")).toBe(true);
    e.signVisibility.unoccluded = false;
    expect(pass(e, "P10")).toBe(false);
    e.recording.colliders = [box(0, 9)];
    expect(pass(e, "P3")).toBe(false);
  });
  it("portrait emits no probes", () => {
    const e = evidence();
    e.mode = "portrait";
    expect(runProbes(e).probes).toEqual([]);
  });
});
