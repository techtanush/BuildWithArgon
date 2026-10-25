# WORK ORDER — Mahin (branch `mahin`)

**Lane C: the photoreal 3D world — "Enter the view".** You build the first-person town the
founder walks into, and it must look **photoreal — like a team of environment artists built it**,
never toy-like, low-poly or pixelated (ADR-018, `05-world/12-photoreal-look.md`): the renderer,
HDRI lighting with a physical sun and soft cascaded shadows, post-processing, the PBR look kit, the
city and its 13 department buildings (with interiors), the player and the car, navigation (walk,
race, fast travel, map), the 29 realistic human avatars, the conversation experience
(push-to-talk, cited answers, source and route cards), the Concierge in the plaza, Town Hall
standup playback, the capture page + probes that Argon's render → watch → critique → fix loop
uses, and performance. The world never shows company state; only the conversations are live.

**Our entry (ADR-019):** Problem Statement 2 — More Dimensions. The town is the centrepiece: the
judges will walk it, and the critic scores its realism. The low-level voice pieces —
`npc/visemes.ts`, `npc/LipSync.ts`, `conversation/Mic.ts`, `Stt.ts`, `Speech.ts` — and the asset
pipeline (`web/assets-pipeline/`, `web/public/assets/`) are **Karthik's**; you consume them.

---

## 0. Read first — on `main`, before writing any code

Read these in order (they are on every branch, under `architecture-files/`):

1. `architecture-files/README.md` — the whole thing, including "Why we're building this".
2. `00-overview/*` (vision, hackathon context, glossary, **ADRs incl. 018–020**, feature catalog).
3. `01-architecture/*` (system overview, repo layout, data model, **API contract**, orchestration, security).
4. `06-execution/07-team-split.md` — who owns what, the frozen contracts, the cross-branch
   interfaces and the merge plan. **This work order is the Mahin column of that document.**
5. `06-execution/06-agent-operating-rules.md`, `02-acceptance-criteria.md` (W-, C-, CO-07, G-04),
   `03-testing-strategy.md` (unit + `world.spec.ts`), `05-risk-register-and-fallbacks.md`.
6. Your sections: **`05-world/12-photoreal-look.md` first (it overrides the stylized parts of the
   older docs)**, then all of `05-world/` (00 → 11, 13 §5 for `playPath`), `templates/DESIGN.md`
   (photoreal rules Argon follows), skim `02-models-and-integrations/05-elevenlabs-voice.md` and
   `06-speech-to-text.md` (Karthik implements them; you orchestrate), `03-company-kernel/06-group-chats.md`
   §In the world. `assets/reference-bedroom.webp` is a **composition** reference only.
7. `argon-app/AGENTS.md` and the seed files you own (they start with `// OWNER: mahin`), plus the
   frozen world contracts: `web/src/world/kit/types.ts`, `kit/props.contract.ts`,
   `assets/manifest.contract.ts`, `npc/FaceSpec.ts`, `probes/types.ts`,
   `buildings/example/house.example.ts`, `src/shared/contracts.ts`, `data/manifest.fallback.json`.

The spec is the contract. If this work order and the spec ever disagree, follow the spec and log it
in `argon-app/docs/decisions/mahin.md`.

## 1. Setup

```bash
git fetch origin && git checkout mahin
cd argon-app/web && pnpm install && pnpm typecheck && pnpm test   # 7 passed
pnpm dev                                                          # http://localhost:5173/view?mock=1
# optional: run the seed kernel too (cd ../kernel && uv sync --extra dev && LLM_MODE=fake make -C .. kernel)
```

