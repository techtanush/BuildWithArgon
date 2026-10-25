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
