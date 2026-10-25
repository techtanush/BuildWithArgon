# 09 — World Generation with Argon

> **Hackathon context — Problem Statement 2.** Generating all 13 buildings in one long-decode pass
> shows Argon's single-pass 3D/world generation; the loop in
> [`10-render-critique-loop.md`](10-render-critique-loop.md) turns that first draft into the final town.

Argon writes the 13 building modules — exterior and interior — as TypeScript against the look-kit
API, **in one long-decode pass** so the buildings are consistent with each other. The modules are
then validated and improved by the render → critique → fix loop
([`10-render-critique-loop.md`](10-render-critique-loop.md)). Everything here is an offline CLI:
`uv run foundry-worldgen ...` (kernel), using `pnpm` scripts in `web/` for type-checking and capture.

## CLI (`worldgen/cli.py`)

```
foundry-worldgen faces              # FaceSpecs (Argon) -> kernel/data/faces.json
foundry-worldgen portraits --from-renders  # avatar headshots from the capture page (+ optional Nano Banana polish) -> web/public/generated/portraits/
foundry-worldgen signs              # Nano Banana realistic signs -> web/public/generated/signs/
                                    # (textures come from the CC0 asset pipeline, not worldgen — 12-photoreal-look.md)
foundry-worldgen buildings          # one-pass generation of 13 modules (iteration 0)
foundry-worldgen loop --max-iter 4  # render -> probe -> critique -> patch, keeps best per building
foundry-worldgen all                # faces, signs, buildings, loop, portraits (in that order)
foundry-worldgen --all              # alias for all
foundry-worldgen report             # prints the score table of the latest run
```

Each command writes under `kernel/data/worldgen/runs/<run_id>/` (`run_id = wgr_<ULID>`):
`prompt.md`, `output.txt` (raw model output), `modules/iter-<n>/<dept>.ts`,
`captures/iter-<n>/<dept>/{ext-1,ext-2,ext-3,int-1,int-2,int-3}.png`,
`probes/iter-<n>/<dept>.json`, `critic/iter-<n>/<dept>.json`, `scores.json`, and rows in
`worldgen_runs` / `worldgen_iterations`. These records are the evidence of the loop — commit them.

## The kit API contract (`web/src/world/kit/types.ts`) — given verbatim to Argon

