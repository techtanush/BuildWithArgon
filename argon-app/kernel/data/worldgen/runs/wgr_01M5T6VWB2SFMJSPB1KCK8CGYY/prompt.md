### SYSTEM
You are the world builder for Foundry, a company town with 13 department buildings. Write 13 TypeScript building
modules against the KIT API below. Output ONLY 13 FILE blocks:
<<<FILE path="web/src/world/buildings/generated/<department_id>.ts">>> ... <<<END FILE>>>
Each file must import only from '../../kit/types' and default-export a BuildingModule.
No other imports, no DOM, no network, no randomness except k.rand().
Follow DESIGN.md exactly. Make the 13 buildings consistent in style and clearly distinct in
silhouette. The town must look photoreal (quality bar below); the attached image is a composition
reference only.

### TASK
### KIT API
```ts
// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)
// Verbatim from architecture-files/05-world/09-worldgen-pipeline.md. Given to Argon as the KIT API.

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

### PROPS LIBRARY (real 3D models; sizes, origin at floor center)
| kind | w × d × h (m) | note |
|---|---|---|
| desk | 1.4 × 0.7 × 0.75 | work desk; front faces +Z |
| chair | 0.5 × 0.5 × 0.9 | office chair; seat 0.45 |
| armchair | 0.85 × 0.85 × 0.9 | upholstered |
| sofa | 2.0 × 0.9 × 0.85 | three-seat |
| table_round | 1.2 × 1.2 × 0.75 | diameter 1.2 |
| table_long | 3.0 × 1.1 × 0.76 | meeting / council table |
| bookshelf | 1.0 × 0.35 × 2.0 | filled with books |
| plant_small | 0.4 × 0.4 × 0.6 | potted |
| plant_tall | 0.6 × 0.6 × 1.7 | potted |
| lamp_floor | 0.4 × 0.4 × 1.6 | decorative; no light (use k.light) |
| lamp_desk | 0.2 × 0.2 × 0.45 | place on a desk (pos.y = 0.75) |
| screen_stand | 0.6 × 0.25 × 0.5 | monitor on stand; place on a desk |
| whiteboard | 1.8 × 0.1 × 1.9 | on legs; board 1.8 × 1.0 |
| counter | 2.0 × 0.6 × 1.05 | service counter |
| crate | 0.6 × 0.6 × 0.6 | wooden |
| barrel | 0.6 × 0.6 × 0.9 | diameter 0.6 |
| bench | 1.8 × 0.5 × 0.45 | seat bench |
| telescope | 0.8 × 0.8 × 1.6 | on tripod |
| clock | 0.5 × 0.08 × 0.5 | wall clock; pos.y = mount height |
| vault_door | 2.2 × 0.4 × 2.4 | round door in frame; decorative |
| workbench | 1.8 × 0.8 × 0.9 | tools on top |
| server_rack | 0.6 × 1.0 × 2.0 | blinking lights |
| flowerbed | 2.4 × 0.9 × 0.4 | raised bed with flowers |
| mailbox | 0.4 × 0.4 × 1.2 | on post |
| flag | 0.6 × 0.6 × 4.0 | pole with flag (flag 1.2 × 0.8 to +X) |
| easel | 0.7 × 0.6 × 1.7 | with canvas |
| filing_cabinet | 0.5 × 0.6 × 1.3 | 4 drawers |
| mug | 0.1 × 0.1 × 0.1 | place on a surface |
| books | 0.3 × 0.22 × 0.25 | small stack; place on a surface |

### RULES
**Exterior** (local coords: origin at plot center on the ground, +Z faces the plaza):
- Everything within x, z ∈ [−13, 13] (1 m margin inside the 28 × 28 plot), y ∈ [0, 30].
- Main body front face at local z between +6 and +11; exactly one `k.entrance({ z })` call on that
  face at x = 0 (door 1.6 × 2.6 m, coral exit-style frame, yellow ring placed by the kit 1.5 m in
  front). The 3 m in front of the door must be clear.
- Exactly one `k.sign({ pos, rotY: 0, width })` above or beside the entrance, readable from the
  driveway (sign center y between 3.2 and 6).
- At least 3 window panels (`window_glow` or `glass`) on the front face.
- Use `accent` (department color) visibly: trim, awning, roof band, door, or flag.
- Exterior triangle budget ≤ 60k; ≤ 1 module light (e.g., a lamp over the door).
- Landscaping inside the plot is encouraged (planters, benches, small trees via `k.prop`).

**Interior** (origin at room center floor; room x ∈ [−9, 9], z ∈ [−7, 7], height 4.2; the kit builds
floor, walls, ceiling, baseboards, ceiling lamp and the south entrance):
- `export const interiorShell = { floor: MaterialKey, walls: MaterialKey }` (defaults
  `wood_floor`, `plaster_wall`).
- 1–3 windows via `k.window(...)` on north/east/west walls (never south).
- Exactly 6 NPC slots `s1`…`s6` via `k.npcSlot({ id, pos, facingY })`, standing positions on the
  floor, ≥ 1.6 m apart, ≥ 0.8 m from walls, each with 1.2 m of clear floor in front (toward where
  the player stands to talk). `s1` is the department lead's spot and the first one you see from the
  door. Slots `s5`, `s6` are for future hires.
- A clear walkway (≥ 1.4 m wide) from the door (0, 6.2) to every slot's front point.
- Furniture that reflects the department (table below). Colliders (`collide: true`) for anything
  you shouldn't walk through; rugs/planes have no collider.
- ≤ 3 module lights; interior triangle budget ≤ 120k.
- Match the reference: soft wood floor, pale walls, rounded furniture, pastel fabrics, a rug, one
  or two "lived-in" details (a cable, a cushion, a mug), glowing windows.

Variety rule: no two buildings may share the same silhouette type (tower / dome / hall /
house / glass / columns / industrial / lighthouse / pier). The critic checks this across all 13.

### NOTES (clarifications of the rules above — these win where they differ)
- `interiorShell` is a field of the BuildingModule object (see KIT API), not a separate export.
- Triangle budgets are checked by probe P7: exterior <= 250,000, interior <= 400,000 incl. prop models; draw calls <= 150.
- Every module is checked by these probes: P1 loads (no exception, no console errors), P2 bounds (exterior x,z in [-13,13],
  y in [0,30]; interior x in [-9,9], z in [-7,7], y in [0,4.2]; 0.05 m tolerance), P3 entrance (exactly one entrance with
  z in [6,11], no collider within 1.5 m of the door ring, exactly one sign with y in [3.2,6]), P4 slots (exactly s1..s6,
  pairwise >= 1.6 m, >= 0.8 m from walls, not inside any collider), P5 reachability (0.25 m nav grid, colliders inflated by
  0.35 m; BFS from the door (0, 5.4) reaches the point 1.2 m in front of every slot along its facing), P6 overlap (no two
  colliders overlap by > 0.01 m3), P7 budget, P8 lights (interior <= 3, exterior <= 1), P9 non-blank renders,
  P10 sign visible from the front camera (0, 1.7, 30) without occlusion.
- Department id, building name and accent color for each module are listed under BUILDINGS; use `k.colors.accent`
  rather than hard-coding colors (the kit tints the 'accent'/'accent_dark' materials).

### DESIGN.md
# DESIGN.md — Visual rules for the Foundry town (photoreal)

These rules are given to Argon in every world-generation and critique prompt. The target is
**photoreal**: the town must look like a team of environment artists built it — an architectural
visualization you can walk through — never toy-like, low-poly, pixelated or "WebGL demo".
The kit turns your calls into real scanned PBR materials, real 3D prop models, HDRI lighting with a
physical sun, soft shadows and ambient occlusion (`architecture-files/05-world/12-photoreal-look.md`).
Your job is to give it architecture and rooms worth rendering.

## Mood

A prosperous, well-kept small town on a late-summer afternoon: warm golden sun, long soft
shadows, clean but lived-in. Interiors are inviting real workplaces — daylight from windows,
warm lamps, real furniture, a few personal touches. No text other than the building sign.

## Architecture (exteriors)

- Real-world proportions: storey height 3.2–4.2 m; doors 2.2–2.6 m tall, 1.0–1.8 m wide; window
  heads aligned across a façade; ground floor slightly taller than upper floors.
- Model the details that make buildings read as real: plinth/base course, window frames with sills
  and mullions (split windows into panes), door frame and canopy or porch, cornice or parapet at the
  roof line, roof overhang with fascia, gutters and downpipes, chimney or rooftop plant where it
  fits, steps with a landing, railings, columns or pilasters on civic buildings.
- Use depth: recess windows and doors 0.1–0.25 m into walls; project sills, cornices and canopies.
  Flat façades with painted-on windows look fake.
- Materials: `brick`, `stucco`, `plaster_warm`, `wood_light`/`wood_dark` (cladding), `metal_*`
  (frames, railings, machinery), `glass` (panes), `roof`/`roof_red`; `trim` for frames and
  cornices. Combine 2–3 materials per building, like a real architect would.
- Each building has a unique, recognizable silhouette (tower, dome, hall, house, greenhouse,
  rotunda, workshop, lighthouse, library, market, bank, harbor house, town hall).
- The department `accent` color appears like a brand would use it on a real building: door,
  awning, banner, window frames or signage band — never a whole painted building.
- The front faces the plaza (local +Z). The entrance is centered and obvious; the sign is above or
  beside it and readable from the driveway.
- Landscape the plot like a real lot: paved path to the door, planters, low hedges, a bench, bike
  rack or lamp where it fits (`prop` models), using `plant`/`pot` and real props.

## Interiors

- Real scale: a person is 1.75 m; chairs seat at 0.45 m; tables 0.75 m; counters 1.05 m; ceilings
  4.2 m. Use `prop` models (they are real 3D models sized as in `kit/props.contract.ts`) for all
  furniture and objects; build custom pieces (a long council table, a vault door frame, a reception
  desk) from boxes and rounded boxes with real materials.
- Furnish like a real, working office of that department: workstations with screens and chairs,
  shelving with books and binders, plants, lamps, a meeting or lounge corner, wall elements
  (whiteboard, clock, framed board). Add lived-in details: a mug, papers, books, a jacket on a chair
  (use the props), cables near desks.
- Light: 1–3 windows (never on the south wall), plus up to 3 warm practical lights (desk or floor
  lamps, a feature pendant). Rooms are evenly lit with soft pools of warmer light.
- Floors: `wood_floor` by default (or another real floor material that fits); walls `plaster_wall`
  or `plaster_warm`; baseboards and frames in `trim`. One rug (`fabric_*`) defines the main area.
- Composition: looking in from the door, the department lead (slot `s1`) stands in clear view,
  framed by the room's signature piece (the telescope, the vault door, the workbench…). Keep a clear
  walkway (≥ 1.2 m) from the door to every agent. Real rooms have negative space — don't fill
  every metre.

## Realism checklist (the critic scores this)

- Nothing floats: every object rests on the floor, a surface, or a wall. Nothing intersects walls
  or other objects.
- Nothing is a single giant box where a real object would have parts (a desk has a top and legs; a
  window has frame, panes and sill).
- Surfaces use the right material for what they are (no fabric floors, no brick tables).
- Scale is believable from every camera; repeated elements are aligned and evenly spaced.
- Variety without chaos: vary prop rotation slightly with `k.rand()`, but keep rows aligned.

## Don'ts

- No text except the sign. No logos. No weapons. No people-shaped props (agents are placed by the
  engine). No randomness except `k.rand()`. No lights with shadows. No transparent walls. No
  objects outside the bounds. Nothing cartoonish, toy-like, low-poly-looking or pixelated.

### ART DIRECTION (founder's reference: a sunny downtown plaza)

- Light and sky: clear blue sky, bright midday-to-afternoon sun, crisp long shadows; the scene reads as sunny and
  open, never gloomy or foggy.
- Architecture: substantial, believable city buildings — multi-storey stone, brick and stucco façades with a regular
  grid of many recessed windows (window head and sill on every opening, aligned floor to floor), a heavier rusticated
  ground floor with arched openings, horizontal string courses, and a strong cornice at the roofline. Mix materials
  between neighbours (pale limestone, warm brick, cream stucco); a glass or metal-and-glass volume is welcome where
  the brief allows (e.g. a modern wing), but most buildings are classic masonry.
- Rooftops: flagpoles with flags, rooftop parapets and small mechanical boxes or water-tank details give a lived-in
  skyline; keep everything inside the plot bounds.
- Street level: light grey stone paving, planters with palm trees or street trees, benches, café tables with red
  umbrellas, low hedges — dressed generously but leaving the 3 m in front of the door clear.
- Scale: buildings should feel tall and civic relative to the 1.75 m player (use the full height budget where the
  brief suits it: towers, town hall, bank), with human-scale detail at the entrance.
- Grand-hotel façades (Union Square feel): long rows of identical, evenly spaced windows over many storeys; a
  two-storey arcaded or glazed base with tall arched or square openings and display windows; pale stone or cream
  render upper floors; a pronounced top cornice or attic storey. Read as a real downtown block from street level.
- Civic set pieces suit civic buildings: a tall slender column or obelisk-like monument, a flagpole, a sculpture or
  fountain on the forecourt, terraced steps with low planter walls and trimmed hedges.
- Street furniture inside the plot near the frontage: slim dark-green or black street lamps, benches, planters
  with palms; keep it orderly and civic, not cluttered.
- Avoid: blank flat walls, windowless boxes, toy proportions, uniform single-colour façades.

### BUILDINGS
- id: 'intake' | building: The Arrivals Hall | department: Intake (D01) | color: #E07A3F
  mission: Turn the founder's idea and context into a structured brief and a testable spec.
  exterior: Friendly train-station-style hall: wide arched front (series of rounded boxes forming an arch), large clock-less canopy over the door in `accent` orange, stucco walls, slate roof, luggage carts outside
  interior: Reception counter (`counter`) with paper stacks, an "idea wall" (pinboard: `whiteboard` + colorful `paper` notes), two sofas facing a low table, suitcase props (rounded boxes with handles)
- id: 'office-hours' | building: The Clocktower | department: Office Hours (D02) | color: #C9A227
  mission: Find ambiguity and risk early; ask the founder only what matters.
  exterior: Narrow 3-storey brick tower body (8 × 8) with a 4th clock level (a big `clock` prop on the front, face toward plaza), small annex hall in front holding the door, `accent` gold roof band
  interior: Cozy study: two armchairs facing a desk, tall bookshelves, a large wall clock, a chalkboard (`whiteboard` in `metal_dark`) with question marks, warm rug
- id: 'market-research' | building: The Observatory | department: Market Research (D03) | color: #3E7CB1
  mission: Map the market, competitors and pricing with cited evidence.
  exterior: Round building (cylinder r 9) with a dome (half sphere, `metal_light`) and a slit, a `telescope` prop poking out, `accent` blue band, glass ring of windows
  interior: Round-feel room: central round table with maps (`paper` planes), a big `telescope` by the north window, chart screens (`screen`), star-map rug (dark blue rug with small light dots)
- id: 'outreach' | building: The Telegraph House | department: Outreach & Validation (D04) | color: #4FA3A5
  mission: Design customer interviews and draft outreach; sending is always gated.
  exterior: Victorian-style two-storey house (stucco + `accent` teal trim), a telegraph pole with wires (tubes) on the side, mailbox at the path, porch with railings
  interior: Switchboard wall (grid of small cylinders + cables), writing desks with letter stacks, a wall of pigeonholes (box grid), comfy interview corner (two chairs + plant)
- id: 'synthetic-population' | building: The Greenhouse | department: Synthetic Population (D05) | color: #5FA35F
  mission: Test the value proposition against a simulated persona panel, clearly labelled as synthetic.
  exterior: Glass greenhouse (`glass` panels in a `metal_light` frame, pitched roof), planters with rows of small "people" figures (tiny capsules on stands — a panel of personas), `accent` green door
  interior: Rows of planter tables with miniature figure groups (4 segments × 6 tiny figures), hanging lamps, data screens on easels, potted plants everywhere
- id: 'pivot' | building: The Rotunda | department: Pivot & Decision (D06) | color: #8E6CC4
  mission: Weigh the evidence and decide proceed, revise or kill.
  exterior: Classical small rotunda: ring of 8 columns (cylinders) around a round hall, shallow dome, steps up to the door, `accent` purple banners
  interior: Round "decision room": a big round table in the center with 6 chairs, a set of scales prop (simple primitives), evidence boards on easels, purple rug
- id: 'engineering' | building: The Foundry Works | department: Engineering & Build (D07) | color: #D0573F
  mission: Design, build, review and verify the product.
  exterior: Industrial brick workshop with a sawtooth roof (3 slanted roof boxes), a tall chimney (cylinder), large roll-up door (the entrance), crates and barrels outside, `accent` red-orange trim
  interior: Workshop: workbenches with monitors (`workbench`, `screen`), a `server_rack` row with blinking LED dots (emissive spheres), cable runs on the floor (tubes, like the reference), whiteboard with a diagram, a 3D printer-ish box
- id: 'growth' | building: The Lighthouse | department: Strategy & Growth (D08) | color: #E3B341
  mission: Positioning and the launch plan.
  exterior: Lighthouse tower (tapered cylinder r 3→2.2, 16 m, white with `accent` yellow stripes) beside a keeper's cottage that holds the door; lantern room with emissive glass
  interior: Cottage interior: map table with route lines (tubes), a big chart on the wall (rising bars from boxes), nautical props (barrels, rope coil = torus), lighthouse model on the table
- id: 'lead-intel' | building: The Archive | department: Lead Intelligence (D09) | color: #6B7FA8
  mission: Ideal customer profile and public, company-level lead evidence.
  exterior: Library-like facade: stucco with tall arched windows, wide steps, two lamps, `accent` slate-blue door, roof balustrade
  interior: Tall bookshelves in rows (aisles must stay walkable), card-catalog cabinets (box grid), reading tables with green lamps, a big network-graph board (spheres + tubes on a wall)
- id: 'sales' | building: The Market Hall | department: Sales (D10) | color: #C2477A
  mission: Pitch, pricing page copy and pipeline plan.
  exterior: Open-fronted market hall: big pitched roof on columns, striped awnings in `accent` magenta, market stalls (counters) under the roof, door to an enclosed back room
  interior: Showroom: a stage-like counter with a demo `screen`, pipeline wall (a row of columns of colored boxes = stages), bell on the counter, lounge chairs for "customers"
- id: 'finance-people' | building: The Bank & Guild | department: Finance & People (D11) | color: #2F8F6B
  mission: Budget, runway, spend gates and hiring new agent capabilities.
  exterior: Solid stone bank: symmetrical facade, 4 pillars, pediment (triangular prism via `k.box` rotated), `accent` green doors, round `vault_door` prop visible through a front window
  interior: Bank hall: teller counter with glass partitions, a vault door on the north wall, ledger desks, a corner "guild" lounge (org-chart board with portrait frames, sofa, plant)
- id: 'support' | building: The Harbor House | department: Support & Retention (D12) | color: #38A3C9
  mission: Triage issues and feedback; route bugs to engineering.
  exterior: Harbor-master house on a small pier (wooden deck planks extending to the front), life rings (torus) on the wall, a mast with flags, `accent` sky-blue shutters
  interior: Help desk with two stations (headset props), ticket board (pinboard with cards), a cozy waiting area (sofa, cushions, rug), a ship's wheel decor (torus + spokes)
- id: 'chief-of-staff' | building: Town Hall | department: Chief of Staff (D13) | color: #6C7A99
  mission: Plan and coordinate all work; improve the company itself.
  exterior: Largest building: symmetrical, central tower with a flag, wide steps, columns, `accent` slate trim, clock face, flower beds
  interior: Council chamber: long table with 8 chairs, a big wall-mounted "org map" (13 colored tiles in a grid = the departments), lectern, two flags, tall windows

### EXAMPLE (style and API usage; do not copy the design)
```ts
// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

