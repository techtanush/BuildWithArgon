# 03 — City Layout (exact geometry) and the Manifest

All values in meters. Y up. The town is flat (ground at y = 0). The layout is deterministic and
computed in `web/src/world/city/layout.ts` **and** in the kernel (`api/world.py`) — both MUST
produce identical numbers (a unit test compares the kernel manifest to `layout.ts` output).

## Overview

```
                      D01 The Arrivals Hall (north, -Z)
                   D13                     D02
             D12          ┌──────ring road r=92──────┐        D03
                          │      spokes (13)         │
          D11             │    ┌── plaza r=30 ──┐    │            D04
                          │    │  fountain r=4.5 │    │
          D10             │    │  Nova @ (0,11.5)│    │            D05
                          │    └────────────────┘    │
             D09          └──────────────────────────┘        D06
                   D08                     D07
                         (spawn (0,1.65,16) looks north)
```

## Formulas

For department index `i = sort_order − 1` (0…12):

```
θ_i = i · 2π / 13                       // radians, clockwise seen from above starting at north
d_i = (sin θ_i, 0, −cos θ_i)            // unit direction from origin (i = 0 → −Z = north)
plot center      P_i = 132 · d_i
plot rotation    ψ_i = −θ_i             // rotation.y; building local +Z faces the plaza
plaza node       E_i = 30 · d_i
ring node        R_i = 92 · d_i
ring midpoint    M_i = 92 · (sin(θ_i + π/13), 0, −cos(θ_i + π/13))
door node        D_i = 110 · d_i        // car stop / race finish for building i
```

Building footprint: 28 × 28 (local x, z ∈ [−14, 14]); the front edge (local z = +14) lies at radius
118. Local → world: `world = P_i + R_y(ψ_i) · local`.

## Plot table (computed; use for tests)

| i | Dept | θ (deg) | P_i (x, z) | D_i (x, z) |
|---|---|---|---|---|
| 0 | intake | 0.000 | (0.00, −132.00) | (0.00, −110.00) |
| 1 | office-hours | 27.692 | (61.34, −116.88) | (51.12, −97.40) |
| 2 | market-research | 55.385 | (108.63, −74.98) | (90.53, −62.49) |
| 3 | outreach | 83.077 | (131.04, −15.91) | (109.20, −13.26) |
| 4 | synthetic-population | 110.769 | (123.42, 46.81) | (102.85, 39.01) |
| 5 | pivot | 138.462 | (87.53, 98.80) | (72.94, 82.34) |
| 6 | engineering | 166.154 | (31.59, 128.16) | (26.33, 106.80) |
| 7 | growth | 193.846 | (−31.59, 128.16) | (−26.33, 106.80) |
| 8 | lead-intel | 221.538 | (−87.53, 98.80) | (−72.94, 82.34) |
| 9 | sales | 249.231 | (−123.42, 46.81) | (−102.85, 39.01) |
| 10 | finance-people | 276.923 | (−131.04, −15.91) | (−109.20, −13.26) |
| 11 | support | 304.615 | (−108.63, −74.98) | (−90.53, −62.49) |
| 12 | chief-of-staff | 332.308 | (−61.34, −116.88) | (−51.12, −97.40) |

(Rounded to 2 decimals; tests use tolerance 0.05.)

## Surfaces (`city/roads.ts`, `city/plaza.ts`)

| Surface | Geometry | y | Material |
|---|---|---|---|
| Ground | `PlaneGeometry(800, 800)` | 0.000 | `grass` |
| Plaza | `CircleGeometry(30, 96)` | 0.015 | `plaza_stone` |
| Ring road | `RingGeometry(87, 97, 160)` | 0.020 | `road` |
| Ring lane dashes | instanced boxes 2.0 × 0.01 × 0.15, every 5 m along r = 92 | 0.025 | `lane_marking` |
| Spoke i | plane width 8 from r = 30 to r = 87 along d_i | 0.020 | `road` |
| Driveway i | plane width 6 from r = 97 to r = 118 along d_i | 0.020 | `road` |
| Sidewalk edge | thin boxes 0.3 wide × 0.12 tall along both sides of spokes/driveways | 0.060 | `trim` |

Use `polygonOffset` (factor −1, units −1 per layer) to avoid z-fighting.

## Plaza contents

