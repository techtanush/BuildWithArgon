# Mahin: world implementation handoff

## 2026-10-25 implementation

- Downloaded authenticated `mahin` branch archive at upstream commit `a420c8c5d991ae39ceafb8f4a7691a64631cbd47`. CLI Git authentication was unavailable. Local Git is an isolated snapshot on branch `mahin`, not a fetched upstream history. Do not push this unrelated history. Reapply the implementation patch to an authenticated upstream checkout before any future PR.
- Built PBR renderer, procedural material fallback library, 29 prop types, module validation, 13 fallback exteriors/interiors, recorded geometry/colliders, city surfaces/scenery, plaza and signs.
- Built walking/sprinting, circle/OBB swept collision, car/chase camera, graph/A*, GPS ribbon, ordered checkpoint races, fast travel, map search, all 29 roster characters, conversation UI, citations and source links.
- Built deterministic fallback avatars plus optional GLB/LOD/sitting support, voice adapter orchestration, greeting/text fallback, bounded live requests, answer-check polling and stale-response cancellation.
- Built exterior/interior/portrait capture and the frozen camera/path handshake, real geometry/reachability/visibility probes, strict requested-source failures.
- No Gemini/Argon calls were made. All current buildings/characters are coding-agent-authored fallbacks. Mock conversations are clearly labeled and use the existing fixtures, not live company data.
- User instruction: do not change `main`, do not open a PR. User tests the local preview first.

## Verification

- TypeScript: passed.
- Unit tests: 148 passed across 11 files, including all seven original seed tests.
- Production Vite build: passed.
- Real browser: all 13 leads reached in the correct interior, conversation auto-engaged, exit returned to city, finite positions, no page errors.
- Real browser: Nova question -> cited/verified fixture answer -> route card -> travel to Priya passed. Directory search for Zara returned one match. Race launch/countdown and car acceleration (52 km/h), plus reset key exercised.
- Real browser: kernel absent -> fallback town loaded, offline banner shown and chat controls disabled.
- Real browser: all 26 fallback exterior/interior capture pages passed every applicable browser probe, including P10. Sign was widened from 5.6m to 6.4m after P10 initially measured 0.87%; final measurement 1.14% with clear center ray.
- Camera paths measured 8.008s exterior, 6.005s interior. Portrait capture ready, no errors, empty probes as specified.
- FPS observed roughly 59-60 High in the visible browser during plaza/interior checks. Not a formal full-device benchmark. Displayed draw count includes shadow and postprocessing passes, unlike the per-building probe count. Low/Medium and sustained race performance still require user hardware testing.
- Standalone Playwright CLI suite was written but could not launch Chrome in the local sandbox (SIGABRT/EPERM). Equivalent key browser checks above were performed using the connected browser. Do not report the CLI suite as passed.

## Local environment

Preview: `http://127.0.0.1:5173/view?mock=1` (Vite must remain running).
Normal commands: `cd argon-app/web && pnpm install && pnpm typecheck && pnpm test && pnpm dev`.

This session's macOS environment rejected downloaded native Rollup/esbuild binaries. I did not change OS security settings. Installed local, untracked WebAssembly alternatives under the session temporary directory and redirected only ignored `node_modules` to them. This workaround is local and may need to be repeated if the session temporary folder is cleaned. Committed dependency files are unchanged; normal supported machines can use the lockfile normally.

## Handoff: not yet complete / blocked integrations

- [blocked] Live Argon generation/critique/repair and live company answers require Ayan/Tanush implementations and their backend credentials. No end-to-end live loop claimed.
- [blocked] Real microphone transcription and moving-mouth audio alignment require Karthik's voice modules. His borrowed seed files are untouched. Browser speech/text fallbacks are wired; no real lip-sync claim.
- [blocked] Photoreal W-12 quality has NOT been met or scored by Argon. Asset manifest is empty. Current screenshots show procedural architecture, furniture, vegetation and human fallbacks, not real scanned assets/Rocketbox models. Karthik supplies licensed assets; final visual review is required.
- Material maps/HDRI, vehicle and avatar manifest adapters exist. Prop loader/normalization is available as `loadPropModels`; scene-wide asynchronous model replacement remains to be wired when real prop assets are supplied. Procedural props remain usable.
- Environment lighting, auto quality and disposal work in the local browser, but a formal 1080p sustained performance/texture-memory audit remains open.
- Hot-promoted building module changes dispatch a dev event that reloads the world, rather than patching only one building while preserving player state.
- Standup playback includes updates and decisions, but the full source-card playback presentation is still less developed than normal conversations.
- Advanced vegetation (EZ-Tree/grass blades/impostors), a full soundscape, and exact visual fidelity of every department brief remain polish work, not claimed complete.