// Reference module: shows correct KitApi usage and passes every probe by construction.
// - ayan: used as the "EXAMPLE" section of the worldgen prompt until fallback/archetypes.ts exists.
// - mahin: the kit implementation must render this without errors; start fallback archetypes from it.
import type { BuildingModule, KitApi } from '../../kit/types';

const house: BuildingModule = {
  id: 'example-house',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },
  buildExterior(k: KitApi) {
    k.group('body', () => {
      k.box({ size: [18, 7, 14], pos: [0, 3.5, -1], mat: 'stucco', collide: true, name: 'walls' });
      k.box({ size: [18.6, 0.4, 14.6], pos: [0, 7.2, -1], mat: 'trim' });
      k.box({ size: [16, 2.6, 12], pos: [0, 8.7, -1], mat: 'roof_red', name: 'roof' });
      k.box({ size: [1.4, 3, 1.4], pos: [5, 10, -4], mat: 'brick', name: 'chimney' });
    });
    k.group('front', () => {
      k.box({ size: [2.4, 3.2, 0.3], pos: [0, 1.6, 6.1], mat: 'wood_dark', name: 'door' });
      k.box({ size: [4, 0.2, 2], pos: [0, 0.1, 7.2], mat: 'plaza_stone', name: 'step' });
      for (const x of [-5.5, 5.5]) {
        k.box({ size: [3, 2, 0.15], pos: [x, 3.2, 6.05], mat: 'window_glow' });
        k.box({ size: [3.3, 0.15, 0.4], pos: [x, 2.1, 6.2], mat: 'trim' });
      }
      k.prop({ kind: 'flowerbed', pos: [-4, 0, 8.5] });
      k.prop({ kind: 'flowerbed', pos: [4, 0, 8.5] });
      k.prop({ kind: 'mailbox', pos: [7.5, 0, 9.5], collide: true });
    });
    k.light({ kind: 'point', pos: [0, 4.2, 7], color: '#FFE9C7', intensity: 1.2, distance: 8 });
    k.entrance({ z: 7.2 });
    k.sign({ pos: [0, 5.2, 6.3], width: 5 });
  },
  buildInterior(k: KitApi) {
    k.window({ wall: 'north', center: -3, width: 3, height: 1.8, sill: 1.0 });
    k.window({ wall: 'east', center: 0, width: 2.5, height: 1.8, sill: 1.0 });
    k.group('work', () => {
      k.prop({ kind: 'desk', pos: [-5, 0, -4], collide: true });
      k.prop({ kind: 'chair', pos: [-5, 0, -3] });
      k.prop({ kind: 'desk', pos: [5, 0, -4], collide: true });
      k.prop({ kind: 'chair', pos: [5, 0, -3] });
      k.prop({ kind: 'bookshelf', pos: [-8, 0, 1], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, 5.5] });
      k.prop({ kind: 'table_round', pos: [0, 0, -1.5], collide: true });
      k.prop({ kind: 'lamp_floor', pos: [-7.5, 0, 5.5] });
    });
    k.light({ kind: 'point', pos: [0, 3.6, 0], color: '#FFE2B8', intensity: 1.4, distance: 14 });
    k.npcSlot({ id: 's1', pos: [-5, 0, -2], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [5, 0, -2], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [-2.5, 0, 1.5], facingY: 0.4 });
    k.npcSlot({ id: 's4', pos: [2.5, 0, 1.5], facingY: -0.4 });
    k.npcSlot({ id: 's5', pos: [-6, 0, 3.5], facingY: 0.8 });
    k.npcSlot({ id: 's6', pos: [6, 0, 3.5], facingY: -0.8 });
  },
};
export default house;
```

### PHOTOREAL QUALITY BAR
A screenshot from anywhere in the world should pass, at a glance, as an architectural
visualization or a modern game — not as a WebGL demo. Concretely:

- [ ] No flat-colored surface is visible anywhere: every material is PBR with color, normal and
      roughness maps from a real scanned texture set (or a deliberate physical material: glass,
      car paint, metal).
- [ ] Textures are at real-world scale (a brick is ~21.5 × 6.5 cm; floor planks ~15–20 cm wide) and
      never stretched (UVs are generated in meters, §5).
- [ ] Lighting is image-based (HDRI) plus one physical sun with soft cascaded shadows; every object
      is grounded by ambient occlusion and contact shadows.
- [ ] Props are real 3D models (chairs, desks, shelves, plants, lamps, books…), not boxes.
- [ ] Architecture has real-world detail: window frames, sills, mullions, door frames, cornices,
      roof overhangs, gutters, steps, railings, baseboards, ceiling trim.
- [ ] Vegetation varies (several tree species/sizes, grass with variation), no identical clones in a row.
- [ ] The 29 agents are realistic human avatars that breathe, blink, look at the player and lip-sync.
- [ ] No z-fighting, light leaks, shadow acne, popping, or texture shimmer (SMAA + mipmaps + anisotropy).
- [ ] Color is graded consistently: late-afternoon golden-hour exterior, warm interiors.

The render → critique loop scores realism explicitly (`10-render-critique-loop.md` §4), so the
world is pushed toward this bar automatically.

### COMPOSITION REFERENCE (layout and coziness only — the render style is photoreal)
(described below — the long-decode model takes text only; any further attached images are the founder's art-direction references for exteriors)

### REFERENCE IMAGES — DESCRIBED
* **Note on References:** Only the single interior composition reference was provided; this brief translates its spatial layout, density, and lighting cues into a photoreal 3D interior specification, leaving exterior fields marked as unspecified.
* **Composition:** Wide-angle, high-vantage corner perspective looking diagonally into the room's main corner. Two intersecting walls frame the background, while a broad expanse of flooring dominates the lower two-thirds of the frame.
* **Layout & Density:** Sparse, open-plan layout with low overall density. Large primary furniture pieces (single bed on the right, simple rectangular storage unit, narrow desk with two chairs on the left) are pushed strictly against the perimeter walls. The vast central floor area features an informal, lived-in scatter of small-scale props (play blocks, floor cushions, ring targets, and winding cables) anchored by an angled, rectangular central rug with a raised wedge.
* **Architecture (Massing, Rhythm, Materials, Details):** Simple rectilinear room geometry with flat ceilings and unadorned, smooth matte-plaster walls. Symmetrical fenestration rhythm featuring one medium-sized, two-pane casement window centered on each visible wall, framed with simple white trim and thin baseboards. Flooring consists of wide-plank, semi-gloss reddish-brown hardwood laid diagonally relative to the camera. 
* **Furniture & Props (Substitute for Street Furniture):** Minimalist, utilitarian forms with rounded edges—translated into photorealistic timber, matte plastics, and soft textiles. A low-profile platform bed with a white mattress, light blue folded duvet, and round bolster pillow; a blocky brown cabinet; a slender wooden table with two simple four-legged chairs; a terracotta-red area rug bordered in dark brown, surrounded by pastel plush floor pillows, geometric wooden/plastic blocks, and dark rubberized floor cables.
* **Vegetation:** None present in reference (maintain entirely indoor, plant-free aesthetic, or add minimal potted greenery only if needed to enhance photorealistic coziness).
* **Light & Color:** Bright, overexposed natural daylight blasting through both windows, creating crisp specular highlights on the hardwood floor, combined with a warm central ceiling point light. Soft ambient occlusion gathers in the room corners and beneath furniture. The palette balances cool, desaturated slate-blue walls against warm, rich cherry-wood floors, punctuated by playful pastel and primary accents (terracotta, baby blue, soft pink, lavender, yellow, and forest green).
* **Exteriors:** Unspecified (no exterior art-direction images provided).
