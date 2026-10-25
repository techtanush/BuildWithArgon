# argon-app — Foundry: the zero-human company you can walk into

The full specification is in [`../architecture-files/`](../architecture-files/README.md). Read it first.
The team split (who owns what, frozen contracts, merge plan) is
[`../architecture-files/06-execution/07-team-split.md`](../architecture-files/06-execution/07-team-split.md).

```
argon-app/
  kernel/   Python 3.11+ FastAPI kernel (uv)          -> http://127.0.0.1:8787
  web/      Vite + React + TypeScript + Three.js       -> http://localhost:5173  (/view = the world)
  evals/    eval briefs, grounding questions, committed results
  docs/     decisions, verified API shapes, build logs, contract requests (per person)
  data/     runtime data (gitignored)
```

## Run

```bash
cp .env.example .env            # fill keys (or set LLM_MODE=fake to run with no keys)
cd kernel && uv sync --extra dev && cd ..
cd web && pnpm install && cd ..
make dev                        # kernel :8787 + web :5173
make test                       # pytest + typecheck + vitest
```

No keys? `LLM_MODE=fake` runs the whole company DAG with the FakeLLM, and `/view?mock=1` runs the
world against fixtures.

## Seed status

This tree started as a **frozen-contract seed**: every module exists with its final public
interface, the shared contracts are final, and stubs are safe no-ops so each person's branch runs
on its own. Each file starts with an `OWNER:` line. `make ownership WHO=<you>` checks that your
branch only touches your files.
