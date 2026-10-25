# 10 — Agent → Model, Managed-Agent and Tool Matrix (authoritative)

> **Hackathon context — Best use of Managed Agents.** This is the definitive answer to "which
> agent runs on which Google model / agent API, with which tools". Judges should be able to read it
> off the dashboard (Agents and Org pages show each agent's runtime — see §6). Machine-readable
> copy: `argon-app/kernel/data/agent_capabilities.json` (frozen; a seed test checks it against the
> roster and `models.JOBS`). Model IDs live only in `models.py` (`01-model-routing.md`); this page
> names **jobs**, and the job decides the model and thinking level.

## 1. The Google surfaces we use

| Surface | ID (via `models.py`) | Called through | What it gives an agent |
|---|---|---|---|
| **Argon** (Interactions API) | `gemini-4-argon`, `thinking_level` low/medium/high, long decode (`background=True`) | `ctx.llm.generate / generate_json` | Planning, decisions, specs, architecture, whole-feature builds, reviews, world generation and critique (incl. video) |
| **Flash** (Interactions API) | `gemini-3.8-flash` | same | Fast department documents, conversation, standup updates, request handling, computer-use steps |
| **Flash-Lite** (Interactions API) | `gemini-3.5-flash-lite` | same | Triage, routing, citation checks, guards, summaries |
| **Antigravity managed agent** | `antigravity-preview-09-2026` with `agent_config.model = gemini-4-argon` | `ctx.llm.run_agent(...)` | A Google-hosted Linux sandbox where Argon writes code, runs tests, manages files, searches the web and calls MCP tools — in one API call |
| **Deep Research agent** | `deep-research-preview-04-2026` | `ctx.llm.generate("deep_research", …)` (background) | Multi-step web research returning a cited report |
| **Specialised models** | `gemini-3.5-transcribe`, `gemini-3.8-flash-tts`, `gemini-nano-banana-2.1`, `lyria-3-clip-preview` | `ctx.llm.generate / generate_images` | Speech-to-text, fallback voice, signs / portrait polish, optional music |

Non-Google tools agents use: **Cua** cloud computers (`computers.loop.run_task`), **Composio**
GitHub tools, **ElevenLabs** voices (every NPC's speaking voice) and **ElevenLabs Agents** (live
voice calls with any agent), the kernel's own tools
(`directory_search`, `ledger`, `registry`).

## 2. Every company agent (the 29 NPCs)

Common to **all 29**: conversation answers use job `talk` (Flash) — except Nova, who uses
`concierge` — with every answer checked by `check_citation` (Flash-Lite); agents are asked
questions by other agents through `ctx.ask_agent` (also `talk`); their voice is ElevenLabs (or the
Gemini TTS / browser fallback). **Leads** (marked ★) also post standup updates (`standup_update`,
Flash) and answer cross-department requests (`agent.request` → `agent_request`, Flash).
Any of the 29 can also be **called live by voice** (ElevenLabs Agents, ADR-021): the call's
dialogue runs on ElevenLabs with the agent's own voice, and every factual answer comes from the
same grounded `talk` job through the `ask_company` tool (`02-models-and-integrations/12-elevenlabs-voice-agents.md`).

| Agent | Name · role | Ticket work → job (model, thinking) | Google agent APIs | Tools | Gates it can raise | Handler owner |
|---|---|---|---|---|---|---|
| `concierge` ★ | Nova · Concierge | — (conversation only): `concierge` (Flash) + `route_rank` (Flash-Lite) | — | `directory_search` | — | Tanush |
| `intake.brief-lead` ★ | Iris · Brief Lead | `brief` → `dept_artifact` (Flash) | — | — | — | Tanush |
| `intake.spec-writer` | Theo · Spec Writer | `spec.write` → `spec_write` (Argon high) | — | — | — | Tanush |
| `oh.skeptic` ★ | Mara · Skeptic | `review.skeptic` → `dept_artifact` (Flash) | — | — | `clarification` | Tanush |
| `oh.clarifier` | Jun · Clarifier | clarification questions → `dept_artifact` (Flash) | — | — | `clarification` | Tanush |
| `mr.research-lead` ★ | Priya · Research Lead | `research.market` → `deep_research` (Deep Research; fallback `dept_artifact`) | **Deep Research** | `deep_research` | — | Tanush |
| `mr.competitor-analyst` | Leo · Competitor Analyst | `research.competitors` → `dept_artifact` (Flash) | **Antigravity** (web research) | `antigravity_web`, `cua` (`computer_step` Flash, `computer_plan` Argon high, `computer_guard` Flash-Lite) | `computer_action` | Tanush (computer loop: Ayan) |
| `out.interview-designer` ★ | Sofia · Interview Designer | `validation.interview_plan` → `dept_artifact` (Flash) | — | — | — | Tanush |
| `out.outreach-drafter` | Kofi · Outreach Drafter | outreach drafts → `dept_artifact` (Flash) | — | — | `send` | Tanush |
| `sp.sim-strategist` ★ | Noor · Simulation Strategist | panel design → `dept_artifact` (Flash) | — | — | — | Tanush |
| `sp.panel-analyst` | Ravi · Panel Analyst | `validation.synthetic_panel` → `panel_simulation` (Flash) | — | — | — | Tanush |
| `pv.decision-analyst` ★ | Elena · Decision Analyst | `decision.review` → `decision_review` (Argon high) | — | — | `pivot` | Tanush |
| `pv.risk-assessor` | Omar · Risk Assessor | risk register → `dept_artifact` (Flash) | — | — | — | Tanush |
| `eng.tech-lead` ★ | Kai · Tech Lead | `eng.design` → `engineering_design` (Argon high) | — | — | — | Ayan |
| `eng.builder` | Zara · Builder | `eng.build` / `eng.fix` → `engineering_build` / `engineering_fix` (Argon high, long decode) | **Antigravity** (sandbox build + tests; `ENGINEERING_EXECUTOR=antigravity`) | `antigravity`, `github` (Composio) | — | Ayan |
| `eng.reviewer` | Mina · Code Reviewer | `eng.review` → `engineering_review` (Argon medium) | — | — | — | Ayan |
| `eng.qa` | Ben · QA Engineer | `qa.verify` → `qa_analyze` (Argon medium) | **Antigravity** (sandbox test run) | `antigravity`, `cua` (visual QA) | `merge`, `computer_action` | Ayan |
| `gr.positioning-lead` ★ | Lucia · Positioning Lead | `growth.positioning` → `dept_artifact` (Flash) | — | — | — | Tanush |
| `gr.growth-planner` | Sam · Growth Planner | `growth.launch_plan` → `dept_artifact` (Flash) | — | — | `public_post` | Tanush |
| `li.lead-researcher` ★ | Ines · Lead Researcher | `leads.icp` → `dept_artifact` (Flash) | **Antigravity** (web research) | `antigravity_web`, `cua` | `computer_action` | Tanush (computer loop: Ayan) |
| `li.account-mapper` | Tariq · Account Mapper | segmentation → `dept_artifact` (Flash) | — | — | — | Tanush |
| `sa.proposal-writer` ★ | Grace · Proposal Writer | `sales.proposal` → `dept_artifact` (Flash) | — | — | `send` | Tanush |
| `sa.pipeline-manager` | Diego · Pipeline Manager | pipeline plan → `dept_artifact` (Flash) | — | — | — | Tanush |
| `fp.cfo` ★ | Hana · CFO | `finance.budget` → `dept_artifact` (Flash) | — | `ledger` | `spend` | Tanush |
| `fp.people-ops` | Felix · People Ops | `people.hire` → `dept_artifact` (Flash) | — | `registry` | `new_capability` | Tanush |
| `su.triager` ★ | Yuki · Support Triager | `support.issue` → `triage` (Flash-Lite) | — | `github` (Composio), `cua` (bug repro) | `computer_action` | Ayan |
| `su.liaison` | Ana · Customer Liaison | customer replies → `dept_artifact` (Flash); posted by the support handler via Composio after the gate | — | — | `send` | Ayan |
| `cos.orchestrator` ★ | Rhea · Chief of Staff | `plan.request` → `orchestrate_plan` (Argon high); `cos.report` and standup decisions → `cos_report` (Argon medium) | — (directs everyone else) | — | approves nothing; requests `clarification` | Tanush |
| `cos.improvement` | Max · Improvement Engineer | `capability.gap` → `capability_design` (Argon high) | — | — | `new_capability` (via Felix) | Tanush |

Agents registered by the improvement loop (new hires) get `dept_artifact` (Flash), `talk`, and the
tools their approved design lists from the safe set; nothing gated is ever granted automatically.

## 3. System agents (not characters in the town)

| System agent | Jobs (model, thinking) | Google agent APIs | Where | Owner |
|---|---|---|---|---|
| **World architect** | `worldgen_buildings` (Argon high, 524 k long decode), `worldgen_building` (Argon high), `worldgen_patch` (Argon high; `medium` in a fast live round) | **Antigravity** for the World Lab live-round patch (validates `tsc` + rules in its sandbox) | `worldgen/generate.py`, `worldgen/live.py` | Ayan |
| **World critic** | `worldgen_critic` (Argon high; watches walkthrough **videos** + screenshots) | — | `worldgen/critique.py` | Ayan |
| **Face designer** | `face_spec` (Argon medium) | — | `worldgen/faces.py` | Ayan |
| **Sign painter / portrait polish** | `texture` (signs) and `portrait` (optional polish of avatar renders) — Nano Banana | — | `worldgen/textures.py`, `worldgen/faces.py` | Ayan |
| **Computer-use driver** | `computer_step` (Flash), `computer_plan` (Argon high), `computer_guard` (Flash-Lite) | — (drives Cua) | `computers/loop.py`, `guard.py` | Ayan |
| **Engineering baseline** (optional eval) | `eval_baseline` (Argon medium, one long pass) | — | `evals/engineering_eval.py` | Ayan |
| **Citation checker** | `check_citation` (Flash-Lite) | — | `conversation/checker.py` | Tanush |
| **Router / summarizer** | `route_rank`, `summarize` (Flash-Lite) | — | `conversation/concierge.py`, `api/channels.py` | Tanush |
| **Transcriber / fallback voice** | `transcribe` (Gemini Transcribe), `tts_fallback` (Gemini Flash TTS) | — | `voice/stt.py`, `voice/tts.py` | Karthik |
| **Plaza music** (MAY) | `music_loop` (Lyria) | — | worldgen | Ayan |

## 4. Orchestration — who directs whom

```
Founder ── approvals / chat ──► Rhea (cos.orchestrator · Argon high)
                                   │ plans the DAG (orchestrate_plan), posts to #exec, runs standups (cos_report)
     ┌──────────────┬──────────────┼───────────────┬───────────────┬──────────────┐
  12 department leads ★ (Flash for documents; Argon for spec/decision/design; Deep Research for Priya)
     │ delegate to their sub-agents (tickets), answer agent.request, post standup updates
     ├─ Engineering: Kai (Argon high) → Zara ×N (Antigravity sandbox, Argon inside) → Mina (Argon) → Ben (Antigravity + Cua)
     ├─ Research:   Priya (Deep Research) · Leo (Antigravity web + Cua)
     ├─ Lead Intel: Ines (Antigravity web + Cua) · Tariq
     ├─ Support:    Yuki (Flash-Lite triage + Cua repro) → eng.fix → … → Ana (gated replies)
     └─ everyone else: Flash department documents
  Max (Argon high) designs new agents from capability gaps → Felix raises the hire gate
  Nova (Flash + Flash-Lite routing) answers the founder in the plaza and routes to the right agent
```

Coordination mechanisms (tickets, `agent.request`, asks, standups, escalation) are in
[`09-agent-coordination.md`](09-agent-coordination.md); gates in
[`05-approval-gates.md`](05-approval-gates.md).

## 5. Gemini skills for each builder's coding agent

These are the official Gemini API skills for the **coding agents we build with** (they teach the
agent the current SDK, the Interactions API and Managed Agents). They are not runtime features.

```bash
npx skills add google-gemini/gemini-skills --skill gemini-api-dev        # Interactions API, models, Managed Agents
npx skills add google-gemini/gemini-skills --skill gemini-live-api-dev   # Live API (only for the optional Live voice mode)
agy plugin install https://github.com/google-gemini/gemini-skills        # only if you use the Antigravity CLI
```

| Builder | Install | Why |
|---|---|---|
| Ayan | `gemini-api-dev` (**required**); `agy` plugin if using the Antigravity CLI | Writes `llm/client.py`, Antigravity runs, Deep Research, Nano Banana, video input, worldgen jobs |
| Tanush | `gemini-api-dev` | Orchestrator, department and conversation prompts/jobs call the client; Deep Research and Antigravity research calls |
| Karthik | `gemini-api-dev`; `gemini-live-api-dev` only if attempting the MAY Live voice mode | Gemini transcribe and TTS fallback |
| Mahin | none required | The world never calls Gemini directly (only the kernel HTTP API) |

## 6. Where this shows up in the product

- `kernel/data/agent_capabilities.json` (frozen) holds §2–3 per agent: `work_jobs`,
  `conversation_job`, `coordination_jobs`, `managed_agents`, `tools`, `gates`, `owner`.
- Tanush's `GET /v1/ventures/{vid}/agents[/{id}]` adds a `runtime` object built from it plus
  `models.JOBS` (`AgentRuntime` in `contracts.py` / `shared/contracts.ts`): each job with its model
  and thinking level, the managed agents used, tools and gates.
- The dashboard's Agents page shows a "Runs on" line per agent (e.g. *Argon high · Antigravity
  sandbox · GitHub · Cua*), the Org page shows the tree in §4 with the same badges, and Runs show
  which surface each run used (`runs.model`, interaction id). This is the managed-agents evidence.
- Handlers must use exactly the jobs listed here; adding or changing an agent's job is a contract
  request (update this page, the JSON and `models.py` together in the merge session).