You don't need any API keys or a running kernel: **build against `/view?mock=1`** (fixtures in
`src/world/data/mock/`, offline manifest in `src/world/data/manifest.fallback.json`). Real assets:
until Karthik's pipeline lands on `main`, run it from Karthik's branch in a worktree to fill your local
`web/public/assets/` (gitignored, never committed):
`git worktree add ../karthik-wt origin/karthik && cd ../karthik-wt/argon-app/web && pnpm install && pnpm assets`
then copy `public/assets/` into your checkout's `web/public/assets/`. Everything must also render
acceptably with **no** assets (procedural PBR fallbacks). Also test the live path with the kernel
down: `/view` must load from the fallback manifest and show "conversations unavailable" (W-11).

## 2. What you own (edit only these)

**Web** (`argon-app/web/`): everything under `src/world/` **except** the frozen files
(`kit/types.ts`, `kit/props.contract.ts`, `assets/manifest.contract.ts`, `npc/FaceSpec.ts`,
`probes/types.ts`, `buildings/example/*`, `data/manifest.fallback.json`), Ayan's generated paths
(`buildings/generated/*`, `buildings/staging/*`) and Karthik's voice modules (`npc/visemes.ts`,
`npc/LipSync.ts`, `conversation/Mic.ts`, `Stt.ts`, `Speech.ts`). That includes `WorldHost.tsx`,
`engine/`, `kit/` (LookKit, materials, textures, lights, post, primitives, props, validateModule),
`assets/` (your loaders, e.g. `assets/loadManifest.ts`), `city/`, `interiors/`, `buildings/index.ts`,
`buildings/fallback/`, `player/`, `vehicle/`, `nav/`, `npc/` (Character, NpcManager, avatars,
LookAt, portraitFallback), `conversation/ConversationController.ts`, `probes/probes.ts`,
`capture/CapturePage.tsx`, `hud/` (incl. `hud.css`), `data/mock/*`.
Also `src/shared/worldApi.ts` (the world's only kernel client — extend it, e.g. add `answer(id)`
and an SSE subscription for `answer.checked`), `tests/unit/world/**`, `tests/e2e/world.spec.ts`,
and `docs/{build-logs,decisions,verified,contract-requests}/mahin.md`.

## 3. Never touch

Frozen: `src/App.tsx`, `main.tsx`, `src/shared/contracts.ts`, `styles/tokens.css`, the frozen world
files above, `vite.config.ts`, `tsconfig*.json`, `playwright.config.ts`, `index.html`,
`tests/unit/seed.contracts.test.ts`, `Makefile`, `AGENTS.md`, `docs/*.md`, `architecture-files/**`.
Tanush's: `src/dashboard/**`, `src/api/**`, `styles/app.css`, most of the kernel.
Ayan's: `scripts/**`, `public/generated/**`, `buildings/generated|staging`, kernel
models/engineering/worldgen.
Karthik's: `npc/visemes.ts`, `npc/LipSync.ts`, `conversation/Mic.ts`, `Stt.ts`, `Speech.ts`,
`assets-pipeline/**`, `public/assets/**`, `tests/unit/{voice,assets}/**`, `tests/voice-lab/**`,
kernel `voice/*` + `api/voice.py`.
Need a change there (e.g. a new manifest field or API shape)? → `docs/contract-requests/mahin.md`
and an adapter in your own files. Check before every push: `make ownership WHO=mahin` (from `argon-app/`).

## 4. What you can rely on