## First checks after integrating the other branches

1. Keep every frozen contract unchanged. Run the ownership audit and seed tests.
2. Load live `/view?venture=<real-id>` and test Nova -> route -> agent -> cited answer.
3. Verify Karthik's mic/STT, speech timing and lip-sync contracts on one avatar before all 29.
4. Load licensed assets, compare capture portraits to world avatars, test missing-asset fallbacks.
5. Generate one real Argon building, run exterior/interior captures + video critique, repair and promote. Preserve actual before/after evidence; do not label fallback geometry as generated.
6. User requested `https://santheftauto.com/` as a visual/generation reference. Apply its inspected game-environment cues within Foundry's frozen layout and purpose, not its assets/code.

### Reference-site observation

San Theft Auto's public landing UI describes a San Francisco arcade race and provides city-map, race, and free-exploration entry points. Its 3D city failed to finish loading in this browser with a texture/sky/city asset timeout; a retry was attempted. No unseen visual qualities, copied assets, or Argon-generated reference adaptation are claimed. Reference use remains pending a successful load or supplied imagery.

## 2026-10-25: city redesign and character direction

- User rejected the circular campus and explicitly requested streets/blocks inspired by San Theft Auto. Added a viewer-only urban manifest adapter: 49 grid intersections, 13 department stops, 72m blocks, western hills and an east waterfront. Frozen manifest/contracts, department/agent IDs and backend APIs remain unchanged. Use ?layout=campus for legacy comparison.
- Added dense original facade geometry, storefronts, skyline, pavement/crosswalks, street signs/signals, parked vehicles, streetlights, trees, square planting, bay water, piers, distant bridge and headlands. No San Theft Auto code, character art or models were copied. These are still coding-agent-authored procedural visuals, NOT Argon output or photoreal acceptance.
- Updated city directory/minimap, road recognition, elevation-aware walking/driving/chase camera, GPS and race checkpoint heights. Verified all 156 distinct department-to-department routes remain on streets; separated two originally overlapping drop-offs.
- Optimized static department exteriors: test inventory 233 to 67 visible meshes, including an opaque exterior-glass batch. Interiors retain their original materials. Shadow refresh is throttled and medium quality avoids the expensive AO pass. Fixed a high-quality exterior/interior transition crash by clearing renderer material caches after CSM removes its injected uniforms.
- Final verification: TypeScript and production build pass; 175 unit tests across 16 files pass. Connected browser at High: all 13 lead conversations showed the correct name and interior and returned to the city, with zero recorded page errors. Car acceleration/braking and a 34m street drive were exercised separately. Standalone Playwright CLI did NOT run: isolated Chromium was unavailable; an attempted browser download was cancelled. Do not claim that CLI suite passed.
- Performance is not formally accepted: observed results varied by scene and quality; sustained 1080p/real-device profiling remains open. Tests establish functionality, not photoreal quality.

### Realistic character direction and ownership

- User clarified Karthik owns voice/lip-sync and the asset pipeline. Do not implement Audio2Face inference or change his voice modules here. Mahin owns avatar rendering/appearance and consuming supplied rigged assets; Ayan owns Argon generation/critique orchestration.
- Inspected the actual reference workflow: https://github.com/naderkhalil/santheftauto/blob/main/BLENDER_ASSETS.md . Its Elon/Jensen/etc. drivers use approved image concepts, Meshy 7.1 textured sculpts, Blender optimization and shared PBR atlases. The authors call them stylized interpretations, not scans. Shipped drivers are portraits/seated upper bodies, explicitly without walking bodies, skeletons or facial animation. Their assets are not covered by the source-code license. Reuse the PROCESS as inspiration, not the assets or likenesses.
- Official Argon workflow inspected: https://aistudio.google.com/learn/building-3d-games-and-worlds-with-gemini-4-argon . Use Argon for the Blender/Three.js build, multimodal references, strict art-direction critique and rendered iteration; Nano Banana target images are references, not evidence the 3D avatar meets the target.
- NVIDIA Audio2Face-3D converts speech into ARKit-style facial animation for an existing rigged character. It does not create a realistic character mesh. Its SDK requires Windows/Linux plus NVIDIA CUDA/TensorRT, so it is not a native Mac/browser inference solution. Karthik should host the service or use an approved hosted provider and supply timing/blendshape output; do not add pretend lip-sync.
- [blocked] No working Argon character generator, populated character manifest or credential configuration was found in this checkout. No new realistic avatar has been generated. Next real-asset milestone is ONE original full-body, rigged character with PBR skin/eyes/hair/clothing, facial targets, measured LOD/texture budgets, and an actual in-engine portrait/conversation review before expanding to 29.
- Everything remains local on mahin. No push, PR, or main changes. The isolated archive-derived Git history still must not be pushed upstream.

