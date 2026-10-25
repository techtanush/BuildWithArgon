# 03 — Glossary

| Term | Meaning |
|---|---|
| **Venture** | One company Foundry runs for a founder: an idea, context files, a budget, a product repo. Table `ventures`. |
| **Kernel** | The Python backend (`argon-app/kernel`, package `foundry_kernel`). Owns the database, orchestration, model calls, integrations, and the HTTP API. |
| **Web** | The browser app (`argon-app/web`): the dashboard and the 3D world. |
| **Department** | One of 13 functional units (e.g. `engineering`). Owns ticket types and a set of agents. Has one building in the world. |
| **Agent** | A named worker inside a department, with a role, model, tools, persona, voice and face. Row in `agents`; also an NPC in the world. |
| **Concierge** | The main agent (`concierge`). Lives in the plaza. Answers anything and routes you to other agents. |
| **Chief of Staff** | The orchestrator department (`chief-of-staff`). Its lead agent `cos.orchestrator` runs on Argon and plans all work. |
| **Ticket** | A unit of work with a type, department, status and dependencies. Table `tickets`. |
| **Run** | One execution of an agent on a ticket (or a conversation). Has logs and output. Table `runs`. |
| **Artifact** | A durable output: a document, a spec, a plan, a PR, a build, a report. Table `artifacts`. |
| **Approval / Gate** | A pending human decision that blocks a consequential action. Table `approvals`. |
| **Channel** | A group chat. Agents post coordination messages; humans can read and post. Tables `channels`, `messages`. |
| **Event** | An append-only record of anything that happened; streamed to the web over SSE. Table `events`. |
| **Executor** | The component that runs engineering tickets: `AntigravityExecutor` (managed agent sandbox) or `LocalLoopExecutor` (Argon long-decode + local test loop). |
| **Context pack** | The bundle of records (tickets, runs, artifacts, messages, approvals) given to an agent when you talk to it. |
| **Citation** | A pointer from an answer to a record: `{kind, id, quote}`. |
| **Checker** | The component that verifies citations: deterministic checks, then a model check. Verdicts: `verified`, `partial`, `unsupported`. |
| **Route card** | The Concierge's structured suggestion: which agent, which building, why, and buttons Race there / Take me there. |
| **Look kit** | The fixed rendering setup + materials + primitive API that every building uses. Argon never rewrites it. |
| **City manifest** | JSON describing plaza, roads, plots, buildings, NPC placements. Served by `GET /v1/world/manifest`. |
| **Building module** | A generated TypeScript file `web/src/world/buildings/generated/<dept>.ts` that builds one department's exterior and interior using only the look kit API. |
| **Probe** | An automated measurement of a rendered building (reachability, overlaps, bounds, budget, errors). |
| **Critic** | Argon reviewing screenshots of a building against `DESIGN.md` and returning issues + patches. |
| **World score** | Share of probes passing across all buildings, per iteration. |
| **Long decode** | An Argon call with `background=True` and `max_output_tokens > 65536`, polled until done. |
| **Thinking level** | Argon's reasoning effort: `"low"`, `"medium"` (default), `"high"`. |
| **Viseme** | A mouth shape used for lip-sync, derived from ElevenLabs character timings. |
| **Interaction ring** | Glowing floor ring marking where you can press E (an agent, a door, a car). Yellow = primary, coral = secondary. |
| **Race / Take me there** | The two ways to reach a destination: drive through checkpoints, or instant fade-travel. |
| **Department lead** | The agent who directs a department's sub-agents and handles requests to that department. |
| **Ask** | A quick question from one agent to another, answered from the target's records with citations; shown as a chat thread. |
| **`agent.request`** | A ticket asking another department for something; its lead answers, delegates or declines. |
| **Standup** | Periodic thread in `#all-hands`: each active lead's Done/Doing/Blocked, then the Chief of Staff's decisions. Playable as voices in Town Hall. |
| **Cua** | Open-source computer-use infrastructure (github.com/trycua/cua): sandboxes, Spaces, SDK. Gives agents cloud computers. |
| **Space** | A Cua desktop for an agent that the founder can watch and share. |
| **Computer task** | One goal an agent pursues on its computer; every step logged with a screenshot. |
