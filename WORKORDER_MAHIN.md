# WORK ORDER — Mahin (branch `mahin`)

**Lane C: the 3D world — "Enter the view".** You build the first-person town the founder walks
into: the look kit, the city and its 13 department buildings (with interiors), the player and the
car, navigation (walk, race, fast travel, map), the 29 characters with generated faces (mouths
driven by Karthik's lip-sync), the conversation experience (push-to-talk, cited answers, source
and route cards), the Concierge in the plaza, Town Hall standup playback, the capture page + probes that Argon's
render → critique → fix loop uses, and performance. The world never shows company state; only the
conversations are live. The low-level voice pieces — `npc/visemes.ts`, `npc/LipSync.ts`,
`conversation/Mic.ts`, `Stt.ts`, `Speech.ts` — are Karthik's; you call them.

---

## 0. Read first — on `main`, before writing any code

Read these in order (they are on every branch, under `architecture-files/`):

1. `architecture-files/README.md` — the whole thing, including "Why we're building this".
2. `00-overview/*` (vision, hackathon context, glossary, ADRs, feature catalog).
3. `01-architecture/*` (system overview, repo layout, data model, **API contract**, orchestration, security).
4. `06-execution/07-team-split.md` — who owns what, the frozen contracts, the cross-branch
   interfaces and the merge plan. **This work order is the Mahin column of that document.**
5. `06-execution/06-agent-operating-rules.md`, `02-acceptance-criteria.md` (W-, C-, CO-07, G-04),
   `03-testing-strategy.md` (unit + `world.spec.ts`), `05-risk-register-and-fallbacks.md`.
6. Your sections: **all of `05-world/`** (00-game-experience → 11-performance), `templates/DESIGN.md`,
   `assets/reference-bedroom.webp` (the visual target), skim `02-models-and-integrations/05-elevenlabs-voice.md`
   and `06-speech-to-text.md` (Karthik implements them; you orchestrate),
   `03-company-kernel/06-group-chats.md` §In the world.
7. `argon-app/AGENTS.md` and every seed file you own (they start with `// OWNER: mahin`), plus the
   frozen world contracts: `web/src/world/kit/types.ts`, `npc/FaceSpec.ts`, `probes/types.ts`,
   `buildings/example/house.example.ts`, `src/shared/contracts.ts`, `data/manifest.fallback.json`.

The spec is the contract. If this work order and the spec ever disagree, follow the spec and log it
in `argon-app/docs/decisions/mahin.md`.

## 1. Setup

```bash
git fetch origin && git checkout mahin
cd argon-app/web && pnpm install && pnpm typecheck && pnpm test   # 5 passed
pnpm dev                                                          # http://localhost:5173/view?mock=1
# optional: run the seed kernel too (cd ../kernel && uv sync --extra dev && LLM_MODE=fake make -C .. kernel)
```

You don't need any API keys or a running kernel: **build against `/view?mock=1`** (fixtures in
`src/world/data/mock/`, offline manifest in `src/world/data/manifest.fallback.json`). Also test the
live path with the kernel down: `/view` must load from the fallback manifest and show
"conversations unavailable" (W-11).

## 2. What you own (edit only these)

**Web** (`argon-app/web/`): everything under `src/world/` **except** the frozen files
(`kit/types.ts`, `npc/FaceSpec.ts`, `probes/types.ts`, `buildings/example/*`,
`data/manifest.fallback.json`) and Ayan's generated paths (`buildings/generated/*`,
`buildings/staging/*`). That includes `WorldHost.tsx`, `engine/`, `kit/` (all but `types.ts`),
`city/`, `interiors/`, `buildings/index.ts`, `buildings/fallback/`, `player/`, `vehicle/`, `nav/`,
`npc/` (all but `FaceSpec.ts`, `visemes.ts`, `LipSync.ts`), `conversation/` (all but `Mic.ts`,
`Stt.ts`, `Speech.ts`), `probes/probes.ts`, `capture/CapturePage.tsx`,
`hud/` (incl. `hud.css`), `data/mock/*`.
Also `src/shared/worldApi.ts` (the world's only kernel client — extend it, e.g. add
`answer(id)` and an SSE subscription for `answer.checked`), `tests/unit/world/**`,
`tests/e2e/world.spec.ts`, and `docs/{build-logs,decisions,verified,contract-requests}/mahin.md`.