```ts
export type Vec3 = [number, number, number];

export type MaterialKey =
  | 'wood_floor' | 'wood_dark' | 'wood_light' | 'plaster_wall' | 'plaster_warm' | 'trim'
  | 'brick' | 'stucco' | 'roof' | 'roof_red' | 'plaza_stone' | 'metal_dark' | 'metal_light'
  | 'glass' | 'window_glow' | 'screen' | 'paper' | 'fabric_lavender' | 'fabric_blue'
  | 'fabric_pink' | 'fabric_cream' | 'fabric_coral' | 'fabric_coral_dark' | 'cable' | 'plant'
  | 'pot' | 'accent' | 'accent_dark';

export type PropKind =
  | 'desk' | 'chair' | 'armchair' | 'sofa' | 'table_round' | 'table_long' | 'bookshelf'
  | 'plant_small' | 'plant_tall' | 'lamp_floor' | 'lamp_desk' | 'screen_stand' | 'whiteboard'
  | 'counter' | 'crate' | 'barrel' | 'bench' | 'telescope' | 'clock' | 'vault_door' | 'workbench'
  | 'server_rack' | 'flowerbed' | 'mailbox' | 'flag' | 'easel' | 'filing_cabinet' | 'mug' | 'books';

export interface BoxOpts {
  size: Vec3;                 // width (x), height (y), depth (z)
  pos: Vec3;                  // center of the box
  rotY?: number;              // radians
  mat: MaterialKey;
  collide?: boolean;          // default false
  castShadow?: boolean;       // default true
  name?: string;
}

export interface KitApi {
  /** Rectangular solid. */
  box(o: BoxOpts): void;
  /** Rectangular solid with rounded edges (radius ≤ 0.5·min(size)). */
  roundedBox(o: BoxOpts & { radius: number }): void;
  cylinder(o: { radiusTop: number; radiusBottom: number; height: number; pos: Vec3; rotY?: number;
                rotX?: number; rotZ?: number; mat: MaterialKey; collide?: boolean; segments?: number; name?: string }): void;
  sphere(o: { radius: number; pos: Vec3; scale?: Vec3; mat: MaterialKey; collide?: boolean; name?: string }): void;
  cone(o: { radius: number; height: number; pos: Vec3; rotY?: number; mat: MaterialKey; segments?: number; name?: string }): void;
  torus(o: { radius: number; tube: number; pos: Vec3; rotX?: number; rotY?: number; arc?: number; mat: MaterialKey; name?: string }): void;
  /** Smooth tube through points (cables, rails). */
  tube(o: { points: Vec3[]; radius: number; mat: MaterialKey; name?: string }): void;
  /** Flat panel; rot in radians [x, y, z]. No collider. */
  plane(o: { size: [number, number]; pos: Vec3; rot: Vec3; mat: MaterialKey; name?: string }): void;
  /** Prefab furniture/props from the kit library, sized for a 1.75 m person. */
  prop(o: { kind: PropKind; pos: Vec3; rotY?: number; scale?: number; mat?: MaterialKey; collide?: boolean }): void;
  /** Up to 3 per interior, 1 per exterior. No shadows. */
  light(o: { kind: 'point' | 'spot'; pos: Vec3; color: string; intensity: number; distance: number; target?: Vec3 }): void;
  /** EXTERIOR ONLY. Exactly once. Door on the front face (local +Z), centered at x = 0. */
  entrance(o: { z: number }): void;
  /** EXTERIOR ONLY. Exactly once. The building's name sign (4:1 aspect). */
  sign(o: { pos: Vec3; rotY?: number; width: number }): void;
  /** INTERIOR ONLY. Window cut into a wall (glowing panel + frame). Never on 'south'. */
  window(o: { wall: 'north' | 'east' | 'west'; center: number; width: number; height: number; sill: number }): void;
  /** INTERIOR ONLY. Exactly s1..s6. facingY: 0 faces +Z (toward the door). */
  npcSlot(o: { id: 's1' | 's2' | 's3' | 's4' | 's5' | 's6'; pos: Vec3; facingY: number }): void;
  /** Group subsequent calls for readability (no transform). */
  group(name: string, fn: () => void): void;

  readonly mode: 'exterior' | 'interior';
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
  readonly colors: { accent: string; accentDark: string };
  readonly rand: () => number;          // deterministic per building
}

export interface BuildingModule {
  id: string;                            // department id, e.g. 'engineering'
  interiorShell?: { floor?: MaterialKey; walls?: MaterialKey };
  buildExterior(k: KitApi): void;
  buildInterior(k: KitApi): void;
}
```

A generated file looks like:

```ts
import type { BuildingModule, KitApi } from '../../kit/types';

const building: BuildingModule = {
  id: 'engineering',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },
  buildExterior(k: KitApi) {
    k.box({ size: [22, 9, 18], pos: [0, 4.5, -1], mat: 'brick', collide: true });
    // ... sawtooth roof, chimney, roll-up door area ...
    k.entrance({ z: 8 });
    k.sign({ pos: [0, 6.2, 8.15], width: 6 });
  },
  buildInterior(k: KitApi) {
    k.window({ wall: 'north', center: -4, width: 3, height: 2, sill: 1.0 });
    k.prop({ kind: 'workbench', pos: [-5, 0, -3], rotY: 0, collide: true });
    k.npcSlot({ id: 's1', pos: [-2.5, 0, -1.5], facingY: 0 });
    // ...
  },
};
export default building;
```

The kit implementation (`kit/primitives.ts`) records every call, builds meshes, converts
`collide: true` shapes into colliders, merges static geometry by material at the end, and records
**everything the probes need** (calls, bounds, triangles, lights, slots, entrance, sign).

