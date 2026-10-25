// OWNER: mahin
import { describe, it, expect } from "vitest";
import { Box3, Mesh } from "three";
import { createKit } from "../../../src/world/kit/primitives";
import { fallbackModule } from "../../../src/world/buildings/fallback/archetypes";
import { recordKit, runProbes } from "../../../src/world/probes/probes";
import manifest from "../../../src/world/data/manifest.fallback.json";
import type { Vec3 } from "../../../src/world/kit/types";
describe("real fallback recorded builds", () => {
  for (const building of manifest.buildings)
    for (const mode of ["exterior", "interior"] as const) {
      it(`${building.department_id} ${mode} geometry passes (P10 is browser-only)`, () => {
        const built = createKit({ mode, departmentId: building.department_id });
        try {
          const recorder = recordKit(built.kit),
            module = fallbackModule(building.department_id);
          if (mode === "exterior") module.buildExterior(recorder.kit);
          else module.buildInterior(recorder.kit);
          built.finalize();
          const bounds: { min: Vec3; max: Vec3 }[] = [];
          built.group.traverse((object) => {
            if (object instanceof Mesh) {
              const box = new Box3().setFromObject(object);
              bounds.push({
                min: box.min.toArray() as Vec3,
                max: box.max.toArray() as Vec3,
              });
            }
          });
          const result = runProbes({
            building: building.department_id,
            mode,
            source: "fallback",
            recording: recorder.recording,
            bounds,
            triangles: built.recording.triangles,
            drawCalls: built.recording.drawCalls,
          });
          expect(
            result.probes.filter((p) => p.id !== "P10" && !p.pass),
          ).toEqual([]);
          if (mode === "exterior")
            expect(result.probes.find((p) => p.id === "P10")?.pass).toBe(false);
        } finally {
          built.dispose();
        }
      });
    }
});