## 3. Never touch

Frozen: `src/App.tsx`, `main.tsx`, `src/shared/contracts.ts`, `styles/tokens.css`, the frozen world
files above, `vite.config.ts`, `tsconfig*.json`, `playwright.config.ts`, `index.html`,
`tests/unit/seed.contracts.test.ts`, `Makefile`, `AGENTS.md`, `docs/*.md`, `architecture-files/**`.
Tanush's: `src/dashboard/**`, `src/api/**`, `styles/app.css`, the whole kernel except Ayan's parts.
Ayan's: `scripts/capture.ts`, `public/generated/**`, `buildings/generated|staging`, kernel
models/engineering/worldgen.
Karthik's: `npc/visemes.ts`, `npc/LipSync.ts`, `conversation/Mic.ts`, `Stt.ts`, `Speech.ts`,
`tests/unit/voice/**`, kernel `voice/*` + `api/voice.py`.
Need a change there (e.g. a new manifest field or API shape)? → `docs/contract-requests/mahin.md`
and an adapter in your own files. Check before every push: `make ownership WHO=mahin` (from `argon-app/`).

## 4. What you can rely on (from others — already in the seed)

| You need | Use | Seed / fallback behaviour |
|---|---|---|
| City data | `getWorldApi().manifest(ventureId)` → `{ manifest, offline }` | Live `GET /v1/world/manifest`, else `manifest.fallback.json` (13 buildings, 52 road nodes, 65 edges, 29 NPCs; `face: null`) |
| Conversations | `worldApi.talk`, `concierge`, `tts`, `transcribe`, `standupLatest`, `postLatency` | `?mock=1` fixtures; live endpoints are empty until Tanush/Ayan land — handle errors gracefully |
| Kit contract | `kit/types.ts` (`KitApi`, `BuildingModule`, `MaterialKey`, `PropKind`) | Final, verbatim from `05-world/09` |
| Faces | `npc/FaceSpec.ts`; `ManifestNpc.face` | `null` until Ayan generates `faces.json` → build a **deterministic seed fallback** from a hash of `agent_id` (all enums from `FaceSpec.ts`) so all 29 characters are distinct (C-01) |
| Portraits | `/generated/portraits/<agent_id>.png` | Missing → render the character's head to a 256×256 render target (`npc/portraitFallback.ts`) |
| Signs, textures | `/generated/signs/<dept>.png`, `/generated/textures/<name>.png` | Missing → canvas-drawn sign (building name, department color, 4:1) and procedural textures (`kit/textures.ts`) |
| Generated buildings | `buildings/generated/index.ts` → `generatedModules` | Empty → every building uses your fallback archetype |
| Voice audio | `TtsResponse` (`audio_url` + `alignment`, or `provider: 'browser'`) | Mock/seed → `browser` → `speechSynthesis` + boundary-driven lip-sync |
| STT | `SttResponse` (`provider: 'none'` = use browser `SpeechRecognition`) | `none` |
| Lip-sync (Karthik) | `const ls = new LipSync()`; each frame `ls.update(dt)` then read `ls.mouth` (`{open, width}` in meters) to set the mouth cavity/lips; `REST` mouth when idle | Seed: mouth stays at Rest |
| Speech playback (Karthik) | `speak(text, ttsResponse \| null, { lipSync, onCaption })` → `{ started, done, stop }` | Seed: browser `speechSynthesis`, no lip-sync |
| Push-to-talk (Karthik) | `Mic.supported()`; `startListening({ transcribe: worldApi.transcribe })` on V down → `session.stop()` on V up → `{ text, provider, latency_ms }`; empty text → offer typing | Seed: always empty → typing fallback |

## 5. What others rely on from you (keep these)