## Generation prompt (job `worldgen_buildings`, Argon high, long decode)

```text
### SYSTEM
You are the world builder for Foundry, a company town with 13 department buildings. Write 13
TypeScript building modules against the KIT API below. Output ONLY 13 FILE blocks:
<<<FILE path="web/src/world/buildings/generated/<department_id>.ts">>> ... <<<END FILE>>>
Each file must import only from '../../kit/types' and default-export a BuildingModule.
No other imports, no DOM, no network, no randomness except k.rand().
Follow DESIGN.md exactly. Make the 13 buildings consistent in style and clearly distinct in
silhouette. The town must look photoreal (quality bar below); the attached image is a composition
reference only.

### KIT API
{kit/types.ts verbatim}

### PROPS LIBRARY (real 3D models; sizes, origin at floor center)
{table of PropKind -> footprint w×d×h + note, generated from web/src/world/kit/props.contract.ts}

### RULES
{the "Rules that apply to every building" section of 05-world/04-buildings.md verbatim}

### DESIGN.md
{templates/DESIGN.md verbatim}

### BUILDINGS
{for each department: id, building name, department name, mission, color, and the brief row
 from 05-world/04-buildings.md}

### EXAMPLE (style and API usage; do not copy the design)
{fallback/archetypes.ts 'house' archetype source}

### PHOTOREAL QUALITY BAR
{05-world/12-photoreal-look.md §1 verbatim}

### COMPOSITION REFERENCE (layout and coziness only — the render style is photoreal)
(attached: reference-bedroom.png)
```

Settings: `max_output_tokens = 524288`, `background=True`, `thinking_level="high"`. Expected output
size ≈ 13 × 8–20 KB. If the output is truncated or any file is missing, generate missing buildings
one at a time with job `worldgen_building` (same prompt, one building, plus the already-generated
files' exterior sections as consistency context).

The reference image is attached as an image part (VERIFY V2). Convert
`architecture-files/assets/reference-bedroom.webp` to PNG with Pillow first (`worldgen/assets.py`).

## Validation (`worldgen/validate.py` + `web/src/world/kit/validateModule.ts`)

**Static (Python, before writing to `generated/`):**
1. File parses as FILE block with the expected path; size ≤ 60 KB.
2. Imports: exactly `import type { ... } from '../../kit/types';` — no other `import`/`require`.
3. Forbidden tokens (regex, outside comments/strings is not required — any occurrence fails):
   `fetch(`, `eval(`, `Function(`, `document.`, `window.`, `globalThis`, `localStorage`,
   `XMLHttpRequest`, `WebSocket`, `import(`, `process.`, `Math.random`, `setTimeout`, `setInterval`,
   `while (true)`, `for (;;)`.
4. Contains `id: '<department_id>'` and `export default`.

**Type check:** write to a staging dir `web/src/world/buildings/staging/` and run
`pnpm tsc --noEmit -p tsconfig.worldgen.json` (a tsconfig that includes only `kit/types.ts` and the
staging dir). Errors → captured into the critique input.

**Runtime probes:** in the capture page (next document).

## Registry

After the loop, `worldgen/score.py` writes `web/src/world/buildings/generated/registry.json`:

```json
{"run_id": "wgr_...", "generated_at": "...", "modules": {"engineering": {"status": "generated", "iteration": 2, "probe_score": 1.0, "visual_score": 0.82}, "pivot": {"status": "fallback", "reason": "P5 reachability failed after 4 iterations"}}}
```

and `generated/index.ts`:

```ts
import engineering from './engineering';
// ... 13 imports (only for status 'generated')
export const generatedModules = { engineering, /* ... */ } as const;
```

`buildings/index.ts`: `getModule(dept) = generatedModules[dept] ?? fallbackModule(dept)`, and at
runtime wraps `buildExterior/buildInterior` in try/catch → on exception, rebuild that building with
the fallback and log a console warning (never crash the world).
