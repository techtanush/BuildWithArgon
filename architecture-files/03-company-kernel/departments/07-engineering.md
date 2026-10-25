# D07 Engineering & Build — The Foundry Works

## Mission

Build the product **right the first time, without a human in the loop**: design from the spec,
implement whole features in one long pass, verify, repair, review, independently test, and get
the merge approved. This is where Argon's long-horizon engineering lives. Full mechanics:
[`../02-autonomous-engineering-loop.md`](../02-autonomous-engineering-loop.md).

## Team

| Agent | Name | Role | Model / job | Tools / services | Persona |
|---|---|---|---|---|---|
| `eng.tech-lead` (lead) | Kai | Architecture + task breakdown, whole-repo context | **Argon high** `engineering_design` | — | Big-picture, encouraging |
| `eng.builder` | Zara | Implements tasks end to end; repair loop | **Argon high**, long decode `engineering_build` / `engineering_fix` | **Antigravity** sandbox, GitHub (Composio + sandbox token) | Calm, precise, dry humor |
| `eng.reviewer` | Mina | Code review: correctness, security, spec fit | **Argon medium** `engineering_review` | — | Kind but exacting |
| `eng.qa` | Ben | Independent acceptance tests + **visual QA** in a real browser | **Argon medium** `qa_analyze`; Flash for computer steps | Antigravity sandbox, **Cua computer** | Methodical, upbeat |

## Work

| Ticket | Owner | Output |
|---|---|---|
| `eng.design` | Kai | artifact `plan` (architecture) + 1–5 tasks → `eng.build`/`eng.review`/`qa.verify` per task; creates the GitHub repo (Composio) if needed |
| `eng.build` / `eng.fix` | Zara | branch + commit (Antigravity) or local workspace; artifacts `code`, `test_report`, `preview`, `pr` |
| `eng.review` | Mina | artifact `doc` (review); `changes_requested` with a high comment → `eng.fix` |
| `qa.verify` | Ben | independent acceptance tests (`tests/acceptance/…`), full suite, **visual QA on Cua** (open preview, click through each AC, screenshots); pass → gate `merge`; fail → `eng.fix` |

## Directing and being directed

- Directed by: Rhea (plan, `eng.design` after Elena's decision), Yuki (`eng.fix` for bugs).
- Kai directs: "@Zara T1 pantry data model (tkt_…)", "@Mina review PR #7", "@Ben verify T1".
- Mina and Ben direct Zara via `eng.fix` (built-in exception).
- Asks: Zara → Theo "Does AC-3 mean exactly 3 days or fewer?"; Kai → Elena "Any scope condition?"
- Hands off to: founder (merge gate), Support (shipped features list), Growth ("shipped" message).

## Services

Argon (Interactions API, long decode, `previous_interaction_id`), Antigravity managed agents
(Credentials API + network allowlist), Composio GitHub tools, Cua computer for Ben, local Node
workspaces (`LocalLoopExecutor` fallback), Playwright (headless fallback for visual QA).

## Gates

`merge` (every change to `main`).

## Group chat

`#dept-engineering`: delegations, "Iteration 2/6: 41/42 passing", review verdicts, QA results with
screenshots. `#all-hands`: "Shipped search: 42/42 tests, reviewed by Mina, verified by Ben."

## In the world

Building: **The Foundry Works** — brick workshop with a sawtooth roof, tall chimney, roll-up door,
crates outside. Interior: workbenches with monitors, a server rack row with blinking LEDs, cables on
the floor (like the reference), a whiteboard diagram. Kai at `s1` by the whiteboard; Zara `s2` at
a workbench; Mina `s3` at a desk; Ben `s4` by the server rack.

Ask Kai: "How is the product built?" · Ask Zara: "What are you shipping right now?" · "How many
tests pass?" · Ask Mina: "Anything risky in the last PR?" · Ask Ben: "Did it pass QA? Show me."
(source card opens the QA computer task with screenshots).

## Failure modes

Antigravity down → local executor. Composio down → local builds and local merge. Repair loop
exhausted → `#incidents`, retry policy, then Kai redesigns.

## Acceptance

E-01 … E-07 in the acceptance criteria; G-08 – G-10, G-15 pass.
