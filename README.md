# BuildWithArgon — Foundry × Gemini 4 Argon

**Foundry: the zero-human company you can walk into.** A founder gives Foundry an idea; an
Argon-orchestrated company of 13 departments and 29 agents researches, plans, builds, ships and
supports it — and the founder can step into a 3D town to talk with any agent face to face.

Built for the **Gemini 4 Argon hackathon** (Cerebral Valley × Google DeepMind): Problem Statement 1
(Million Token Engineering), Problem Statement 2 (More Dimensions) and Best use of Managed Agents.

- **Spec (read first):** [`architecture-files/README.md`](architecture-files/README.md)
- **App:** [`argon-app/`](argon-app/README.md) — a frozen-contract seed: every module exists with its
  final interface, shared contracts are frozen, and `make test` is green.
- **Team split:** [`architecture-files/06-execution/07-team-split.md`](architecture-files/06-execution/07-team-split.md)

| Builder | Branch | Work order |
|---|---|---|
| Tanush — kernel core, company & dashboard | `tanush` | `WORKORDER_TANUSH.md` on that branch |
| Ayan — models, engineering, integrations & worldgen | `ayan` | `WORKORDER_AYAN.md` on that branch |
| Mahin — the 3D world | `mahin` | `WORKORDER_MAHIN.md` on that branch |
| Karthik — voice & lip-sync end to end, grounding eval | `karthik` | `WORKORDER_KARTHIK.md` on that branch |
