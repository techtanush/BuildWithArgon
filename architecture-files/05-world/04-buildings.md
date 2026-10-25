# 04 — The 13 Buildings

Each department has one building. Argon generates each building's module
(`web/src/world/buildings/generated/<department_id>.ts`) from the design briefs below; a
hand-written **fallback archetype** (`buildings/fallback/archetypes.ts`) exists for every building
and is used if the generated module fails validation. Both use only the kit API
([`09-worldgen-pipeline.md`](09-worldgen-pipeline.md)).

## Rules that apply to every building

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

## Building design briefs

| Dept | Building | Exterior concept | Interior concept & signature props |
|---|---|---|---|
| intake | **The Arrivals Hall** | Friendly train-station-style hall: wide arched front (series of rounded boxes forming an arch), large clock-less canopy over the door in `accent` orange, stucco walls, slate roof, luggage carts outside | Reception counter (`counter`) with paper stacks, an "idea wall" (pinboard: `whiteboard` + colorful `paper` notes), two sofas facing a low table, suitcase props (rounded boxes with handles) |
| office-hours | **The Clocktower** | Narrow 3-storey brick tower body (8 × 8) with a 4th clock level (a big `clock` prop on the front, face toward plaza), small annex hall in front holding the door, `accent` gold roof band | Cozy study: two armchairs facing a desk, tall bookshelves, a large wall clock, a chalkboard (`whiteboard` in `metal_dark`) with question marks, warm rug |
| market-research | **The Observatory** | Round building (cylinder r 9) with a dome (half sphere, `metal_light`) and a slit, a `telescope` prop poking out, `accent` blue band, glass ring of windows | Round-feel room: central round table with maps (`paper` planes), a big `telescope` by the north window, chart screens (`screen`), star-map rug (dark blue rug with small light dots) |
| outreach | **The Telegraph House** | Victorian-style two-storey house (stucco + `accent` teal trim), a telegraph pole with wires (tubes) on the side, mailbox at the path, porch with railings | Switchboard wall (grid of small cylinders + cables), writing desks with letter stacks, a wall of pigeonholes (box grid), comfy interview corner (two chairs + plant) |
| synthetic-population | **The Greenhouse** | Glass greenhouse (`glass` panels in a `metal_light` frame, pitched roof), planters with rows of small "people" figures (tiny capsules on stands — a panel of personas), `accent` green door | Rows of planter tables with miniature figure groups (4 segments × 6 tiny figures), hanging lamps, data screens on easels, potted plants everywhere |
| pivot | **The Rotunda** | Classical small rotunda: ring of 8 columns (cylinders) around a round hall, shallow dome, steps up to the door, `accent` purple banners | Round "decision room": a big round table in the center with 6 chairs, a set of scales prop (simple primitives), evidence boards on easels, purple rug |
| engineering | **The Foundry Works** | Industrial brick workshop with a sawtooth roof (3 slanted roof boxes), a tall chimney (cylinder), large roll-up door (the entrance), crates and barrels outside, `accent` red-orange trim | Workshop: workbenches with monitors (`workbench`, `screen`), a `server_rack` row with blinking LED dots (emissive spheres), cable runs on the floor (tubes, like the reference), whiteboard with a diagram, a 3D printer-ish box |
| growth | **The Lighthouse** | Lighthouse tower (tapered cylinder r 3→2.2, 16 m, white with `accent` yellow stripes) beside a keeper's cottage that holds the door; lantern room with emissive glass | Cottage interior: map table with route lines (tubes), a big chart on the wall (rising bars from boxes), nautical props (barrels, rope coil = torus), lighthouse model on the table |
| lead-intel | **The Archive** | Library-like facade: stucco with tall arched windows, wide steps, two lamps, `accent` slate-blue door, roof balustrade | Tall bookshelves in rows (aisles must stay walkable), card-catalog cabinets (box grid), reading tables with green lamps, a big network-graph board (spheres + tubes on a wall) |
| sales | **The Market Hall** | Open-fronted market hall: big pitched roof on columns, striped awnings in `accent` magenta, market stalls (counters) under the roof, door to an enclosed back room | Showroom: a stage-like counter with a demo `screen`, pipeline wall (a row of columns of colored boxes = stages), bell on the counter, lounge chairs for "customers" |
| finance-people | **The Bank & Guild** | Solid stone bank: symmetrical facade, 4 pillars, pediment (triangular prism via `k.box` rotated), `accent` green doors, round `vault_door` prop visible through a front window | Bank hall: teller counter with glass partitions, a vault door on the north wall, ledger desks, a corner "guild" lounge (org-chart board with portrait frames, sofa, plant) |
| support | **The Harbor House** | Harbor-master house on a small pier (wooden deck planks extending to the front), life rings (torus) on the wall, a mast with flags, `accent` sky-blue shutters | Help desk with two stations (headset props), ticket board (pinboard with cards), a cozy waiting area (sofa, cushions, rug), a ship's wheel decor (torus + spokes) |
| chief-of-staff | **Town Hall** | Largest building: symmetrical, central tower with a flag, wide steps, columns, `accent` slate trim, clock face, flower beds | Council chamber: long table with 8 chairs, a big wall-mounted "org map" (13 colored tiles in a grid = the departments), lectern, two flags, tall windows |

**Variety rule:** no two buildings may share the same silhouette type (tower / dome / hall /
house / glass / columns / industrial / lighthouse / pier). The critic checks this across all 13.

## Fallback archetypes (hand-written, must pass all probes)

`fallback/archetypes.ts` exports `fallbackModule(departmentId): BuildingModule` built from 4
parameterized shapes, chosen per department:

| Archetype | Used for | Shape |
|---|---|---|
| `hall` | intake, sales, lead-intel, chief-of-staff | box body 20 × 9 × 14, pitched roof, 5 front windows, columns ×4 |
| `tower` | office-hours, growth | body 12 × 7 × 12 + tower 6 × 18 × 6 |
| `round` | market-research, pivot, synthetic-population | cylinder r 9 h 8 + dome/cone roof |
| `house` | outreach, engineering, finance-people, support | two-storey 16 × 10 × 12 with gable roof and chimney |

Fallback interiors: a shared layout (rug, a table with 4 chairs, 2 shelves, plants, 2 windows on the
north wall) with slots at `s1 (−2.5, 0, −2)`, `s2 (2.5, 0, −2)`, `s3 (−6, 0, 1)`, `s4 (6, 0, 1)`,
`s5 (−6, 0, −4.5)`, `s6 (6, 0, −4.5)`, all facing +Z (toward the door).

## Signs

`k.sign()` renders a 4:1 plane with `/generated/signs/<dept>.png` (fallback: canvas text: building
name in a serif font, department name below, cream background, accent border).
