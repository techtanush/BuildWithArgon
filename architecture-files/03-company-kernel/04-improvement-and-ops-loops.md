# 04 — Improvement Loop (hiring) and Ops Loop

> **Prior art in the old repo** — `backend/factory/.../capabilities.py` (`GeneratedAgent` model, `SAFE_AGENT_TOOLS`, mock agent) and `archive/foundry-concept/04_SIGNATURE_LOOPS.md` (the hire-and-resume loop) are the closest references. The old version used the OpenAI Agents SDK — rebuild on Argon. What may and may not be reused: [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

## Improvement loop — the company hires the agent it's missing

### Detecting a gap
A handler returns `blocked` with `capability_gap` when its ticket's `payload.requires_capability`
(set by the planner) is not in:
`union(capabilities of agents in the department, including the venture's generated agents)`
`∪ payload.granted_capabilities`.

The `cos.orchestrator` plan prompt instructs it to set `requires_capability` only when a task needs
a skill outside the department's listed capabilities (the plan prompt includes the capability
lists). Example: engineering needs `pdf_export`.

### Flow
1. Scheduler creates `capability.gap` ticket (chief-of-staff, `cos.improvement`) with payload
   `{capability, description, blocked_ticket_id, blocked_department}`.
2. Max (Argon high, `capability_design`) designs the agent:
   ```json
   {"id":"gen.engineering.pdf-export","display_name":"Pia","title":"PDF Export Specialist",
    "role_summary":"..","persona":"..","greeting":"..","voice_hint":"..",
    "model_job":"engineering_build","tools":[],"capabilities":["pdf_export"],
    "instructions_md":"## Role ... ## Inputs ... ## Outputs ... ## Guardrails ...",
    "smoke_test":{"input":"..","expected_properties":[".."]}}
   ```
   Tools MUST be a subset of the department's existing tools; Max is told "minimum toolset".
3. Kernel runs the smoke test: one call to the new agent's job with `instructions_md` as system and
   `smoke_test.input`; Flash-Lite checks the output against `expected_properties` → pass/fail.
4. Creates `people.hire` ticket (finance-people, `fp.people-ops`) → approval `new_capability` with
   payload `{agent, smoke_test_result, blocked_ticket_id}`.
5. On approve: insert `agents` row (`venture_id` set, `generated=1`, next free `npc_slot` in that
   department's building: `s5`, then `s6`; if none free → `plaza.overflow-N`), write
   `departments/prompts/<agent_id>.md` from `instructions_md`, generate face spec + portrait in the
   background (portrait optional; fallback silhouette), assign a voice (first unused voice), set
   the blocked ticket to `open` with `payload.granted_capabilities += [capability]` and
   `assigned_agent_id = <new agent>`. Message to `#all-hands`: "Welcome Pia, our new PDF Export
   Specialist (approved by <founder>)."
6. On reject: blocked ticket → `failed` with note; message to `#exec`.

The new agent appears in the world in its building the next time the world loads (manifest
includes venture agents).

## Ops loop — failures become work

- A ticket that ends `failed` after max attempts posts to `#incidents` and creates an `ops`
  summary in the next `cos.report`.
- If ≥ 3 tickets fail within 30 minutes for the same department, the scheduler pauses that
  department (`kv['dept.paused.<vid>.<dept>'] = true`), posts to `#incidents`, and creates a
  `cos.report` ticket with `payload.incident=true`. The founder resumes the department from the
  dashboard (Department detail → Resume).

## `cos.report` (Rhea — Argon medium)

Runs when all leaf tickets of a plan are done, and on demand (dashboard button "Ask Chief of Staff
for a report"). Input: the plan, all ticket statuses/results, artifacts list, approvals, ledger
totals, incidents. Output: artifact `report` with sections **What we did**, **What's waiting on
you** (pending gates, with links), **What's next** (proposed tickets — created as `open` only if
`settings.autopilot_next=true`, otherwise listed), **Costs**. Message to `#exec`.
