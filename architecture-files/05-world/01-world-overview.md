# 01 — "Enter the View": World Overview

> **Prior art in the old repo** — the old repo's HQ (`src/hq/scene.ts`, `src/hq/departments.ts`) is a 2D pixel canvas — keep only the idea of a place you visit, not the code. Nothing in the old repo is 3D. What may and may not be reused: [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

A real-time 3D town in the browser where the company's agents live. You walk in first person,
drive a car, enter buildings, and talk to agents by voice. **The world never displays company
state** — only conversations are live.

## Route and mounting

- Route: `/view?venture=<vid>[&goto=<agent_id>][&quality=high|medium|low]`.
- `WorldHost.tsx` mounts a full-viewport `<canvas>` and the React `<Hud/>` overlay, creates
  `new Engine(canvas, opts)` once, and calls `engine.dispose()` on unmount.
- The engine loads the manifest from `GET /v1/world/manifest` (fallback:
  `web/src/world/data/manifest.fallback.json`), builds the city, then fades in.
- Loading screen: Foundry logo, "Opening the doors…", progress bar from the engine's asset loader.

## First 10 seconds (scripted)

1. Spawn in the plaza at `(0, 1.65, 16)` looking toward −Z. In front: the Concierge (Nova) at
   `(0, 0, 11.5)` beside a small kiosk; behind Nova the fountain; beyond it the north avenue leading
   to The Arrivals Hall (D01).
2. 0.8 s after the fade-in completes, the conversation with the Concierge auto-engages and the
   greeting plays: "Welcome back! I'm Nova. Ask me anything about the company — or I'll point you
   to whoever knows best."
3. A hint toast: "Hold **V** to talk · **Enter** to type · **WASD** to walk · **M** for the map".
4. Pressing any movement key during the greeting ends the auto-engagement politely (Nova: "Go
   explore — I'm here when you need me." is NOT spoken; just stop audio and disengage).

## Core loops

- **Ask → route → go → ask.** Ask Nova a question → Nova answers with sources → if another agent
  knows more, a route card appears → **Race there** or **Take me there** → you arrive facing that
  agent, conversation auto-engages with their greeting → ask your question.
- **Explore.** Walk or drive anywhere; enter any building through its door ring (E); talk to anyone.
- **Map.** Press M → click a building → pick an agent → race or travel.

## Controls (`engine/Input.ts`)

| Key | On foot | In car | In conversation |
|---|---|---|---|
| Mouse | look (pointer lock) | — (chase cam) | limited look (±25°) |
| W A S D | move | throttle / steer / brake-reverse | leave conversation (any) |
| Shift | sprint | — | — |
| Space | — | handbrake | — |
| E | interact (agent, door, car) | exit car | leave conversation |
| V (hold) | talk to nearest agent within 2.2 m (engages if not engaged) | — | push-to-talk |
| Enter | — | — | open text input |
| 1 / 2 | — | — | route card: Race / Take me there |
| M | map | map | map |
| R | — | reset car to nearest road node | — |
| Q | — | abandon race | — |
| Esc | pause menu (Resume, Quality, Mute music, Back to dashboard) | same | leave conversation (first press) |

Clicking the canvas acquires pointer lock. Pointer lock is released while the map, pause menu or
text input is open.

## Engine structure (`world/engine/`)

```ts
class Engine {
  constructor(canvas: HTMLCanvasElement, opts: { ventureId: string; quality: Quality; goto?: string; hud: HudBridge });
  start(): Promise<void>;          // load manifest, kit, city; start loop
  dispose(): void;
  // state
  mode: 'loading' | 'foot' | 'car' | 'conversation' | 'race' | 'map' | 'paused' | 'transition';
  scene: SceneManager;             // 'city' | `interior:${departmentId}`
  player: Player; car: Car; npcs: NpcManager; nav: Nav; conversation: ConversationController;
}
```

- `Loop.ts`: `requestAnimationFrame`, fixed-step update at 60 Hz for movement/physics
  (accumulator, max 5 steps per frame), render every frame; `dt` clamped to 0.05.
- `HudBridge`: a small event emitter the engine uses to push state to React (`mode`,
  `prompt`, `conversation`, `routeCard`, `race`, `toasts`, `fps`) and receive commands
  (`race(agentId)`, `travel(agentId)`, `sendText(text)`, `closeMap()`, `setQuality()`).
- `SceneManager.switchTo(target, spawn)`: fade out 300 ms → build/get cached scene → place player
  → fade in 300 ms. Caches up to 4 interiors (LRU; dispose geometries/materials/textures on evict).

## Files in this section

| File | Topic |
|---|---|
| [`00-game-experience.md`](00-game-experience.md) | **The player journey** — what the founder sees, hears and does, moment by moment |
| [`02-look-kit.md`](02-look-kit.md) | Renderer, lighting, post-processing, materials, palette — the visual standard |
| [`03-city-layout.md`](03-city-layout.md) | Exact geometry of plaza, roads, plots, props; the manifest |
| [`04-buildings.md`](04-buildings.md) | The 13 buildings: exterior and interior design, NPC slots |
| [`05-characters-and-faces.md`](05-characters-and-faces.md) | Procedural characters, FaceSpec, animation, lip-sync |
| [`06-navigation-race-travel.md`](06-navigation-race-travel.md) | Player, collision, car, road graph, GPS, race, fast travel, map |
| [`07-npc-conversation.md`](07-npc-conversation.md) | Talking to agents: flow, HUD, audio, source cards |
| [`08-concierge.md`](08-concierge.md) | The Concierge and route cards |
| [`09-worldgen-pipeline.md`](09-worldgen-pipeline.md) | How Argon generates the buildings; kit API contract; validation |
| [`10-render-critique-loop.md`](10-render-critique-loop.md) | Render → probe → critique → patch loop and scores |
| [`11-performance.md`](11-performance.md) | Budgets, quality tiers, disposal |
