# 12 — Photoreal Look (authoritative; supersedes the stylized look)

> **Hackathon context — Problem Statement 2 (More Dimensions).** The town is the centrepiece of our
> entry. It must look like a team of environment artists built it: real materials, real light,
> real people. ADR-018. Where this document disagrees with `02-look-kit.md`,
> `05-characters-and-faces.md` (construction/portraits), `11-performance.md`,
> `02-models-and-integrations/07-nano-banana-assets.md` (textures/portraits) or older copies of
> `templates/DESIGN.md`, **this document wins**.

## 1. The quality bar (acceptance W-12)

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

## 2. What stays the same

Three.js `WebGLRenderer` inside the React app (ADR-005); the kit API (`kit/types.ts`, frozen) and
the building modules Argon writes; the city layout and manifest; the probes; first-person
controls, car, navigation; FaceSpec, voice and lip-sync contracts. **Realism comes from the kit
implementation, the assets, the lighting and the post-processing.**

## 3. Asset sources (all free for this use; credits are generated)

| Source | What | License | How we get it |
|---|---|---|---|
| **Poly Haven** (`polyhaven.com`, API `api.polyhaven.com` — VERIFY endpoints) | Scanned PBR texture sets, HDRIs, CC0 models (furniture, props, plants, street furniture) | CC0 | `web/assets-pipeline/fetch.ts` downloads by asset id |
| **ambientCG** (`ambientcg.com`, API v2 — VERIFY) | Backup PBR texture sets | CC0 | same |
| **Microsoft Rocketbox** (`github.com/microsoft/Microsoft-Rocketbox`) | 115 realistic rigged human avatars (FBX), some with facial blendshapes; sample animations — VERIFY what each includes | MIT | download selected avatars, convert FBX → glTF (`fbx2gltf`) |
| **EZ-Tree** (`@dgreenheck/ez-tree`, npm) | Procedural realistic trees (oak, pine, ash…) generated in the browser | MIT | runtime dependency |
| Vehicle | One realistic car: a CC0 model if one exists on Poly Haven, otherwise a CC-BY model with credit (VERIFY), otherwise the procedural car with a physical clear-coat paint | CC0 / CC-BY | pipeline |

`web/public/assets/CREDITS.md` (generated) lists every asset with source, author and license.
Never use assets without a license that allows this use.

## 4. Asset pipeline (`web/assets-pipeline/`, owner Karthik)

```
web/assets-pipeline/
  assets.lock.json   # curated choices: which asset id fills which MaterialKey / PropKind / HDRI / avatar,
                     # with resolution and expected sha256 — committed; the only thing a human edits
  fetch.ts           # downloads everything in the lock file into web/public/assets/raw/ (cached, resumable)
  build.ts           # optimizes: textures → WebP 2k + 1k; models → normalized (origin at floor center,
                     # meters, +Z front), scaled to PROP_FOOTPRINTS, simplified to ≤ 15k tris (LOD0) with
                     # LOD1/LOD2, meshopt-compressed .glb; avatars → glTF via fbx2gltf, ≤ 25k tris,
                     # skeleton + morph-target inspection; writes manifest.json + CREDITS.md
  README.md
```

Commands (scripts in `web/package.json`): `pnpm assets:fetch`, `pnpm assets:build`, `pnpm assets`
(both). Output: `web/public/assets/{textures,models,hdri,characters,vehicles}/…` (gitignored —
binaries are rebuilt from the lock file) plus the committed `web/public/assets/manifest.json`.
Total download target ≤ 600 MB, built output ≤ 300 MB.

### The manifest contract (`web/src/world/assets/manifest.contract.ts`, frozen)

The kit, the city, the characters and the car read **only** `manifest.json`, typed by this
contract. Every entry is optional at runtime: a missing manifest entry or a failed load falls back
to the procedural PBR material/primitive prop/procedural tree, so the world always loads.
See the file for the exact types: `PbrTextureSet`, `MaterialBinding`, `ModelAsset`, `HdriAsset`,
`CharacterAsset` (bones, viseme and blink morph targets, tintable outfit material, animation clips),
`VehicleAsset`, `AssetManifest`.

### Choosing assets (`assets.lock.json`)

| Kit key | Look for (Poly Haven category / keywords) |
|---|---|
| `wood_floor` | oak/walnut floor planks, satin |
| `wood_dark`, `wood_light` | dark walnut / light oak furniture wood |
| `plaster_wall`, `plaster_warm`, `stucco` | painted plaster / stucco (tinted per key) |
| `trim` | painted wood (white) |
| `brick` | red/terracotta brick with mortar |
| `roof`, `roof_red` | slate tiles / clay roof tiles |
| `plaza_stone` | granite cobblestone / paving |
| `road`, `sidewalk`, `curb` | asphalt / concrete slabs / granite curb |
| `grass` | lawn grass (ground) |
| `metal_dark`, `metal_light` | painted steel / brushed aluminium |
| `fabric_*` | woven fabric (one set, tinted per key with a muted, realistic version of each color) |
| `paper`, `plant`, `pot`, `cable`, `screen`, `glass`, `window_glow`, `accent*` | physical materials (no scan needed) |