| Item | Position | Collider |
|---|---|---|
| Fountain basin (cylinder r 4.5, h 0.6, `plaza_stone`), water disc (r 4.1, `#7FB8D9`, roughness 0.1, metalness 0.1), center column (r 0.5, h 2.2) + bowl (r 1.4) | (0, 0, 0) | circle r 4.8 |
| Concierge kiosk: counter rounded box 2.4 × 1.1 × 0.8 (`accent` = `#F5D90A` trim, `wood_light` body) + canopy (2.8 × 0.12 × 1.4, `accent`) on two posts | (0, 0, 9.6), facing +Z | box 2.6 × 1.0 |
| Concierge NPC | (0, 0, 11.5), facing_y 0 (faces +Z) | circle r 0.4 |
| Spawn | (0, 1.65, 16), yaw 0 (looking −Z) | — |
| Parked car | (6, 0, 18), heading 0 (facing −Z), yellow ring at (8.5, 0, 18) | car collider |
| 8 benches | r = 13, angles 22.5° + k·45° (skip angle nearest spawn), facing the fountain | boxes 2.0 × 0.6 |
| 4 lamp posts | r = 26, angles 45°, 135°, 225°, 315° | circle r 0.2 |
| Flower beds | r = 20, 6 beds (rounded box 3 × 0.4 × 1.2, `plant` + small colored spheres) | boxes |

## Props outside the plaza (`city/props.ts`, seeded RNG `mulberry32(1337)`)

- **Trees** (instanced): trunk `CylinderGeometry(0.18, 0.25, 2.2)` `wood_dark` + foliage
  `IcosahedronGeometry(1.6, 1)` ×2–3 stacked, colors `#6FAE4E`/`#5E9F45`/`#82BF5E`. Candidate
  points: uniform in annulus r ∈ [36, 300]; reject if within 7 m of any road centerline, within
  4 m of a plot footprint, or within 3 m of another tree. Target count 260 (High).
- **Street lamps** (instanced): along the ring road at r = 85.5 and 98.5 every 24 m of arc; along
  each spoke both sides every 20 m. Lamp: pole cylinder 4.5 m `metal_dark` + emissive head `#FFE9C7`.
- **Backdrop hills**: 24 cones (radius 40–70, height 25–45) at r = 330 ± 20, `#6FAE4E`, no colliders.
- **World boundary**: circular collider r = 310 (player and car cannot pass).

## Colliders

`player/Collision.ts` supports circles and oriented rectangles on the XZ plane:

```ts
type Collider =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'obb'; x: number; z: number; hw: number; hd: number; rotY: number };
function resolveCircle(px: number, pz: number, pr: number, colliders: Collider[]): { x: number; z: number; hit: boolean };
```

A uniform grid spatial hash (cell 8 m) indexes city colliders. Building modules mark colliders with
`collide: true`; the kit converts each box to an OBB in world space.

## Manifest (`GET /v1/world/manifest`)

```json
{
  "version": 1,
  "seed": 1337,
  "plaza": {
    "radius": 30,
    "fountain": {"pos": [0, 0, 0], "radius": 4.5},
    "concierge": {"agent_id": "concierge", "pos": [0, 0, 11.5], "facing_y": 0},
    "spawn": {"pos": [0, 1.65, 16], "yaw": 0},
    "car": {"pos": [6, 0, 18], "heading": 0}
  },
  "roads": {
    "ring": {"radius": 92, "width": 10},
    "spoke_width": 8,
    "driveway_width": 6,
    "nodes": [{"id": "E0", "pos": [0, -30]}, {"id": "R0", "pos": [0, -92]}, {"id": "M0", "pos": [22.02, -89.33]}, {"id": "D0", "pos": [0, -110]}],
    "edges": [["E0", "R0"], ["R0", "D0"], ["R0", "M0"], ["M0", "R1"], ["E0", "E1"]]
  },
  "buildings": [
    {"index": 0, "department_id": "intake", "code": "D01", "building_id": "b-intake",
     "name": "The Arrivals Hall", "department_name": "Intake", "color": "#E07A3F",
     "theta": 0.0, "plot_center": [0, -132], "rotation_y": 0.0, "footprint": [28, 28],
     "door_node": "D0", "sign_url": "/generated/signs/intake.png", "module": "generated"}
  ],
  "npcs": [
    {"agent_id": "eng.builder", "building_id": "b-engineering", "slot": "s2",
     "display_name": "Zara", "title": "Builder", "department_id": "engineering",
     "portrait_url": "/generated/portraits/eng.builder.png", "face": {"...": "FaceSpec"},
     "voice_ready": true, "is_lead": false, "generated": false}
  ]
}
```

- `nodes` has 52 entries (E, R, M, D for each i); `edges` has 65: for each i: `E_i–R_i`,
  `R_i–D_i`, `R_i–M_i`, `M_i–R_{i+1}`, `E_i–E_{i+1}` (indices mod 13).
- `module` is `"generated"` or `"fallback"` per the registry at kernel start (the kernel reads
  `web/src/world/buildings/generated/registry.json`, written by worldgen).
- `npcs` includes the venture's generated agents (`?venture=<vid>` query param) with their slots.
- The web caches the manifest; `manifest.fallback.json` is a copy without venture-generated agents.