- **Capture handshake** (`probes/types.ts`, frozen): `/view/capture?building=<dept>&mode=exterior|interior&source=staging|generated|fallback`
  sets `window.__foundryProbe = { ready, error?, result: ProbeResult, setCamera(name) }` with the
  probes for that mode (exterior P1 P2 P3 P6 P7 P8 P10; interior P1 P2 P4 P5 P6 P7 P8), the 6 camera
  poses from `05-world/10` §1, High quality, no animation, no HUD. `source=staging` loads
  `buildings/staging/<dept>.ts` (use `import.meta.glob`), `generated` loads `generatedModules`,
  `fallback` your archetypes. Ayan's `scripts/capture.ts` and the kernel loop depend on it exactly.
- `buildings/index.ts`: `getModule(dept) = generatedModules[dept] ?? fallbackModule(dept)` with
  try/catch around `buildExterior/buildInterior` (on exception: rebuild with the fallback, warn).
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
`docs/build-logs/mahin.md`; push the branch at every checkpoint. **Push the kit + fallback buildings
as early as possible** — Ayan's worldgen loop can test against your branch in a worktree.

### Step A — Look kit (Phase 6a) — `05-world/02-look-kit.md`, `templates/DESIGN.md`
1. `kit/materials.ts` (every `MaterialKey`), `kit/textures.ts` (procedural fallbacks + loader for
   `/generated/textures/*`), `kit/lights.ts` (lighting preset), `kit/post.ts` (post-processing per
   quality), `kit/LookKit.ts`, `kit/primitives.ts` (implements `KitApi`: records every call, builds
   meshes, converts `collide: true` into world-space OBB/circle colliders, merges static geometry by
   material, records calls/bounds/triangles/lights/slots/entrance/sign for the probes),
   `kit/props.ts` (every `PropKind`, sized for a 1.75 m person; exports the footprint table Ayan's
   prompt needs), `kit/validateModule.ts`. Three.js add-ons from `three/examples/jsm/...`.
2. Render `buildings/example/house.example.ts` (exterior + interior) with zero errors.
3. Unit tests: kit validator, collider conversion, prop footprints.

### Step B — Town, buildings, movement (Phase 6b) — `05-world/01`, `03`, `04`, `06`, `11`
1. `buildings/fallback/archetypes.ts`: 4 archetypes × 13 configs matching each building's brief in
   `05-world/04-buildings.md`; every one must pass all probes (G-04). `buildings/index.ts`.
2. `city/` (`layout.ts` + test vs fallback manifest, `roads.ts`, `plaza.ts` incl. fountain, concierge
   kiosk, benches, lamps, flower beds, parked car; `props.ts` with `mulberry32(1337)` trees/lamps/hills
   and the r = 310 boundary; `signage.ts`), `City.ts`.
3. `engine/` (`Engine.ts`, `Loop.ts`, `Input.ts`, `Quality.ts` with auto-downgrade, `SceneManager.ts`
   city ↔ interior with fades, `Audio.ts`), `interiors/` (`Interior.ts`, `loader.ts`; doors and exits).
4. `player/Player.ts` + `Collision.ts` (circle vs circle/OBB, 8 m spatial hash) with unit tests;
   `vehicle/Car.ts` + `ChaseCamera.ts` (enter/exit, collisions, reset).
5. `nav/RoadGraph.ts` (from manifest nodes/edges), `astar.ts` (+ tests incl. the 181 ± 5 m path),
   `Gps.ts` (ribbon), `Race.ts` (ordered checkpoints, timer, best time in `localStorage` wrapped in
   try/catch, auto-enter on finish; checkpoint placement test), `FastTravel.ts` ("Take me there":
   fade, land facing the agent, auto-engage).
6. HUD shell (`hud/`): Hud.tsx, Crosshair, InteractPrompt, Toasts, PauseMenu (Back to dashboard,
   quality), MapOverlay (search agents/buildings, race/travel from the map), RaceHud, Fade,
   QualityToggle. `WorldHost.tsx` mounts Engine + Hud at `/view`.
