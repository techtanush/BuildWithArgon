# AGENTS.md — Foundry × Argon app

**Context:** we are building this in one day for the **Gemini 4 Argon hackathon** (Cerebral Valley ×
Google DeepMind). We target **Problem Statement 1 (Million Token Engineering)** with the
autonomous engineering loop and its baseline eval, **Problem Statement 2 (More Dimensions)** with
the generated 3D town and its render → critique → fix loop, and the **Best use of Managed Agents**
prize with the Argon-orchestrated department agents (Antigravity sandboxes, Cua computers). Judges
score working, live demos against Google's four tests (named user, needed Argon, people in control,
live in under 3 minutes) — build for that. Details: `argon-spec/README.md` §Why we're building this.

You are building **Foundry: the zero-human company you can walk into**. The full specification is
in `../argon-spec/`. Start with `../argon-spec/README.md`.

## Rules

1. Read `argon-spec/README.md`, `00-overview/` and `01-architecture/` before writing code; read
   your phase's section before each file.
2. The spec is the contract: exact paths, IDs, endpoints, tables, values. Deviations go in
   `docs/DECISIONS.md` with a reason.
3. External API details marked VERIFY are confirmed against the installed Gemini API skill, official
   docs or a live probe, then recorded in `docs/VERIFIED_API_SHAPES.md`. Change only adapter modules
   (`llm/client.py`, `integrations/composio.py`, `voice/tts.py`, `voice/stt.py`).
4. End each phase with its verify commands green, a line in `docs/BUILD_LOG.md`, and a commit.
5. Never fake data or results outside `LLM_MODE=fake`. Hide unfinished features.
6. Never weaken a test, probe, validator or gate to make output pass. Fix the output.
7. Every consequential action (merge, public post, send, spend over budget, register agent, connect
   integration) goes through `gates.require_approved`.
8. Secrets live only in `.env`; never log, commit or send them to the browser; `redact()` all stored text.
9. The 3D world never shows company status. Only conversations are live.
10. Small verified steps: module → test → run → next.
11. Commit worldgen runs, eval results and the build log — they are evidence.
12. Use they/them for agents and people in generated copy unless told otherwise.
13. The old Foundry code in this repo (`../backend`, `../src`, `../api`) is **not** a dependency. Follow
    `argon-spec/reference/foundry-existing-repo-notes.md` for the few helpers you may adapt and the
    many things you must not take (Simit/Sim Francisco, Port, Bright Data, SigNoz, OpenAI code).

## Commands

```bash
make dev        # kernel :8787 + web :5173
make test       # pytest + typecheck + vitest
make worldgen   # Argon world generation + render/critique loop
make eval       # engineering + grounding evals
cd kernel && uv run python -m foundry_kernel.llm.smoke all   # live API smoke tests
```

## Gemini 4 Argon quick facts

- Model `gemini-4-argon`; Interactions API (`google-genai` ≥ 2.3.0): `client.interactions.create(...)`.
- `generation_config={"thinking_level": "low"|"medium"|"high"}`; never send `thinking_budget`,
  `temperature`, `top_p`, `top_k`, `cached_content`.
- Output > 65,536 tokens: `background=True` + `max_output_tokens` up to ~1M (shared window), poll
  `client.interactions.get(id=...)`.
- Managed agent: `agent="antigravity-preview-09-2026"`, `agent_config={"type":"antigravity","model":"gemini-4-argon"}`, `environment="remote"`.
- Server-side state: `previous_interaction_id`. HTTP timeouts 15–20 min for `high`.