PropKind → model: one Poly Haven model per kind where available (chairs, tables, shelves, potted
plants, lamps, books, barrels, crates, benches, cabinets…); kinds without a good CC0 model
(e.g. `vault_door`, `server_rack`, `telescope`) are modeled procedurally with PBR materials.
HDRIs: one exterior (late afternoon, partly cloudy, sun ~25° elevation) and one interior (soft
daylit room). Avatars: 29 + 6 spares, adults, varied skin tones, ages, builds and clothing styles
(business, casual, technical) so FaceSpecs map cleanly (§7).

## 5. Renderer, lighting and post (`kit/LookKit.ts`, `kit/lights.ts`, owner Mahin)

- `WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })`,
  `outputColorSpace = SRGBColorSpace`, **`toneMapping = AgXToneMapping`** (fallback ACES),
  exposure tuned per scene (start 1.0), `shadowMap` PCFSoft.
- **Image-based lighting:** load the HDRI (`HDRLoader`/`RGBELoader` — VERIFY name in the installed
  three), PMREM → `scene.environment`; exterior `scene.background` = the same HDRI (or `Sky` shader
  matched to the sun) with `backgroundBlurriness` 0–0.05.
- **Sun:** `DirectionalLight` matched to the HDRI sun direction, warm (≈ 5200 K), with **cascaded
  shadow maps** (`three/examples/jsm/csm/CSM.js`) in the city: 3 cascades on High, 2 on Medium,
  1 plain shadow map on Low. Interiors: sun through the main window + the HDRI + module lamps.
- **Post (EffectComposer):** `RenderPass` → `GTAOPass` (AO grounding; full-res High, half Medium,
  off Low) → `UnrealBloomPass` (subtle: strength 0.12, threshold 0.95 — only lamps, windows, sky
  highlights) → `SMAAPass` → `OutputPass`; optional color-grading LUT (`LUTPass`, a warm neutral
  LUT) and a very light vignette. Fog: `FogExp2` with low density for aerial perspective.
- **Materials:** `MeshStandardMaterial` with color/normal/roughness(/AO/metalness) maps;
  `MeshPhysicalMaterial` for glass (transmission on High, opacity fallback), car paint (clearcoat),
  fabrics (sheen). Anisotropy 8 (High) / 4. Shared per key + accent.
- **UVs in meters:** the kit generates box/plane/cylinder UVs from world-space size divided by the
  texture set's `tileMeters` (per face), so nothing stretches regardless of what Argon builds.
  Large surfaces get a second, low-frequency "macro variation" multiply (noise) to break tiling.
- **Edges:** exterior wall boxes get a 1–2 cm bevel (rounded box, 2 segments) on High — light
  catching edges is a big part of realism.
- **Windows (`k.window`, exterior windows):** frame + mullions + sill from `trim`/`metal_dark`,
  physical glass that reflects the environment, and a faint warm interior glow behind it
  (not a flat white panel).
- **Interaction rings:** keep them (gameplay affordance) but subtle: thin, softly emissive, with a
  gentle pulse — they are the only non-diegetic element besides the HUD.

## 6. City dressing (`city/*`, owner Mahin)

- Ground: grass PBR with macro variation + **instanced grass blades** near the player (High, ≤ 40 m),
  dirt/edge blending along paths (vertex-color or decal strips).
- Roads: asphalt PBR, painted lane markings with wear, concrete sidewalks with granite curbs.
- Trees: EZ-Tree, 6–8 seeded variants across 3 species, instanced placements from `props.ts`
  (seed 1337); LOD: billboard impostors beyond 120 m on Medium/Low.
- Street furniture: real models for benches, lamps, bins, bollards, planters (manifest
  `streetFurniture`); the plaza fountain with animated-normal water and a stone basin.
- Backdrop hills: textured terrain meshes with trees, faded by fog — no plain cones.
- Signs: the Nano Banana sign image (`/generated/signs/<dept>.png`, realistic style — see
  `07-nano-banana-assets.md` banner) mapped onto a framed board mesh with PBR wood/metal.

## 7. Characters (`npc/*`, owner Mahin; lip-sync owner Karthik)

- **Avatars:** Rocketbox glTF avatars from the manifest. `pickAvatar(face, used)` maps each FaceSpec
  deterministically to an avatar: nearest `skinTone`, compatible hair (`bald`/`buzz` → short or
  bald; `long`/`ponytail`/`bun` → long), `build`/`height` from FaceSpec, and no repeats within a
  building (repeats across the town only if spares run out). `outfit_color` tints the avatar's
  `outfitMaterial` (multiply, keeps the cloth texture). Nova (concierge) gets a distinct avatar.