| You need | Use | Seed / fallback behaviour |
|---|---|---|
| City data | `getWorldApi().manifest(ventureId)` → `{ manifest, offline }` | Live `GET /v1/world/manifest`, else `manifest.fallback.json` (13 buildings, 52 road nodes, 65 edges, 29 NPCs; `face: null`) |
| Conversations | `worldApi.talk`, `concierge`, `tts`, `transcribe`, `standupLatest`, `postLatency` | `?mock=1` fixtures; live endpoints are empty until Tanush/Karthik land — handle errors gracefully |
| Kit contract | `kit/types.ts` (`KitApi`, `BuildingModule`, `MaterialKey`, `PropKind`) | Final, verbatim from `05-world/09` |
| Prop sizes | `kit/props.contract.ts` (`PROP_FOOTPRINTS`) | Final — props and their colliders use these sizes; Karthik normalizes models to them |
| **Photoreal assets (Karthik)** | `fetch('/assets/manifest.json')` typed by `assets/manifest.contract.ts`: PBR texture sets (`maps` with `{res}`, `tileMeters`), `materials` bindings per `MaterialKey`/`CityMaterialKey`, `props` → models, `streetFurniture`, `hdris`, `characters` (bones, visemes, blink, `outfitMaterial`, animations), `vehicles` | Seed manifest is empty → you **must** ship procedural PBR fallbacks (noise-based color/normal/roughness, `Sky` + PMREM env, primitive props, EZ-Tree trees) that still look good |
| Faces | `npc/FaceSpec.ts`; `ManifestNpc.face` | `null` until Ayan generates `faces.json` → derive a deterministic FaceSpec from a hash of `agent_id` (enums from `FaceSpec.ts`) so avatar choice is stable and distinct (C-01) |
| Portraits | `/generated/portraits/<agent_id>.png` (Ayan renders them from **your** portrait capture mode) | Missing → `npc/portraitFallback.ts` renders the avatar head to a 256×256 target |
| Signs | `/generated/signs/<dept>.png` | Missing → canvas-drawn sign (building name, department color, 4:1) on a framed board mesh |
| Generated buildings | `buildings/generated/index.ts` → `generatedModules` | Empty → every building uses your fallback archetype |
| Lip-sync (Karthik) | `const ls = new LipSync()`; each frame `ls.update(dt)` then read `ls.mouth` (`{open, width}` in meters) → jaw bone rotation (`open / 0.07 × 18°`) + viseme morph targets if the avatar has them | Seed: mouth stays at Rest |
| Speech playback (Karthik) | `speak(text, ttsResponse \| null, { lipSync, onCaption })` → `{ started, done, stop }` | Seed: browser `speechSynthesis`, no lip-sync |
| Push-to-talk (Karthik) | `Mic.supported()`; `startListening({ transcribe: worldApi.transcribe })` on V down → `session.stop()` on V up → `{ text, provider, latency_ms }`; empty text → offer typing | Seed: always empty → typing fallback |

## 5. What others rely on from you (keep these)

- **Capture handshake** (`probes/types.ts`, frozen): `/view/capture?building=<dept>&mode=exterior|interior&source=staging|generated|fallback`
  sets `window.__foundryProbe = { ready, error?, result: ProbeResult, setCamera(name), playPath(name) }`
  with the probes for that mode (exterior P1 P2 P3 P6 P7 P8 P10; interior P1 P2 P4 P5 P6 P7 P8),
  the 6 camera poses from `05-world/10` §1, High quality, no animation except during `playPath`,
  no HUD. `playPath('ext-orbit')` = 8 s orbit at 24 m radius rising 1.7 → 8 m; `playPath('int-walk')`
  = 6 s walk from the door to the room centre with a slow pan (real time — Ayan's script records the
  video). `mode=portrait&agent=<agent_id>`: head-and-shoulders studio shot of that agent's avatar,
  3/4 view, three-point light, department-colour backdrop, 768 × 768, camera `'portrait'`, probes `[]`.
  `source=staging` loads `buildings/staging/<dept>.ts` (use `import.meta.glob`), `generated` loads
  `generatedModules`, `fallback` your archetypes. Ayan's `scripts/capture.ts`, the loop and the live
  round depend on this exactly.
- `buildings/index.ts`: `getModule(dept) = generatedModules[dept] ?? fallbackModule(dept)` with
  try/catch around `buildExterior/buildInterior` (on exception: rebuild with the fallback, warn).
  Promoting a live round rewrites `generated/<dept>.ts`; in dev, Vite HMR must rebuild that building.
- `kit/validateModule.ts` — the runtime validation rules from `05-world/09` §Validation.
- `city/layout.ts` produces **exactly** the numbers in `manifest.fallback.json` (from the frozen
  `world_layout.py`) — add a vitest that compares them (tolerance 0.05).
