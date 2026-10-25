# 02 — Acceptance Criteria (Definition of Done)

The build is done when every **MUST** item below passes. Each has an ID, a check, and how to
verify it. Record results in `argon-app/docs/BUILD_LOG.md` as a table (ID, status, evidence).

## Kernel & company

| ID | Criterion | Verify |
|---|---|---|
| K-01 | Kernel starts with only `.env` defaults (no keys) and serves `/health` | `make kernel`; `curl /health` |
| K-02 | Schema applies cleanly; seed creates 13 departments and 29 agents | `pytest tests/test_db.py` |
| K-03 | All endpoints in the API contract exist and return the envelope | `pytest tests/test_api_contract.py` (one test per route) |
| K-04 | SSE delivers events < 300 ms after a write and resumes with `Last-Event-ID` | test with httpx stream |
| K-05 | Fake-mode venture completes the full DAG to `cos.report` | `pytest -k fake_venture_end_to_end` |
| K-06 | Live venture: Argon produces a valid plan; ≥ 10 departments produce artifacts | manual run; artifacts list |
| K-07 | Gated functions refuse without an approved approval | `pytest tests/test_gates.py` |
| K-08 | Gate decision re-enters the ticket and the handler's second pass runs | `pytest -k gate_reentry` |
| K-09 | Ledger records every model call; venture `spent_usd` updates; over-budget raises a `spend` gate | `pytest tests/test_ledger.py` |
| K-10 | Kernel restart recovers `in_progress` tickets to `open` | `pytest -k startup_recovery` |
| K-11 | Secrets never appear in DB text columns or logs | grep DB dump for key prefixes; `pytest -k redact` |

## Coordination & group chat

| ID | Criterion | Verify |
|---|---|---|
| CO-01 | Leads delegate to their sub-agents with a `delegation` post and child tickets | live run; `#dept-*` channels |
| CO-02 | `agent.request` is answered, delegated or declined by the target lead | `pytest tests/test_coordination.py` |
| CO-03 | Asks produce a question/answer thread with citations; ≤ 3 per run | same |
| CO-04 | Standups post a thread with one update per active lead and Rhea's decisions every 30 min of activity | same + live |
| CO-05 | Blocked > 20 min escalates to Rhea in `#exec` once | same |
| CO-06 | Founder mentions create `chat.reply` tickets; Rhea can reprioritize from chat | e2e |
| CO-07 | Town Hall standup playback plays each update in the right voice with captions | manual |

## Cloud computers (Cua)

| ID | Criterion | Verify |
|---|---|---|
| CU-01 | A computer starts for an agent and returns a screenshot | `cua` smoke (phase 9) |
| CU-02 | Computer-use loop completes Leo's pricing capture within 30 steps with screenshots attached to the artifact | live run |
| CU-03 | Guard blocks off-allowlist URLs and gates login/sign-up/contact forms | `pytest tests/test_computer_guard.py` |
| CU-04 | Computers page shows live screenshots and the action log; Stop works | manual |
| CU-05 | With `CUA_MODE=off` every computer-using ticket still completes via its fallback | drill |

## Engineering loop

| ID | Criterion | Verify |
|---|---|---|
| E-01 | `eng.design` produces 1–5 tasks covering every AC id | unit test with FakeLLM + live run |
| E-02 | LocalLoopExecutor applies file blocks safely (rejects `..`, absolute, `.env`) | `pytest tests/test_fileblocks.py` |
| E-03 | Repair loop runs until pass or `MAX_BUILD_ITERATIONS`; no-weakening rule enforced | unit tests with scripted FakeLLM outputs |
| E-04 | QA writes independent acceptance tests and runs the full suite | live run artifact `test_report` |
| E-05 | Passing build → PR via Composio (or local build in no-GitHub mode) + `merge` gate | live run |
| E-06 | Approving `merge` merges the PR (or updates `data/products/<vid>/main`) | live run |
| E-07 | AntigravityExecutor runs one ticket end to end, or the fallback to local is recorded | live run / BUILD_LOG |
| E-08 | `github_watch` turns a new issue into `support.issue` → `eng.fix` | create an issue in the venture repo |
| E-09 | Improvement loop: a `capability.gap` leads to a `new_capability` gate; approval registers an agent who appears as an NPC | `pytest -k improvement_loop` + manual world check |

## Dashboard

| ID | Criterion | Verify |
|---|---|---|
| D-01 | Onboarding creates a venture with files and starts it | `e2e dashboard.spec.ts` |
| D-02 | Overview, Departments, Agents, Tickets (+graph), Runs (live logs), Approvals, Chat, Artifacts, Metrics, Integrations, Settings render with real data | e2e smoke visits each route |
| D-03 | Live updates without refresh (ticket status, new messages, approvals) | e2e with a kernel-side trigger |
| D-04 | Approve/Reject works from Approvals and Overview | e2e |
| D-05 | Enter the view opens `/view?venture=<vid>`; "Find in the world" opens `?goto=` | e2e |

