# AGENTS.md — Foundry × Argon app

**Context:** we are building this in one day for the **Gemini 4 Argon hackathon** (Cerebral Valley ×
Google DeepMind). We target **Problem Statement 1 (Million Token Engineering)** with the
autonomous engineering loop and its baseline eval, **Problem Statement 2 (More Dimensions)** with
the generated 3D town and its render → critique → fix loop, and the **Best use of Managed Agents**
prize with the Argon-orchestrated department agents (Antigravity sandboxes, Cua computers). Judges
score working, live demos against Google's four tests (named user, needed Argon, people in control,
live in under 3 minutes) — build for that. Details: `architecture-files/README.md` §Why we're building this.

You are building **Foundry: the zero-human company you can walk into**. The full specification is
in `../architecture-files/`. Start with `../architecture-files/README.md`.

## Rules

1. Read `architecture-files/README.md`, `00-overview/` and `01-architecture/` before writing code; read
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
    `architecture-files/reference/foundry-existing-repo-notes.md` for the few helpers you may adapt and the
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

## Team rules (four parallel branches: `tanush`, `ayan`, `mahin`, `karthik`)

The work is split so the four branches never depend on each other and merge as a union. Before
writing code, read `../architecture-files/06-execution/07-team-split.md` and your
`WORKORDER_<NAME>.md` at the repo root of your branch.

1. **Edit only files you own.** Every seed file starts with an `OWNER:` line. Ownership rules
   live in `scripts/check_ownership.py`; run `make ownership WHO=<you>` before each push.
2. **Frozen contracts** (`OWNER: frozen contract`) are never edited on a branch. Need a change?
   Write it in `docs/contract-requests/<you>.md` (what, why, exact diff) and work around it on your
   branch (adapter in your own files). The merge session applies requests.
3. **Keep public signatures.** Seed modules you own can be rewritten freely, but the names and
   signatures other people call (listed in the team split) must stay the same.
4. **Logs per person.** Write to `docs/build-logs/<you>.md`, `docs/decisions/<you>.md`,
   `docs/verified/<you>.md` — never to someone else's file.
5. **New files** go only inside directories you own. New SQL goes in
   `kernel/foundry_kernel/migrations/NNNN_<you>_<what>.sql` in your number range.
6. **Dependencies:** avoid new ones. If you must add one, add one line to `pyproject.toml` /
   `package.json`, note it in your build log; the merge session takes the union and regenerates
   `uv.lock` / `pnpm-lock.yaml`.
7. **Never break the seed tests** (`kernel/tests/test_seed_contracts.py`,
   `web/tests/unit/seed.contracts.test.ts`). They are the merge's safety net.
8. You may run another person's branch in a separate `git worktree` to try your work against
   theirs. Never commit their files and never merge their branch into yours.

