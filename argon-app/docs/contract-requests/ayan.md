# Contract requests — ayan

Format: file, exact change (diff), why, who is affected, workaround used meanwhile.

## CR-A1 — `contracts.Part.kind` gains `"video"` (frozen: `kernel/foundry_kernel/contracts.py`)

```diff
 @dataclass
 class Part:
-    kind: Literal["text", "image", "audio"]
+    kind: Literal["text", "image", "audio", "video"]
```
**Why:** the critic sends the walkthrough videos as video parts (ADR-020, G-06). Verified live: the Interactions API
accepts `{"type": "video", "mime_type": "video/webm", "data": <b64>}`.
**Affected:** nobody else constructs video parts. **Workaround:** `llm.client.video_part(data, mime)` builds
`Part(kind="video")` with a `type: ignore`; the client also treats any Part whose mime starts with `video/` as video.
Remove the ignore after the merge.

## CR-A2 — Global `worldgen.progress` events from the CLI reach the SSE stream (tanush: `api/stream.py`)

`foundry-worldgen` runs in its own process. Its `worldgen.progress` events (venture_id NULL) are inserted into
`events` but published only to that process's in-memory broker, so a running kernel's SSE stream does not see them
live. Live-round events are fine (the live round runs inside the kernel).
**Request:** the stream also forwards global events (`venture_id IS NULL`) newer than the connection's last id by polling
`events` every ~2 s (or replays them on reconnect). **Workaround:** the World Lab page can poll `GET
/v1/world/worldgen/runs` / `latest` while a CLI run is in progress.

## CR-A3 — GitHub connect response carries the gate state (tanush: dashboard Integrations page)

`POST /v1/ventures/{vid}/integrations/github/connect` is gated (`integration` approval, security doc). The first call
returns `{"redirect_url": null, "approval_id": "apr_…", "status": "waiting_approval"}`. After the founder approves,
the same call returns `{"redirect_url": "https://…", "approval_id": "apr_…", "status": "pending"}`. The contract
listed only `redirect_url`. **Request:** the dashboard shows the approval inline and calls connect again after
approval. Status changes are emitted as `venture.updated` with an extra `integration` field (the SSE catalogue has no
integration event).

## CR-A4 — `ctx.use_computer` and gated computer actions (tanush: `departments/coordination.py` / scheduler)

`computers.loop.run_task` returns `status="waiting_approval"` with `result = {"approval_id", "pending_action"}` when
the guard gates a step (login/sign-up/checkout/contact form). The loop does not resume itself. **Request:** when the
`computer_action` approval is approved, the scheduler re-enters the ticket; the handler calls `run_task` again (the
computer row is reused) and the approved action can be executed through `computers.loop.execute_gated_action(db,
computer, approval_id=…, action=…)`, which checks the gate first. Screenshot paths in `ComputerTaskResult.screenshots`
are relative to `DATA_DIR` (e.g. `computers/ctk_…/3.png`).

## CR-A5 — Mahin's capture page (handshake is frozen; these are the conventions the scripts rely on)

- `source=staging` loads `web/src/world/buildings/staging/<dept>.ts` (flat directory; the live round writes the
  candidate there); `source=generated` loads `generated/<dept>.ts` through `generated/index.ts`.
- `mode=portrait&agent=<id>` for `foundry-worldgen portraits --from-renders` (768 × 768 viewport, camera `portrait`).
- `playPath` should start immediately and resolve when done (the script samples 8 frames during it and trims the
  recording to the path; any lead-in is reported as `video_lead_in_s` and told to the critic).
- Art direction from the founder (Union Square screenshots, 2026-10-25) is in
  `kernel/foundry_kernel/worldgen/art_direction.md` — the plaza, street dressing (palms, slim street lamps, red café
  umbrellas, a monument column, hedge planters, terraced levels, glass towers on the skyline) is world-side work.

## CR-A6 — docs: spec inconsistencies (frozen: `architecture-files/05-world/04-buildings.md`)