- **Animation:** use the avatar's idle/talk clips when present (AnimationMixer); otherwise drive
  bones procedurally — breathing (spine scale/rotation), idle sway, look-at (neck/head bones,
  clamps from `05-characters-and-faces.md`), blink (morph targets, else eyelid scale), talking
  gestures (arm bones). Agents stand or sit at their `npcSlot` (sitting if the slot faces a chair).
- **Lip-sync:** Karthik's `LipSync.mouth` (`open`, `width`) drives the jaw bone rotation
  (`open / 0.07 × 18°`) and, when the avatar has viseme morph targets (`visemes` in the manifest),
  blends the matching morph target; otherwise `width` drives a mouth-corner morph or is ignored.
- **Budgets:** ≤ 25k triangles per avatar LOD0, LOD1 beyond 8 m; ≤ 6 avatars per interior.
- **Fallback:** missing avatar → the procedural character from `05-characters-and-faces.md` with
  PBR skin/cloth materials.

## 8. Portraits match the 3D characters

Portraits are **rendered from the actual avatars**, not invented:

1. The capture page has a portrait mode: `/view/capture?mode=portrait&agent=<agent_id>` — head and
   shoulders, 3/4 view, studio three-point light, neutral background in the department color,
   768 × 768 (owner Mahin; handshake in `probes/types.ts`).
2. `foundry-worldgen portraits --from-renders` (owner Ayan) captures all 29 with `scripts/capture.ts`
   into `web/public/generated/portraits/<agent_id>.png`, and MAY polish each with Nano Banana using
   the render as the reference image ("photographic studio headshot of this exact person, same face,
   hair, clothing; do not change identity").
3. The dashboard and HUD keep using `/generated/portraits/<agent_id>.png`.

## 9. Quality tiers (replace the table in `02-look-kit.md`)

| Setting | High | Medium | Low |
|---|---|---|---|
| Texture size | 2048 | 1024 | 1024 |
| Pixel ratio cap | 1.5 | 1.0 | 0.85 |
| Shadows | CSM 3 × 2048 | CSM 2 × 1024 | 1 × 1024 |
| GTAO | full res | half res | off |
| SMAA | on | on | on |
| Bloom / LUT | on / on | on / on | off / on |
| Grass blades | ≤ 40 m | ≤ 20 m | off |
| Trees | 100% + LOD | 70% + impostors | 40% + impostors |
| Glass transmission | on | off | off |
| Avatar LOD0 distance | 8 m | 5 m | 3 m |

`auto` quality and the `localStorage` persistence stay as in `02-look-kit.md`.

## 10. Performance budgets (replace the table in `11-performance.md`)

Target unchanged: ≥ 50 fps High / ≥ 60 fps Medium on the demo laptop at 1080p (auto quality
steps down).

| Scope | Triangles | Draw calls | Texture memory |
|---|---|---|---|
| City | ≤ 2.5 M (with LODs/impostors) | ≤ 700 (instancing for trees, grass, lamps, furniture) | ≤ 400 MB High |
| One interior | ≤ 500 k incl. ≤ 6 avatars | ≤ 250 | ≤ 250 MB High |
| Avatar | ≤ 25 k (LOD0) | ≤ 8 | ≤ 24 MB |

Techniques from `11-performance.md` still apply (merge static geometry per material, instance
repeated models, build interiors on demand with an LRU of 4, dispose on evict, no per-frame
allocations). Add: `MeshoptDecoder` for compressed glTF, texture loading by tier, LOD switching,
impostors for distant trees.

## 11. What changes for world generation (owner Ayan)

- Argon still writes building modules against the frozen kit API; `templates/DESIGN.md` now asks
  for photoreal architecture (real-world detail, proportions, materials, lived-in interiors with
  real props).
- Probe P7 budgets rise to exterior ≤ 250 k triangles / interior ≤ 400 k, draw calls ≤ 150 after
  merge/instancing (`10-render-critique-loop.md`).
- The critic scores `realism` and watches a walkthrough video (ADR-020).
- `assets/reference-bedroom.webp` is used only as a **composition** reference (cozy, uncluttered,
  readable), never as a style target.

## 12. Fallbacks

| Failure | Behaviour |
|---|---|
| No `manifest.json` entries / asset load error | Procedural PBR materials (noise-based color/normal/roughness), primitive props, procedural trees — still lit by the HDRI if present, else a `Sky` + hemisphere |
| HDRI missing | `Sky` shader + `PMREMGenerator.fromScene(sky)` for IBL |
| Avatars missing | Procedural characters (old spec) with PBR materials |
| Frame rate too low | Auto quality steps down; impostors and LOD distances shrink |
