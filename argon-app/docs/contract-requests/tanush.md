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
