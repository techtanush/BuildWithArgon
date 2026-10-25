#!/usr/bin/env python3
"""Check that a branch only changes files its owner owns.

Usage: python3 scripts/check_ownership.py <tanush|ayan|mahin|karthik> [base-ref]   (default base: origin/main)
Paths are relative to the repo root. Rules are checked top to bottom; the first match wins.
Source of truth for ownership: architecture-files/06-execution/07-team-split.md.
"""
from __future__ import annotations

import fnmatch
import subprocess
import sys

A = "argon-app/"
K = A + "kernel/"
FK = K + "foundry_kernel/"
W = A + "web/"

PEOPLE = ("tanush", "ayan", "mahin", "karthik")
KARTHIK_JOBS = ["transcribe", "tts_fallback"]
AYAN_JOBS = ["engineering_*", "qa_analyze", "eval_baseline", "triage", "worldgen_*",
             "face_spec", "portrait", "texture", "music_loop", "computer_*"]

RULES: list[tuple[str, str]] = [
    # --- per-person docs and work orders
    *[(f"{A}docs/*/{p}.md", p) for p in PEOPLE],
    *[(f"WORKORDER_{p.upper()}.md", p) for p in PEOPLE],
    # --- shared dependency files: anyone may add a line; union + regenerate at merge
    (K + "pyproject.toml", "union"), (K + "uv.lock", "union"),
    (W + "package.json", "union"), (W + "pnpm-lock.yaml", "union"),
    # --- frozen contracts
    *[(FK + n, "frozen") for n in ("config.py", "ids.py", "errors.py", "schema.sql", "contracts.py", "world_layout.py",
                                   "security.py", "api/__init__.py", "evals/cli.py", "migrations/README.md", "__init__.py")],
    *[(K + "tests/" + n, "frozen") for n in ("conftest.py", "fakes.py", "test_seed_contracts.py", "__init__.py",
                                             "fixtures/fake_llm/README.md")],
    (K + "data/roster.json", "frozen"),
    *[(W + n, "frozen") for n in ("src/App.tsx", "src/main.tsx", "src/shared/contracts.ts", "src/styles/tokens.css",
                                  "src/world/kit/types.ts", "src/world/npc/FaceSpec.ts", "src/world/probes/types.ts",
                                  "src/world/buildings/example/*", "src/world/data/manifest.fallback.json",
                                  "tests/unit/seed.contracts.test.ts", "tsconfig.json", "tsconfig.worldgen.json",
                                  "vite.config.ts", "playwright.config.ts", "index.html")],
    *[(A + n, "frozen") for n in ("Makefile", ".gitignore", ".env.example", "AGENTS.md", "README.md", "docs/*.md",
                                  "evals/briefs/*", "evals/grounding/*", "scripts/*", "data/.gitkeep",
                                  "evals/results/.gitkeep", "web/tests/e2e/.gitkeep")],
    ("architecture-files/*", "frozen"), ("README.md", "frozen"),
    # --- karthik: voice end to end (kernel TTS/STT + browser mic/STT/speech/lip-sync) + grounding eval
    *[(FK + n, "karthik") for n in ("voice/*", "api/voice.py", "evals/grounding_eval.py", "evals/fixtures/*",
                                    "migrations/03??_karthik_*")],
    *[(K + "tests/fixtures/fake_llm/" + j + ".json", "karthik") for j in KARTHIK_JOBS],
    *[(K + "tests/" + n, "karthik") for n in ("karthik/*", "test_voice*.py", "test_grounding*.py")],
    (K + "data/voices.json", "karthik"),
    *[(W + "src/world/" + n, "karthik") for n in ("npc/visemes.ts", "npc/LipSync.ts", "conversation/Mic.ts",
                                                  "conversation/Stt.ts", "conversation/Speech.ts")],
    (W + "tests/unit/voice/*", "karthik"),
    (A + "evals/results/grounding-*", "karthik"),
    # --- ayan: models, engineering, integrations, computers, worldgen
    *[(FK + n, "ayan") for n in ("models.py", "llm/*", "departments/engineering.py", "departments/qa.py",
                                 "departments/support.py", "departments/prompts/eng.*", "departments/prompts/su.*",
                                 "executors/*", "integrations/*", "computers/*", "worldgen/*",
                                 "api/integrations.py", "api/computers.py", "api/preview.py",
                                 "evals/engineering_eval.py", "migrations/01??_ayan_*")],
    *[(K + "tests/fixtures/fake_llm/" + j + ".json", "ayan") for j in AYAN_JOBS],
    *[(K + "tests/" + n, "ayan") for n in ("ayan/*", "test_fileblocks.py", "test_computer_guard.py",
                                           "test_worldgen_*.py", "test_engineering*.py", "test_executor*.py",
                                           "test_llm*.py", "test_composio*.py", "test_support*.py")],
    *[(K + "data/" + n, "ayan") for n in ("faces.json", "worldgen/*")],
    *[(W + n, "ayan") for n in ("scripts/*", "src/world/buildings/generated/*", "src/world/buildings/staging/*",
                                "public/generated/*")],
    (A + "evals/results/engineering-*", "ayan"),
    # --- mahin: the world
    (W + "src/shared/worldApi.ts", "mahin"),
    (W + "src/world/*", "mahin"),
    (W + "tests/unit/world/*", "mahin"), (W + "tests/e2e/world*", "mahin"),
    # --- tanush: everything else in the kernel + the dashboard
    (FK + "*", "tanush"),
    (K + "tests/*", "tanush"),
    (K + "data/*", "tanush"),
    (W + "src/dashboard/*", "tanush"), (W + "src/api/*", "tanush"), (W + "src/styles/app.css", "tanush"),
    (W + "tests/unit/dashboard/*", "tanush"), (W + "tests/e2e/dashboard*", "tanush"),
]


def owner_of(path: str) -> str:
    for pattern, owner in RULES:
        if fnmatch.fnmatch(path, pattern):
            return owner
    return "unowned"


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in PEOPLE:
        print(__doc__)
        return 2
    who, base = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "origin/main")
    out = subprocess.run(["git", "diff", "--name-only", f"{base}...HEAD"], capture_output=True, text=True, check=True).stdout
    changed = [p for p in out.splitlines() if p]
    bad, union = [], []
    for path in changed:
        owner = owner_of(path)
        if owner == "union":
            union.append(path)
        elif owner != who:
            bad.append((path, owner))
    for path in union:
        print(f"NOTE  {path}: shared dependency file — keep additions to new lines and log them in docs/build-logs/{who}.md")
    for path, owner in bad:
        print(f"FAIL  {path}: owned by {owner}")
    print(f"{len(changed)} changed file(s), {len(bad)} outside {who}'s ownership")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