- "`export const interiorShell = { … }`" vs the frozen kit API, where `interiorShell` is a field of `BuildingModule`.
  The prompts follow the kit API and say so in a NOTES section.
- "Exterior triangle budget ≤ 60k / interior ≤ 120k" vs P7 (≤ 250k / ≤ 400k after ADR-018). The prompts state the P7
  numbers (12-photoreal-look.md wins).

## CR-A7 — Two jobs to add to the agent model matrix (frozen: `10-agent-model-matrix.md`, `agent_capabilities.json`)

- `sign_check` (Flash) — the sign legibility read-back required by 07-nano-banana-assets.md §3 → add to
  `system_agents["world.sign-painter"].jobs`.
- `antigravity` — not a model call by a handler; `llm/client.run_agent` uses it as the ledger/accounting label for
  managed-agent runs. Either list it under system agents or rename it in the merge.
Everything else in ayan's lane now uses exactly the matrix jobs (signs → `texture`, live round → `worldgen_critic` /
`worldgen_patch` with a `thinking_level="medium"` override, Ana → `dept_artifact`).

## CR-A8 — User-requested computer viewer UI ownership exception

The user explicitly requested an agent-computer/Cua Spaces viewer while finishing Ayan. New `web/src/components/AgentComputerViewer.{tsx,css}` and its test implement the real API consumer. The standalone Ayan seed adds only the import, `/computers` route and navigation link in `dashboard/routes.tsx`; frozen `App.tsx` and shared contracts are untouched. This is an intentional, documented UI ownership exception, not a clean ownership-check claim. At integration, preserve Tanush's existing routes and mount the named `AgentComputerViewer` inside their current Computers page using the company venture ID.

## CR-A9 — Capture generated face identities and generated signs

Mahin's original CapturePage reads a static fallback manifest whose 29 NPCs lack `face`. This does not reflect Ayan's generated identities even though seed_roster loads all 29 FaceSpecs into the DB. Production portrait capture should hydrate `/v1/world/manifest` before choosing a character/peers and fail clearly when an expected identity is missing. The offline `web/scripts/face-manifest.ts` validates and joins exact IDs for isolated render verification only; it is not a replacement for live hydration.

Generated sign images exist at `/generated/signs/<department_id>.png` (13 PNGs). `kit.sign` should load the corresponding optional image, await readiness for captures, and retain its canvas text fallback on missing/failed images. No frozen KitApi shape change is required. The integration owner is implementing these renderer-owned changes separately; they are not merged into Ayan here.

## CR-A10 — Conversation output budgets (merge-session compatibility fix)

**Approved scope:** preserve job names, models, timeouts, Argon orchestration routes, native JSON schemas, and the existing cost-preflight path. Change only the bounded output budgets in `models.JOBS`:

```diff
-    "talk": Job(FLASH, None, 1_024, timeout_s=30),
-    "concierge": Job(FLASH, None, 1_024, timeout_s=30),
-    "route_rank": Job(LITE, None, 512, timeout_s=15),
+    "talk": Job(FLASH, None, 4_096, timeout_s=30),
+    "concierge": Job(FLASH, None, 4_096, timeout_s=30),
+    "route_rank": Job(LITE, None, 1_024, timeout_s=15),
```

**Why:** sanitized live logs recorded two consecutive Flash generations at `tokens_out=1009` against the prior 1,024-token talk cap, followed by incomplete JSON after repair. Small native-JSON probes passed; only the larger grounded conversation response was clipped. The code path proves the job value is forwarded as `generation_config.max_output_tokens`; provider behavior was not probed and no key/provider call is required. 4,096 is the normal bounded conversation budget, not an unbounded retry.

**Merge follow-up:** align the frozen routing guide's conversation rows and replace the stale owner test expectation in `kernel/tests/test_llm_client.py::test_generation_config_rules` from 1,024 to 4,096. Do not alter seed assertions. Voice-call frontend limits are out of scope; a real answer exceeding the current 20-second tool bound may require a separate 30-second frontend decision.