## World

| ID | Criterion | Verify |
|---|---|---|
| W-01 | `/view` interactive in < 6 s (High) on the demo laptop | stopwatch / perf mark |
| W-02 | 13 buildings with signs, correct plot positions (table in city layout) | `pnpm test` layout test; visual |
| W-03 | Every building enterable; every interior exits back to its door | e2e world.spec iterates all 13 via `travel()` debug hook |
| W-04 | Walk, sprint, collide (cannot walk through walls/fountain/buildings) | unit tests + manual |
| W-05 | Car drives, collides, resets; chase cam smooth | manual |
| W-06 | Race to any building: GPS ribbon, ordered checkpoints, timer, best time saved, auto-enter on finish | manual + unit test for checkpoint placement |
| W-07 | Take me there lands facing the agent and auto-engages | e2e via debug hook |
| W-08 | Map opens, search works, race/travel from map works | manual |
| W-09 | ≥ 50 fps High / ≥ 60 fps Medium in the city on the demo laptop; auto quality works | FPS overlay |
| W-10 | The world shows no company state (no status-dependent visuals) | code review: no manifest field other than npcs/buildings layout feeds visuals |
| W-11 | World loads with the kernel down (fallback manifest, "conversations unavailable") | stop kernel, load `/view` |
| W-12 | Photoreal quality bar met (`05-world/12-photoreal-look.md` §1): PBR scanned materials everywhere, real prop models, HDRI + cascaded soft shadows, AO, realistic avatars; no flat colors, stretching, z-fighting or pixelation | screenshots of plaza, 3 exteriors, 3 interiors reviewed against the checklist; critic `realism` ≥ 0.7 mean |
| W-13 | Asset pipeline: `pnpm assets` rebuilds every asset from `assets.lock.json`; `manifest.json` validates against the contract; `CREDITS.md` lists every asset and license | run on a clean checkout |

## Characters & conversation

| ID | Criterion | Verify |
|---|---|---|
| C-01 | 29 distinct characters built from FaceSpecs (or seed fallback) | visual pass through all buildings |
| C-02 | Concierge auto-greets on entry | manual |
| C-03 | Push-to-talk → transcript → cited answer → voice with lip-sync | manual, live keys |
| C-04 | Typing works when the mic is unavailable | manual (deny mic permission) |
| C-05 | Every factual answer shows source cards; checker status updates via SSE | manual + `pytest tests/test_checker.py` |
| C-06 | Concierge returns route cards for the 7 routing questions in the Concierge doc | grounding eval |
| C-07 | Agents refuse to take gated actions and point to the dashboard approval | grounding eval items G-15, G-16 |
| C-08 | Voice fallbacks: no ElevenLabs key → Gemini TTS or browser voice, mouth still moves | drill |
| C-09 | Latency p50 (release V → first audio) ≤ 2.5 s, p90 ≤ 4 s | Metrics latency panel |
| C-10 | Live voice call with any agent from the world (C) and the dashboard (Call): interruptible, the agent's own voice, factual answers via `ask_company` with source cards and checks, mouth moves | manual, live keys |
| C-11 | Voice calls unavailable (no key/agent id, token failure, mic denied) → clear message and push-to-talk/typing still work | drill |
| C-12 | Agents and Org pages show each agent's runtime (jobs → models, managed agents, tools, gates) from `agent_capabilities.json` | e2e |

## Worldgen

| ID | Criterion | Verify |
|---|---|---|
| G-01 | One-pass generation produced modules for 13 buildings (or per-building fallback generation recorded) | `runs/<id>/output.txt`, modules |
| G-02 | Loop ran ≥ 2 iterations with probe + visual scores per building per iteration recorded | `scores.json`, DB rows |
| G-03 | Final world score ≥ 0.9; ≥ 10 buildings `generated` | `foundry-worldgen report` |
| G-04 | Fallback archetypes all score 1.0 | capture with `--source fallback` |
| G-05 | Generated modules contain no forbidden tokens and type-check | validate step logs |
| G-06 | The critic receives the walkthrough videos (or the 8-frame fallback, recorded) and reports motion issues | critic inputs in `runs/<id>/critic/` |
| G-07 | World Lab live round on one building completes in ≤ 150 s with before/after captures, issues and scores — or reports a clear failure — and Promote updates the world | live drill ×2 |
| G-08 | World Lab shows the recorded run: score curve (world/visual/realism), per-building filmstrips with videos and critic issues | manual |

## Evals & metrics

| ID | Criterion | Verify |
|---|---|---|
| V-01 | *(optional, P2)* Engineering eval ran 5 briefs × 2 conditions; results committed | `evals/results/engineering-*.json` |
| V-02 | Grounding eval ran all questions; accuracy and citation accuracy reported | `evals/results/grounding-*.json` |
| V-03 | Metrics page shows world (headline), grounding, cost, latency, and engineering if run | manual |
| V-04 | No claim in README/UI exceeds what the results show | review |
