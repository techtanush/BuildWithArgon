# Licensed asset pipeline (owner: karthik)

The expanded lock contains **129 measured source files, 144,238,320 bytes**, all from Poly Haven's verified CC0 catalog. It builds **13 scanned PBR texture sets**, **34 material bindings**, **16 real models** covering **13 props + 3 street-furniture kinds**, and **2 HDRIs**. Generated binaries are gitignored; only the lock, manifest, credits, pipeline, compact verification reports and tests belong in source control. This is substantial A1 coverage, **not a claim that every A1/A2 requirement is complete**.

## Run and reproduce

```sh
pnpm assets:fetch
pnpm assets:build
pnpm assets                    # both
pnpm vitest run tests/unit/assets
pnpm typecheck
```

The repository already declares all dependencies. No package/config changes were made in this lane. `node assets-pipeline/run.mjs build` is an optional compiler-API launcher when native esbuild cannot execute; it requires Node 22.18+ for imported TypeScript stripping. The parent repaired sharp's quarantined native runtime after checking official npm integrity and exact binary provenance; sharp build/encoding is working. The local tsx runtime is also working through the parent's esbuild-WASM setup.

Normal builds never consult mutable APIs. The lock pins exact HTTPS URLs, byte counts and locally measured SHA256. `fetch.ts` validates every cache hit, writes temporary downloads to disk, caps download size at the locked byte count, allows only HTTPS redirects, uses 300-second transfer budgets and retries four times with backoff. Optional mirrors must return exactly the same pinned bytes. Corrupt or missing inputs fail loudly; nothing is fabricated. A real uncached armchair glTF fetch through this production path succeeded, followed by the other 128 verified cache hits.

The build rechecks all raw source SHA256 values. Color maps become WebP quality 90; normal/roughness maps become lossless WebP, at real **1024 and 2048** pixel dimensions. Real-world tile size comes from Poly Haven's millimetre dimensions divided by 1000. Linen and painted-steel color maps are deliberately neutralized before tinting, preserving their scanned luminance detail rather than multiplying pastel colors into saturated blue cloth/paint. Other maps remain from the same scan. A SHA-checked texture build cache under `raw/.texture-cache` keys source SHA, map, resolution, color processing, processor revision and native codec versions; both source and cached output checksums must match. Changes to processing require bumping `processorRevision`.

Props use glTF-Transform dedup/weld/prune, embedded WebP textures, floor-centered metre-scale normalization to `PROP_FOOTPRINTS`, **LOD0 <=15,000 actual rendered triangles**, two lower LODs and meshopt compression. Reviewed source rotations happen before bbox normalization, preserving exact footprints. Dense book and plant meshes have split UV/normal seams that prevent the standard simplifier reaching budget; the supported Meshoptimizer `Permissive` seam-collapse fallback meets the budget without deleting model parts. Reports identify its use. The encyclopedia source row is quarter-turned about Z before normalization to form a proper flat book stack; its +Z spine direction is retained. HDRIs remain Radiance files, not tonemapped LDR images. Stale unreferenced generated textures/models/HDRIs are removed only after successful processing.

## Actual inventory

- Scans: asphalt, blue painted steel, clay roof tiles, cobblestone, concrete pavement, dirt, grass ground, grey roof tiles, oak planks, red brick, rough linen, smooth white plaster and satin wood flooring. Dark/light oak share one source and one texture ID, with separate tints; there are no duplicate texture IDs or locked paths.
- Props: armchair, school chair, metal office desk, Victorian sofa, round table, long table, bookshelf, small potted plant, pipe desk lamp, wooden crate, wooden wine barrel, wall clock and books.
- Street: full-height backed wooden bench, street lamp and wooden planter. The backed bench is intentionally **not** squeezed into the frozen 0.45 m-high backless `PropKind.bench` footprint.
- HDRIs: `kloofendal_38d_partly_cloudy` exterior and `small_empty_room_1` soft curtained-daylight interior, each 1k.
- Avatars: **0**. Vehicle: **0**, explicitly absent. No placeholders are counted as realistic avatars or cars.

Exact source/output byte totals, hashes, model budgets and test results are in `evidence/validation.json` and `evidence/build-report.json`; credits include every published source. Output is about 181 MB, under the 300 MB budget. The original verified sample lock/manifest/credits are backed up in session temporary storage, not source.

## Visual and automated checks

