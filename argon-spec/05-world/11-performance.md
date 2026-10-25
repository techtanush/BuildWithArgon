# 11 — Performance

Target: ≥ 50 fps at High and ≥ 60 fps at Medium on the demo laptop (assume an Apple M-series or
a recent integrated GPU), 1080p window.

## Budgets

| Scope | Triangles | Draw calls | Lights (non-shadow) | Shadow casters |
|---|---|---|---|---|
| City (all exteriors + roads + props) | ≤ 1.2 M | ≤ 400 | sun + hemisphere | buildings, car, NPCs, trees (High only) |
| One interior | ≤ 150 k (incl. ≤ 6 NPCs) | ≤ 120 | ≤ 4 | 1 directional |
| Character | ≤ 12 k | ≤ 12 | — | yes |

## Techniques (MUST)

- **Merge static geometry** per building per material (`BufferGeometryUtils.mergeGeometries`)
  after `buildExterior` / `buildInterior` complete.
- **Instancing** for trees, lamps, lane dashes, benches, flower dots (`InstancedMesh`).
- **Shared materials** (one instance per key per accent color).
- **Interiors built on demand** and cached (LRU of 4); evicted scenes call `geometry.dispose()`,
  `material.dispose()` (only non-shared), `texture.dispose()`.
- **NPCs only exist in their scene**: the plaza has 1 (Nova); each interior has ≤ 6.
- **Shadow camera follows the player** in the city (±60 m), not the whole town.
- **Frustum culling** on (default) — make sure merged meshes have correct bounding spheres
  (`computeBoundingSphere()` after merging).
- **Textures** ≤ 1024², mipmaps on, anisotropy 8 (4 on Medium).
- **Pixel ratio** capped per quality tier.
- **No per-frame allocations** in hot paths (reuse vectors/quaternions).

## Measuring

- `VITE_SHOW_FPS=true` shows an FPS/ms overlay (rolling 60-frame average) and
  `renderer.info.render.{calls,triangles}`.
- e2e test `world.spec.ts` asserts the world reaches `ready` within 10 s on the CI machine and that
  `renderer.info.render.calls` in the city ≤ 400.

## Loading

- Generated textures and portraits load lazily with `THREE.TextureLoader`; the city shows with
  fallback canvas textures first and swaps when loaded (no layout change).
- Audio (greetings) preloads for Nova only; others load on engagement (cache makes it fast).
