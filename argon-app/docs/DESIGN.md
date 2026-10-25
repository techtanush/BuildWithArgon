# DESIGN.md — Visual rules for the Foundry town

These rules are given to Argon in every world-generation and critique prompt. The reference image
(`reference-bedroom.png`) shows the target interior look.

## Mood

Bright, warm, calm, toy-like and tidy — a storybook town built by a careful product designer.
Soft daylight, soft shadows, glowing windows. Nothing gritty, dark, or realistic-messy. No text
other than the building sign.

## Shapes

- Build from simple primitives: boxes, rounded boxes, cylinders, spheres, cones, tori, tubes.
- Prefer rounded boxes for anything soft or furniture-like (radius 0.03–0.15 m for furniture,
  up to 40% of the smallest dimension for cushions).
- Clean silhouettes; few, deliberate details. A detail must read from 5 m away.
- Real-world scale: a person is 1.75 m; doors 2.4–2.6 m tall; chairs seat at 0.45 m; tables
  0.75 m; counters 1.05 m; ceilings 4.2 m inside.
- Nothing floats: every object rests on the floor, a surface, or a wall. Nothing intersects walls.

## Color and materials

- Use only the kit's material keys. Floors: `wood_floor` (default). Walls: `plaster_wall` (pale
  blue-grey) or `plaster_warm`. Trim: `trim`.
- Fabrics are pastel (`fabric_lavender`, `fabric_blue`, `fabric_pink`, `fabric_cream`); rugs are
  `fabric_coral` with a `fabric_coral_dark` border.
- Each building uses its department `accent` color clearly but sparingly: door, trim, awning,
  banner, a few furniture pieces. Never paint a whole building in the accent color.
- Exteriors: `stucco`, `brick`, `plaster_warm`, `wood_light` bodies; `roof`/`roof_red` roofs;
  `glass`/`window_glow` windows; `metal_*` for frames and machinery.

## Light

- Interiors get 1–3 windows (glowing panels) and the kit's ceiling lamp; add at most 3 small warm
  lights (desk lamps, a feature light). Rooms should be evenly bright with soft pools of light.
- Exteriors: at most one light (over the door).

## Composition (interiors)

- Looking in from the door, the department lead (slot `s1`) stands in clear view, framed by the
  room's signature piece (e.g., the telescope, the vault door, the workbench).
- Keep a clear walkway from the door to every agent. Leave negative space; avoid clutter.
- One rug defines the main area. Add 1–2 "lived-in" details (a cable on the floor, a cushion, a
  mug, a stack of paper) like the reference.

## Composition (exteriors)

- The front faces the plaza (local +Z). The entrance is centered and obvious; the sign is above or
  beside it and readable from the driveway.
- Each building has a unique, recognizable silhouette (tower, dome, hall, house, greenhouse,
  rotunda, workshop, lighthouse, library, market, bank, harbor house, town hall).
- Add small landscaping inside the plot: planters, a bench, low hedges (rounded boxes in `plant`).

## Don'ts

- No text except the sign. No logos. No weapons. No people-shaped props (agents are placed by the
  engine). No randomness except `k.rand()`. No lights with shadows. No transparent walls. No
  objects outside the bounds.
