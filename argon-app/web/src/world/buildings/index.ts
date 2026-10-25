// OWNER: mahin
import { generatedModules } from "./generated";
import { fallbackModule } from "./fallback/archetypes";
import { createKit, type KitOptions } from "../kit/primitives";
import { validateRecording } from "../kit/validateModule";
import type { BuildingModule } from "../kit/types";
export { fallbackModule };
export function getModule(dept: string): BuildingModule {
  return generatedModules[dept] ?? fallbackModule(dept);
}
export function buildBuilding(
  dept: string,
  mode: "exterior" | "interior",
  options: Omit<KitOptions, "mode" | "departmentId"> & {
    source?: "generated" | "fallback";
    module?: BuildingModule;
  } = {},
) {
  let module =
    options.module ??
    (options.source === "fallback" ? fallbackModule(dept) : getModule(dept));
  let fallbackUsed = !(
    options.module ||
    (options.source !== "fallback" && generatedModules[dept])
  );
  const build = (m: BuildingModule) => {
    const b = createKit({
      ...options,
      mode,
      departmentId: dept,
      shell: options.shell ?? m.interiorShell,
    });
    try {
      m[mode === "exterior" ? "buildExterior" : "buildInterior"](b.kit);
      b.finalize();
      const result = validateRecording(b.recording, mode);
      if (!result.valid) throw new Error(result.errors.join("; "));
      return b;
    } catch (e) {
      b.dispose();
      throw e;
    }
  };
  try {
    return { ...build(module), module, fallbackUsed };
  } catch (error) {
    if (fallbackUsed) throw error;
    console.warn(`Building ${dept} failed, using fallback`, error);
    module = fallbackModule(dept);
    fallbackUsed = true;
    return { ...build(module), module, fallbackUsed };
  }
}
if (import.meta.hot)
  import.meta.hot.accept("./generated", () => {
    window.dispatchEvent(new CustomEvent("foundry:buildings-changed"));
  });
