// OWNER: mahin
import type { BuildingModule } from "./types";
import { createKit, type KitRecording } from "./primitives";
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
export function validateRecording(
  r: KitRecording,
  mode: "exterior" | "interior",
): ValidationResult {
  const errors: string[] = [];
  if (mode === "exterior") {
    if (r.entrances.length !== 1) errors.push("Exactly one entrance required");
    if (r.signs.length !== 1) errors.push("Exactly one sign required");
    for (const e of r.entrances)
      if (e.z < 6 || e.z > 11) errors.push("Entrance z outside [6,11]");
    for (const s of r.signs)
      if (s.pos[1] < 3.2 || s.pos[1] > 6)
        errors.push("Sign height outside [3.2,6]");
  } else {
    const ids = new Set(r.slots.map((s) => s.id));
    if (
      r.slots.length !== 6 ||
      ids.size !== 6 ||
      ![1, 2, 3, 4, 5, 6].every((i) => ids.has(`s${i}` as "s1"))
    )
      errors.push("Exactly s1..s6 required");
    for (const s of r.slots) {
      if (
        Math.abs(s.pos[0]) > 8.2 ||
        Math.abs(s.pos[2]) > 6.2 ||
        Math.abs(s.pos[1]) > 0.01
      )
        errors.push(`Invalid slot ${s.id}`);
      for (const t of r.slots)
        if (
          s !== t &&
          Math.hypot(s.pos[0] - t.pos[0], s.pos[2] - t.pos[2]) < 1.6
        )
          errors.push("Slots too close");
    }
  }
  if (r.lights.length > (mode === "exterior" ? 1 : 3))
    errors.push("Module light budget exceeded");
  if (r.triangles > (mode === "exterior" ? 250000 : 400000))
    errors.push("Triangle budget exceeded");
  const b = r.bounds,
    limit = mode === "exterior" ? 13 : 9,
    z = mode === "exterior" ? 13 : 7;
  if (
    !b.isEmpty() &&
    (b.min.x < -limit - 0.15 ||
      b.max.x > limit + 0.15 ||
      b.min.z < -z - 0.15 ||
      b.max.z > z + 0.15 ||
      b.min.y < -0.15 ||
      b.max.y > (mode === "exterior" ? 30 : 4.4))
  )
    errors.push("Geometry outside bounds");
  return { valid: errors.length === 0, errors };
}
export function validateModule(module: BuildingModule): ValidationResult {
  const errors: string[] = [];
  if (
    !module ||
    typeof module.id !== "string" ||
    typeof module.buildExterior !== "function" ||
    typeof module.buildInterior !== "function"
  )
    return { valid: false, errors: ["Invalid module shape"] };
  for (const mode of ["exterior", "interior"] as const) {
    const b = createKit({
      mode,
      departmentId: module.id,
      shell: module.interiorShell,
    });
    try {
      module[mode === "exterior" ? "buildExterior" : "buildInterior"](b.kit);
      b.finalize();
      errors.push(
        ...validateRecording(b.recording, mode).errors.map(
          (e) => `${mode}: ${e}`,
        ),
      );
    } catch (e) {
      errors.push(`${mode}: ${String(e)}`);
    } finally {
      b.dispose();
    }
  }
  return { valid: !errors.length, errors };
}
