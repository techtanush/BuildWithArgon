# Contract requests — tanush

Format: file, exact change (diff), why, who is affected, workaround used meanwhile.

## T-CR-01 — Align TypeScript status and gate unions with the SQL/API contract

File: `web/src/shared/contracts.ts` (frozen).

```diff
-export type VentureStatus = 'draft' | 'running' | 'paused' | 'done' | 'failed';
+export type VentureStatus = 'draft' | 'running' | 'paused' | 'archived';
-export type GateType = 'merge' | 'public_post' | 'send' | 'spend' | 'new_capability' | 'integration' | 'clarification' | 'pivot' | 'computer_action';
+export type GateType = 'clarification' | 'pivot' | 'spend' | 'outreach' | 'merge' | 'deploy' | 'integration' | 'new_capability' | 'computer_action';
```

Why: frozen `schema.sql` and the API spec define these exact values. Consumers: dashboard and world. Workaround: the kernel follows SQL/Python contract values; dashboard gate display accepts the existing `Approval.gate_type` string escape hatch. No frozen file was edited.

## T-CR-02 — Keep the optional kernel token in the Vite proxy

File: frozen `web/vite.config.ts`.

Import `loadEnv` from `vite`, make the config a `({mode}) => ...` factory, read `loadEnv(mode, '..', '')`, and attach `headers: {Authorization: `Bearer ${env.KERNEL_TOKEN}`} ` to the `/v1` proxy only when the value is nonempty. Never create a `VITE_*` key or expose it through `define`. Also permit a server-side `KERNEL_PORT` target override (default 8787), using that same env object.

Why: the existing proxy does not forward the optional bearer token required by the API contract; browser EventSource cannot attach Authorization. Affected: dashboard and world when auth is enabled. Workaround: optional token remains unset for local development; HTTP bearer authentication itself is implemented and tested. This machine's existing service occupies 8787, so isolated verification uses 18787.

## T-CR-03 — Deep Research uses an agent interaction (Ayan-owned adapter)

Files: `kernel/foundry_kernel/models.py`, `llm/client.py` (Ayan).

```diff
-"deep_research": Job("deep-research-preview-04-2026", None, None, timeout_s=1800),
+"deep_research": Job("deep-research-preview-04-2026", None, None, background=True, timeout_s=1800),
```

In `LLMClient.generate`, the `deep_research` job must build `{"agent": j.model, "input": ..., "background": True}` rather than `{"model": j.model, ...}` and use the existing poll loop. The job name and public generate signature stay unchanged.

Why: the official Deep Research documentation requires an agent interaction and background polling. Affected: Priya's live market research. Workaround: handlers call the contracted `deep_research` job, log provider failure honestly, then use the documented `dept_artifact` fallback without inventing research evidence. Verification source: https://ai.google.dev/gemini-api/docs/deep-research.md.txt (read 2026-10-25).

## T-CR-04 — Generated hires must retain the real engineering verification pipeline

Files: Ayan's `departments/engineering.py` and executors; frozen matrix/design if a job override is needed.

When the assigned agent has `generated=1`, include their exact approved `kv['agent.design.<id>']` instructions and tools in the executor input. Keep the existing build → tests → repair → review → QA → merge-approval checks. Resolve the newer matrix's default `dept_artifact` job versus the older improvement example's `engineering_build` through an explicit approved runtime policy; never route an `eng.build`, `eng.fix` or `qa.verify` ticket through a generic document handler.

Affect: live engineering tickets resumed after capability hiring. Workaround: Tanush's scheduler retains each ticket's type-specific handler; the seed's explicit fake engineering path still supplies fake-labelled test/code evidence. Live executor support is Ayan's responsibility at merge; this branch does not claim that an untested generated hire can ship a real build.

## T-CR-05 — Expanded company integrations requested by Tanush

Affected: Ayan-owned `integrations/composio.py`, `api/integrations.py`, integration action adapters; frozen `schema.sql` currently limits `integrations.provider` to `github`. Add an owner-scoped migration rebuilding that CHECK for the approved provider allowlist (do not edit the frozen seed). `config.py` has no Higgsfield credential field: request a merge-time optional SecretStr only after its API/auth is verified. Video can use an existing doc artifact with URI/media metadata, avoiding an invented frozen ArtifactKind.

The user explicitly expanded the intended product beyond GitHub to Gmail, LinkedIn and other company operations, including Higgsfield media generation. Implement a provider catalog and per-venture account binding for `github`, `gmail`, `linkedin`, `googlecalendar`, `googlemeet` and supported media providers; retain the current GitHub endpoint/signatures. Discover exact Composio tool schemas from the provider, allowlist each action and its arguments, and require an `integration` gate before binding a connection. Existing project-wide connections must never be silently assigned to a venture. Every email/send/public post remains an `outreach` approval containing the exact destination and content; media generation must honor the venture's spend budget. Do not treat connection metadata as proof that any external action executed.

Workaround on Lane A: company planning, asks, approval UI and typed runtime tools work; adapter-owned integrations show their actual unavailable state until Ayan merges. Composio key was validated; project metadata shows active GitHub/Gmail/LinkedIn/Calendar/Meet connections, but no account was rebound and no message/post was sent. Higgsfield adapter/auth is absent from the agreed spec, so no Higgsfield result is claimed.

## T-CR-06 — Standup audio field in frozen Python contract

File: `kernel/foundry_kernel/contracts.py`, `StandupLatest`.

Add `audio: list[StandupAudio] = Field(default_factory=list)`, with `StandupAudio` containing `agent_id: str`, `audio_url: str | None = None`, `alignment: Alignment | None = None`, matching the API endpoint table and TypeScript contract. Workaround: owned `api/org.py` defines `LatestStandup(StandupLatest)` with this exact additive field, so the live route and OpenAPI already expose the required shape.