- Routes and query params used by the dashboard: `/view?venture=<vid>[&goto=<agent_id>][&quality=high|medium|low]`,
  "Back to dashboard" returns to the referring page.
- `window.__foundryDebug` (dev builds) `{ ready, scene, mode, travel(agentId), race(agentId), playerPos(), fps() }`
  for `world.spec.ts`; `scene` is `'city'` or `'interior:<dept>'`.
- Source cards link to the dashboard routes (`/tickets/<id>`, `/artifacts/<id>`, `/approvals`,
  `/computers/tasks/<id>`), opening in the dashboard.

## 6. Build steps (phases from `06-execution/01-12-hour-build-plan.md`)

Commit after each step with its tests green; append `T+hh:mm step — result` to
`docs/build-logs/mahin.md`; push the branch at every checkpoint. **Push the kit, fallback buildings
and capture page as early as possible** — Ayan's world loop tests against your branch in a worktree.

### Step A — Photoreal look kit (Phase 6a) — `05-world/12` §5, §9, `02-look-kit.md` (structure)
1. `kit/LookKit.ts` + `kit/post.ts`: `WebGLRenderer`, AgX tone mapping (ACES fallback), sRGB,
   PCFSoft shadows; EffectComposer `RenderPass` → `GTAOPass` → subtle `UnrealBloomPass` → `SMAAPass`
   → `OutputPass` (+ optional `LUTPass`, light vignette), per quality tier (§9).
2. `kit/lights.ts`: HDRI image-based light (PMREM) from the manifest's `hdris` (fallback `Sky` +
   PMREM), a warm sun matched to the HDRI sun direction with **CSM** in the city
   (`three/examples/jsm/csm/CSM.js`), interior preset (window sun + interior HDRI + practical lamps).
3. `assets/loadManifest.ts` (yours) + `kit/textures.ts`: load texture sets by tier (`{res}`),
   KTX2/WebP/JPG, anisotropy, colour spaces; **procedural PBR fallbacks** for every material key.
4. `kit/materials.ts`: every `MaterialKey` (+ city keys) as PBR (`MeshStandardMaterial`;
   `MeshPhysicalMaterial` for glass/car paint/fabric sheen), bindings + tints from the manifest,
   shared per key + accent.
5. `kit/primitives.ts` (implements `KitApi`): **UVs in metres** from each face's world size ÷
   `tileMeters`, macro variation on large surfaces, 1–2 cm bevels on exterior walls (High), realistic
   `window()` (frame, mullions, sill, physical glass, faint interior glow); records every call,
   builds meshes, converts `collide: true` into world-space OBB/circle colliders, merges static
   geometry by material, instances repeated models, records calls/bounds/triangles/lights/slots/
   entrance/sign for the probes. `kit/props.ts`: each `PropKind` = the manifest model scaled to
   `PROP_FOOTPRINTS` (meshopt decoder, LODs) or a procedural PBR prop. `kit/validateModule.ts`.
6. Render `buildings/example/house.example.ts` (exterior + interior) with zero errors and judge it
   against the quality bar (§1) — with and without assets.
7. Unit tests: kit validator, collider conversion, metre-UV generation, prop scaling to footprints.

### Step B — Town, buildings, movement (Phase 6b) — `05-world/01`, `03`, `04`, `06`, `12` §6
1. `buildings/fallback/archetypes.ts`: 4 archetypes × 13 configs matching each building's brief in
   `05-world/04-buildings.md`, with the architectural detail DESIGN.md asks Argon for (frames, sills,
   cornices, overhangs, gutters, steps, railings) and furnished, lived-in interiors from real props;
   every one must pass all probes (G-04). `buildings/index.ts`.