`/assets-pipeline/orientation-preview.html` displays all actual built GLBs from +Z, using the same meshopt decoder the renderer needs. It is a review tool, not automatic certification. All 16 sources were inspected together: seat fronts, desk drawers, book spines, clock face and crate latch point toward +Z; rotationally symmetric props and planters are orientation-neutral. The final flat-stack pose was checked in the actual render and by asserting its applied quaternion node in the decoded GLB.

Tests verify exact lock/manifest inventory, unique IDs and source paths, source SHA256, resolving generated files, actual WebP dimensions, complete licenses/credits, all frozen material bindings, decoded meshopt GLB triangle counts for every LOD, strict lower-LOD reduction, actual floor-centered bboxes and footprint tolerances, and the total output byte budget. Avatar tests require an explicit blocker when absent, but validate real skeleton nodes, morph names, clips, outfit materials and skin-tone indices when present; they do not permanently require an empty character list.

`node assets-pipeline/audit.mjs /absolute/path/to/vitest-json-report.json` records measured inventories and hashes only after a passing test report. Large API payloads, source HTML, binary probes and logs stay in session temporary storage, not the source tree.

## Deliberate expansion

`node assets-pipeline/curate.mjs` resolves the current official catalogs and chosen assets, downloads and validates upstream MD5, measures local SHA256 and publishes a new lock atomically **only after all selected downloads succeed**. It uses six bounded workers, deduplicates in-flight file requests, downloads to temporary files and resumes partial HTTP ranges between up-to-300-second attempts. Captured metadata belongs under `ASSET_EVIDENCE_DIR` in temporary storage, or the default gitignored `raw/.metadata`, never committed source. `ASSET_SAMPLE=1` selects the original bounded wood/armchair sample.

## Explicit remaining requirements

- Sixteen prop kinds remain procedural: tall plant, floor lamp, screen stand, whiteboard, counter, backless bench, telescope, vault door, workbench, server rack, flowerbed, mailbox, flag, easel, filing cabinet and mug. Street bin, bollard and bike rack remain procedural. The catalog's metal trash can appears as a wide removable-lid assembly and was not accepted as a finished normalized street bin without further assembly review.
- `metal_dark` has an actual painted-steel scan, but **no genuine brushed-aluminium scan was verified for `metal_light`**. That binding deliberately remains physical metal. Oak trim is tinted natural wood, not a separately verified white-painted-wood scan; smooth plaster is shared with stucco. The scanned bookshelf is empty rather than a prefilled bookcase.
- Exterior HDRI is documented **38 degrees**, not falsely claimed to be 25-degree golden-hour sun. No guessed sun direction is emitted. A closer 25-degree partly-cloudy exterior still needs curation.
- ambientCG API and CC0 license were verified, but independent per-texture backup sets and a checksum-locked safe ZIP extraction adapter are not implemented. Mirrors are supported only for identical bytes, not invented interchangeability between different scans.
- Microsoft Rocketbox **MIT** license was verified from official `LICENSE.md`; the older research-only launch article is superseded by the November 2020 license update. README reports 115 avatars, 417 animations and 2022 viseme/FACS/Vive/ARkit updates; these are repository statements, not per-avatar inspection results. Adult sample layout and an actual Kaydara FBX binary range were verified. The GitHub API rate-limited; HTML trees/raw files worked. One non-LFS binary response does not prove repository-wide LFS absence.
- The installed Darwin FBX converter failed `Bad CPU type in executable`; a compatible runtime/converter has not yet been demonstrated. Parent is investigating Rosetta separately. No skeleton names, blendshapes, skin sampling, outfit names, animation clips, 35 inspected adults or 29 manifest avatars have been invented.
- No verified usable CC0 vehicle was found in the inspected Poly Haven catalog. `covered_car` is a tarp-covered prop, not a usable car. No unlicensed third-party model was substituted.

## Final verification

Full web suite: **60 passed**. Project and standalone pipeline TypeScript checks passed. Both actual package scripts (`npm run assets:fetch`, `npm run assets:build`) succeeded; the pnpm executable itself is not on this tool shell PATH. An unchanged-lock rebuild produced **128 byte-identical binaries plus a byte-identical manifest**. Final referenced binaries total **181,162,466 bytes**. Final +Z render loaded and visually reviewed all **16/16** models, including the actual flat book stack. No production avatars or car are published.