## 2026-10-25: local visual asset and rendering pass

- Added an original AI-generated coastal broadleaf texture card (1024px RGBA WebP, 186KB after final matte cleanup) under `src/world/assets/original/`, with provenance. It is NOT Argon-generated and not copied from the reference game. Replaced the faceted street-tree crowns with layered, rotated alpha-cut foliage cards and tapered branches; custom depth/distance materials retain the same cutout shadows. Street-life budget: 90,088 triangles / 19 draw calls; original placement/collision envelopes preserved.
- Facades now have real-meter PBR UVs, varied window/floor proportions, neutral daylight glazing, deeper jamb/lintel returns, bay cornices, recessed shops, eight original bitmap shop names and selective awnings. 420-building budget: 17 batches / 231,368 triangles; additional tested seeds remain below 239K triangles. No road/plaza clearance regression.
- Refined coastal sun/sky balance, haze and bloom; added restrained asphalt variation, worn paint, raised curbs, drains and manhole covers. These remain original procedural scene details, not scanned meshes.
- Real assets are available only in the LOCAL INTEGRATION PREVIEW through a dev-only, loopback-only `assetBase` bridge to Karthik's read-only asset server. No changes to his pipeline/public assets, voice modules, or frozen contracts. Normal production loading still uses `/assets/manifest.json`; the local checked-in manifest remains empty.
- Preview: `http://127.0.0.1:5173/view?mock=1&assetBase=http://127.0.0.1:5174/assets`. Both Vite servers must run for the external sample assets. Confirmed exterior `polyhaven/kloofendal_38d_partly_cloudy`, interior `polyhaven/studio_small_03` and scanned `polyhaven/wood_floor` in the renderer. ArmChair_01 is available in the supplied manifest but has NOT been swapped into scene props, so no model-integration claim.
- Fixed scanned-map double-tinting, physical binding/sheenColor handling, partial-load cleanup and asynchronous disposal. Texture leases share decoded/GPU maps across department libraries; fallback maps have explicit ownership. Awaited main-library load before cloning exterior facade materials. Stale HDRI requests cannot replace the environment of a later scene.
- Verification: 196 unit tests across 18 files, TypeScript and production build pass. Connected-browser High-quality check with the real sample assets: all 13 lead conversations showed the expected named agent/interior and returned to the city; zero recorded page errors. Actual foliage/road/storefront render inspected from matched street/square camera positions. Tests establish functionality and resource budgets, not photoreal quality. CLI Playwright was not used for this pass.
- [blocked] Real rigged characters and Argon generation remain separate unfinished integrations. The larger scanned exterior inventory is still being built/verified by Karthik; this pass does not claim it is present. The city remains stylized, and sustained 1080p performance/texture-memory acceptance remains open (observed High FPS varied with scene/transitions).
- Everything in this checkout remains local/uncommitted for user review. No push, PR or main changes. Reapply to a real authenticated upstream checkout before any eventual PR because this Git history is archive-derived.

- Final standalone fallback check: normal `/view?mock=1` loaded with procedural environment and no external texture entries; car enter/exit controls passed. Final asset-enabled preview was restored and left playable. Last build passed after foliage matte cleanup; zero recorded page errors across this review. Proof: `tmp/foundry-assets-final.webp`; conversation results: `tmp/visual-assets-qa.json` in this session.

## 2026-10-25: authorized upstream PR integration

The user explicitly authorized publishing the completed Mahin feature set and opening a PR, and stopped further character-interaction work. No new character work was added after that instruction.

- Reapplied only Mahin-owned changes onto the authenticated current `main` source at `f0384e90db2fe2c99a116a539badcf6b283f654c`; all 78 feature files applied without conflicts. Current main's frozen contracts, voice modules, dashboard, backend, asset pipeline and public assets are retained unchanged.
- Created real upstream branch `mahin-world-integration` from that main commit. The original `mahin` branch and the local preview checkout remain untouched. Local verification Git history is only a diff/audit harness and must never be pushed. Publishing uses GitHub's authenticated file-commit UI on the real upstream branch.
- Current-main integration verification: TypeScript, all **197 tests across 18 files**, production build and ownership audit pass. The additional test versus the prior 196 comes from current main's frozen seed suite. Full CLI Playwright remains unexecuted; browser evidence and limitations above still apply.
- This PR is the working world/navigation/conversation/capture implementation plus the city/rendering pass. It is not photoreal acceptance, a realistic-character delivery, or a live Argon/voice/backend acceptance claim. Karthik and Ayan integrations remain separately owned.