2. `city/`: `layout.ts` (+ test vs fallback manifest), `roads.ts` (asphalt, worn lane markings,
   concrete sidewalks, granite curbs), `plaza.ts` (stone paving, fountain with animated-normal water,
   concierge kiosk, benches, lamps, planters, parked car), `props.ts` (seed 1337: EZ-Tree species
   variants instanced with LOD/impostors, instanced grass blades near the player, street furniture,
   textured backdrop hills, r = 310 boundary), `signage.ts` (sign board meshes), `City.ts`.
3. `engine/` (`Engine.ts`, `Loop.ts`, `Input.ts`, `Quality.ts` with auto-downgrade, `SceneManager.ts`
   city ↔ interior with fades, `Audio.ts`), `interiors/` (`Interior.ts`, `loader.ts`; doors and exits).
4. `player/Player.ts` + `Collision.ts` (circle vs circle/OBB, 8 m spatial hash) with unit tests;
   `vehicle/Car.ts` (manifest vehicle or procedural car with clear-coat paint) + `ChaseCamera.ts`.
5. `nav/RoadGraph.ts` (from manifest nodes/edges), `astar.ts` (+ tests incl. the 181 ± 5 m path),
   `Gps.ts` (ribbon), `Race.ts` (ordered checkpoints, timer, best time in `localStorage` wrapped in
   try/catch, auto-enter on finish; checkpoint placement test), `FastTravel.ts` ("Take me there":
   fade, land facing the agent, auto-engage).
6. HUD shell (`hud/`): Hud.tsx, Crosshair, InteractPrompt, Toasts, PauseMenu (Back to dashboard,
   quality), MapOverlay (search agents/buildings, race/travel from the map), RaceHud, Fade,
   QualityToggle — clean and minimal so it never cheapens the realism. `WorldHost.tsx` mounts
   Engine + Hud at `/view`.
**Checkpoint:** `/view?mock=1` interactive in < 6 s; walk the plaza; drive the ring; enter/exit all
13 interiors; `pnpm test` (astar, collision, layout) green; ≥ 50 fps High; screenshots of the
plaza, 3 exteriors and 3 interiors meet the quality bar (W-12).

### Step C — Avatars & conversation (web side of Phase 7) — `05-world/12` §7, `05`, `07`, `08`
1. `npc/avatars.ts`: `pickAvatar(face, used)` — deterministic FaceSpec → manifest avatar (nearest
   `skinTone`, compatible hair, build/height, no repeats within a building, distinct Nova);
   `outfit_color` tints `outfitMaterial`. `npc/Character.ts`: load the glb (LOD0/LOD1), AnimationMixer
   for idle/talk clips when present, else procedural bones (breathing, sway, look-at via neck/head
   with the clamps in `05-world/05`, blink via morph targets or eyelids, talking gestures, greeting
   wave); sit at slots that face a chair. Fallback: the procedural character with PBR materials.
   `NpcManager.ts` (place NPCs at module `npcSlot`s from manifest `slot`; concierge at the plaza
   pose), `LookAt.ts`, `portraitFallback.ts`.