**Checkpoint:** `/view?mock=1` interactive in < 6 s; walk the plaza; drive the ring; enter/exit all
13 interiors; `pnpm test` (astar, collision, layout) green; ≥ 50 fps High.

### Step C — Characters & conversation (web side of Phase 7) — `05-world/05`, `07`, `08`
1. `npc/Character.ts` (FaceSpec → primitives per the table; seed fallback; ≤ 12k triangles; merged
   static parts), animations (breathing, sway, blink, look-at, listening, thinking, talking,
   greeting), `NpcManager.ts` (place NPCs at module `npcSlot`s from manifest `slot`; concierge at
   the plaza pose), `LookAt.ts`, `portraitFallback.ts`.
2. Mouths: give each `Character` a `LipSync` (Karthik's) and apply `lipSync.mouth` to the mouth
   group every frame (talking animation runs while `lipSync.speaking`).
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
with lip-synced (browser) voice; typing works with the mic denied.

### Step D — Capture page & probes (web side of Phase 8) — `05-world/10`
1. `capture/CapturePage.tsx` per §5 above (60 × 60 grass plane or interior shell, fixed time, High,
   cameras `ext-1..3` / `int-1..3`, `setCamera`).
2. `probes/probes.ts`: P1 loads (0 console errors), P2 bounds, P3 entrance + sign, P4 slots, P5
   reachability (0.25 m grid, 0.35 m inflation, BFS from (0, 5.4)), P6 overlap, P7 budget, P8 lights,
   P10 sign visible (projected area ≥ 1% + raycast). P9 is the script's job.
3. Verify: every fallback archetype scores 1.0 in exterior and interior (G-04) — add a vitest that
   runs the probes on recorded builds where possible (pure functions over the kit recording), and
   check the page manually: `/view/capture?building=engineering&mode=interior&source=fallback`.

### Step E — Performance & polish (Phase 9–10) — `05-world/11-performance.md`
1. Quality tiers + auto quality, instancing, merged geometry, shadow budgets; FPS overlay (W-09).
2. `tests/e2e/world.spec.ts` via `__foundryDebug.travel(...)` for all 13 leads (W-03, W-07).
3. Audit W-10: nothing in the world changes with company state (only `npcs`/layout feed visuals).
4. Offline drill (kernel down → fallback manifest, "conversations unavailable"; W-11).

## 7. Definition of done

- Acceptance: **W-01…W-11, C-01, C-02, C-04, CO-07, G-04** (C-03/C-08/C-09 are shared with Karthik:
  you wire them, Karthik implements the voice pieces).
  (`06-execution/02-acceptance-criteria.md`).
- `cd web && pnpm typecheck && pnpm test` green (seed tests included); `pnpm build` succeeds.
- `make ownership WHO=mahin` clean. Branch pushed.
- `docs/build-logs/mahin.md` ends with a **Handoff** section: what works in mock vs live, FPS on
  your machine per tier, probe scores of the fallbacks, open issues, contract requests (e.g. any
  manifest/API fields you needed), and what to check first after the merge.

## 8. One-shot prompt for your coding agent

> You are building lane C (Mahin) of Foundry × Argon on branch `mahin` of this repo: the 3D world.
> First read `architecture-files/README.md`, `architecture-files/00-overview/*`,
> `architecture-files/01-architecture/*`, `architecture-files/06-execution/07-team-split.md`, all of
> `architecture-files/05-world/`, `architecture-files/templates/DESIGN.md`, and `WORKORDER_MAHIN.md`,
> then `argon-app/AGENTS.md`. Look at `architecture-files/assets/reference-bedroom.webp` — it is the
> visual target. Follow `WORKORDER_MAHIN.md` step by step (A → E), developing against
> `/view?mock=1`. Edit only files owned by mahin (check with `make ownership WHO=mahin`); never edit
> frozen contracts — write requests in `argon-app/docs/contract-requests/mahin.md`. Keep
> `web/tests/unit/seed.contracts.test.ts` green. After each step: run `pnpm typecheck && pnpm test`,
> append to `argon-app/docs/build-logs/mahin.md`, commit, and push `mahin`.