2. Mouths: give each `Character` a `LipSync` (Karthik's) and apply `lipSync.mouth` every frame to the
   jaw bone and viseme morph targets (talking animation runs while `lipSync.speaking`).
3. `ConversationController.ts` — orchestrates Karthik's modules: V down → `startListening(...)`,
   V up → transcript → `worldApi.talk/concierge` → `worldApi.tts` → `speak(text, tts, { lipSync })`;
   engage on E within range, typed input fallback (C-04), history, latency samples (STT, answer,
   TTS, total) → `postLatency`.
4. HUD: `ConversationPanel` (captions, check status updating from `answer.checked` or polling
   `GET /v1/answers/{id}`), `SourceCard`, `RouteCard` (Race there / Take me there).
5. Concierge: Nova auto-greets on arrival (C-02), route cards for routing questions; `?goto=<agent_id>`
   travels and engages on load.
6. Town Hall (`chief-of-staff`): E at the council table plays `standupLatest` — each update in that
   lead's voice with captions and source cards, then Rhea's decisions (CO-07).
**Checkpoint:** in mock mode: talk to Nova → cited answer with route card → race to Priya → talk
to a realistic avatar with lip-sync (browser voice); typing works with the mic denied.

### Step D — Capture page & probes (web side of Phase 8) — `05-world/10`, `13` §5, `12` §8
1. `capture/CapturePage.tsx` per §5 above (60 × 60 photoreal ground or interior shell, fixed time,
   High, cameras `ext-1..3` / `int-1..3` / `portrait`, `setCamera`, `playPath`).
2. `probes/probes.ts`: P1 loads (0 console errors), P2 bounds, P3 entrance + sign, P4 slots, P5
   reachability (0.25 m grid, 0.35 m inflation, BFS from (0, 5.4)), P6 overlap, P7 budget (exterior
   ≤ 250 k tris, interior ≤ 400 k, draw calls ≤ 150), P8 lights, P10 sign visible (projected area
   ≥ 1% + raycast). P9 is the script's job.
3. Verify: every fallback archetype scores 1.0 in exterior and interior (G-04) — add a vitest that
   runs the probes on recorded builds where possible (pure functions over the kit recording), and
   check the page manually: `/view/capture?building=engineering&mode=interior&source=fallback`,
   `…&mode=portrait&agent=eng.builder`, and `__foundryProbe.playPath('ext-orbit')` in the console.

### Step E — Performance & polish (Phase 9–10) — `05-world/12` §9–10, `11-performance.md`
1. Quality tiers + auto quality, LODs, impostors, instancing, merged geometry, texture tiers,
   shadow budgets; FPS overlay (W-09) at the new budgets.
2. `tests/e2e/world.spec.ts` via `__foundryDebug.travel(...)` for all 13 leads (W-03, W-07).
3. Audit W-10: nothing in the world changes with company state (only `npcs`/layout feed visuals).
4. Offline drill (kernel down → fallback manifest, "conversations unavailable"; W-11); no-assets
   drill (empty manifest → procedural PBR still looks good).

## 7. Definition of done

- Acceptance: **W-01…W-12, C-01, C-02, C-04, CO-07, G-04** (C-03/C-08/C-09 are shared with Karthik:
  you wire them, Karthik implements the voice pieces) (`06-execution/02-acceptance-criteria.md`).
- `cd web && pnpm typecheck && pnpm test` green (seed tests included); `pnpm build` succeeds.
- `make ownership WHO=mahin` clean. Branch pushed.
- `docs/build-logs/mahin.md` ends with a **Handoff** section: what works in mock vs live, with vs
  without assets, FPS on your machine per tier, probe scores of the fallbacks, quality-bar
  screenshots, open issues, contract requests (e.g. manifest fields you needed), and what to check
  first after the merge.

## 8. One-shot prompt for your coding agent

> You are building lane C (Mahin) of Foundry × Argon on branch `mahin` of this repo: the photoreal
> 3D world — it must look like a team of environment artists built it, never toy-like or pixelated.
> We enter Problem Statement 2 (More Dimensions). First read `architecture-files/README.md`,
> `architecture-files/00-overview/*`, `architecture-files/01-architecture/*`,
> `architecture-files/06-execution/07-team-split.md`, `architecture-files/05-world/12-photoreal-look.md`,
> the rest of `architecture-files/05-world/`, `architecture-files/templates/DESIGN.md`, and
> `WORKORDER_MAHIN.md`, then `argon-app/AGENTS.md`. Follow `WORKORDER_MAHIN.md` step by step
> (A → E), developing against `/view?mock=1`. Edit only files owned by mahin (check with
> `make ownership WHO=mahin`); never edit frozen contracts — write requests in
> `argon-app/docs/contract-requests/mahin.md`. Keep `web/tests/unit/seed.contracts.test.ts` green.
> After each step: run `pnpm typecheck && pnpm test`, append to `argon-app/docs/build-logs/mahin.md`,
> commit, and push `mahin`.
