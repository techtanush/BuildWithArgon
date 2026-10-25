#!/usr/bin/env python3
"""Check that a branch only changes files its owner owns.

Usage: python3 scripts/check_ownership.py <tanush|ayan|mahin|karthik> [base-ref]   (default base: origin/main)
       python3 scripts/check_ownership.py --audit   (every planned + tracked file has exactly the intended owner)
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
    (K + "data/roster.json", "frozen"), (K + "data/agent_capabilities.json", "frozen"),
    *[(W + n, "frozen") for n in ("src/App.tsx", "src/main.tsx", "src/shared/contracts.ts", "src/styles/tokens.css",
                                  "src/world/kit/types.ts", "src/world/kit/props.contract.ts", "src/world/assets/manifest.contract.ts", "src/world/npc/FaceSpec.ts", "src/world/probes/types.ts",
                                  "src/world/buildings/example/*", "src/world/data/manifest.fallback.json",
                                  "tests/unit/seed.contracts.test.ts", "tsconfig.json", "tsconfig.worldgen.json",
                                  "vite.config.ts", "playwright.config.ts", "index.html")],
    *[(A + n, "frozen") for n in ("Makefile", ".gitignore", ".env.example", "AGENTS.md", "README.md", "docs/*.md",
                                  "evals/briefs/*", "evals/grounding/*", "scripts/*", "data/.gitkeep",
                                  "evals/results/.gitkeep", "web/tests/e2e/.gitkeep")],
    ("architecture-files/*", "frozen"), ("README.md", "frozen"),
    # --- karthik: photoreal asset pipeline + voice end to end (kernel TTS/STT + browser mic/STT/speech/lip-sync)
    *[(FK + n, "karthik") for n in ("voice/*", "api/voice.py", "migrations/03??_karthik_*")],
    *[(K + "tests/fixtures/fake_llm/" + j + ".json", "karthik") for j in KARTHIK_JOBS],
    *[(K + "tests/" + n, "karthik") for n in ("karthik/*", "test_voice*.py")],
    (K + "data/voices.json", "karthik"),
    *[(W + "src/world/" + n, "karthik") for n in ("npc/visemes.ts", "npc/LipSync.ts", "conversation/Mic.ts",
                                                  "conversation/Stt.ts", "conversation/Speech.ts",
                                                  "conversation/VoiceCall.ts")],
    (W + "tests/unit/voice/*", "karthik"),
    (W + "tests/voice-lab/*", "karthik"),  # dev-only harness page: http://localhost:5173/tests/voice-lab/index.html
    (W + "assets-pipeline/*", "karthik"), (W + "public/assets/*", "karthik"), (W + "tests/unit/assets/*", "karthik"),
    # --- ayan: models, engineering, integrations, computers, worldgen
    *[(FK + n, "ayan") for n in ("models.py", "llm/*", "departments/engineering.py", "departments/qa.py",
                                 "departments/support.py", "departments/prompts/eng.*", "departments/prompts/su.*",
                                 "executors/*", "integrations/*", "computers/*", "worldgen/*",
                                 "api/integrations.py", "api/computers.py", "api/preview.py", "api/worldgen.py",
                                 "evals/engineering_eval.py", "migrations/01??_ayan_*")],
    *[(K + "tests/fixtures/fake_llm/" + j + ".json", "ayan") for j in AYAN_JOBS],
    *[(K + "tests/" + n, "ayan") for n in ("ayan/*", "test_fileblocks.py", "test_computer_guard.py",
                                           "test_worldgen_*.py", "test_engineering*.py", "test_executor*.py",
                                           "test_llm*.py", "test_composio*.py", "test_support*.py")],
    *[(K + "data/" + n, "ayan") for n in ("faces.json", "worldgen/*")],
    *[(W + n, "ayan") for n in ("scripts/*", "src/world/buildings/generated/*", "src/world/buildings/staging/*",
                                "public/generated/*")],
    (A + "evals/results/engineering-*", "ayan"), (A + "evals/results/world-*", "ayan"),
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
    (A + "evals/results/grounding-*", "tanush"),
]


def owner_of(path: str) -> str:
    for pattern, owner in RULES:
        if fnmatch.fnmatch(path, pattern):
            return owner
    return "unowned"


# Files the work orders plan to create, with their intended owner. `--audit` checks the rules agree,
# and doubles as a "where does X go / who owns it" index for coding agents.
FK_, KT, WS = "argon-app/kernel/foundry_kernel/", "argon-app/kernel/tests/", "argon-app/web/src/"
PLANNED: dict[str, list[str]] = {
    "tanush": [
        *[FK_ + n + ".py" for n in ("app", "db", "bus", "gates", "ledger", "seed", "scheduler", "orchestrator")],
        *[FK_ + "departments/" + n + ".py" for n in ("__init__", "base", "intake", "office_hours", "chief_of_staff", "pivot",
                                                       "finance_people", "requests", "chat", "coordination")],
        *[FK_ + "departments/prompts/" + n + ".md" for n in ("concierge", "cos.orchestrator", "mr.research-lead", "fp.cfo")],
        *[FK_ + "conversation/" + n + ".py" for n in ("context_pack", "talk", "concierge", "directory", "checker")],
        *[FK_ + "api/" + n + ".py" for n in ("system", "ventures", "departments", "agents", "tickets", "runs", "artifacts",
                                             "approvals", "channels", "activity", "stream", "conversation", "world", "metrics", "org")],
        FK_ + "migrations/0001_tanush_example.sql",
        *[KT + n for n in ("test_db.py", "test_api_contract.py", "test_scheduler.py", "test_gates.py", "test_ledger.py",
                           "test_checker.py", "test_directory.py", "test_context_pack.py", "test_coordination.py",
                           "test_grounding_eval.py",
                           "tanush/__init__.py", "fixtures/fake_llm/orchestrate_plan.json", "fixtures/fake_llm/talk.json",
                           "fixtures/fake_llm/dept_artifact.json")],
        FK_ + "evals/grounding_eval.py", FK_ + "evals/fixtures/grounding_state.json",
        "argon-app/evals/results/grounding-20261026T0300Z.json",
        *[WS + n for n in ("dashboard/routes.tsx", "dashboard/pages/Overview.tsx", "dashboard/pages/Computers.tsx",
                           "dashboard/pages/WorldLab.tsx", "dashboard/components/CallPanel.tsx",
                           "dashboard/pages/Metrics.tsx", "dashboard/components/Layout.tsx", "api/client.ts", "api/sse.ts",
                           "api/hooks.ts", "api/schema.d.ts", "styles/app.css")],
        "argon-app/web/tests/unit/dashboard/hooks.test.ts", "argon-app/web/tests/e2e/dashboard.spec.ts",
    ],
    "ayan": [
        FK_ + "models.py",
        *[FK_ + "llm/" + n + ".py" for n in ("client", "fake", "jsonout", "costs", "smoke")],
        *[FK_ + "departments/" + n for n in ("engineering.py", "qa.py", "support.py", "prompts/eng.builder.md", "prompts/su.triager.md")],
        *[FK_ + "executors/" + n for n in ("__init__.py", "antigravity.py", "local_loop.py", "fileblocks.py", "workspace.py",
                                           "templates/vite-react-ts/package.json")],
        *[FK_ + "integrations/" + n + ".py" for n in ("composio", "github_watch", "slack_mirror", "marketing")],
        *[FK_ + "computers/" + n + ".py" for n in ("cua_client", "manager", "loop", "guard", "evidence")],
        *[FK_ + "worldgen/" + n for n in ("cli.py", "generate.py", "validate.py", "capture.py", "critique.py", "faces.py",
                                          "textures.py", "score.py", "assets.py", "live.py", "kit_contract.md")],
        *[FK_ + "api/" + n + ".py" for n in ("integrations", "computers", "preview", "worldgen")],
        FK_ + "evals/engineering_eval.py", FK_ + "migrations/0101_ayan_example.sql",
        *[KT + n for n in ("ayan/__init__.py", "test_fileblocks.py", "test_computer_guard.py", "test_worldgen_validate.py",
                           "fixtures/fake_llm/engineering_build.json", "fixtures/fake_llm/worldgen_critic.json",
                           "fixtures/fake_llm/face_spec.json", "fixtures/fake_llm/computer_step.json")],
        "argon-app/kernel/data/faces.json", "argon-app/kernel/data/worldgen/runs/wgr_X/scores.json",
        "argon-app/web/scripts/capture.ts",
        *[WS + "world/buildings/" + n for n in ("generated/engineering.ts", "generated/index.ts", "generated/registry.json",
                                                "staging/engineering.ts")],
        *["argon-app/web/public/generated/" + n for n in ("portraits/eng.builder.png", "textures/brick.png", "signs/intake.png")],
        "argon-app/evals/results/engineering-20261026T0300Z.json", "argon-app/evals/results/world-20261026T0300Z.json",
    ],
    "mahin": [
        *[WS + "world/" + n for n in (
            "WorldHost.tsx", "engine/Engine.ts", "engine/Quality.ts", "kit/LookKit.ts", "kit/materials.ts", "kit/primitives.ts",
            "kit/props.ts", "kit/textures.ts", "kit/lights.ts", "kit/post.ts", "kit/validateModule.ts", "city/layout.ts",
            "city/City.ts", "interiors/Interior.ts", "buildings/index.ts", "buildings/fallback/archetypes.ts", "player/Player.ts",
            "player/Collision.ts", "vehicle/Car.ts", "nav/astar.ts", "nav/Race.ts", "nav/FastTravel.ts", "npc/Character.ts",
            "npc/NpcManager.ts", "npc/LookAt.ts", "npc/portraitFallback.ts", "conversation/ConversationController.ts",
            "probes/probes.ts", "capture/CapturePage.tsx", "hud/Hud.tsx", "hud/ConversationPanel.tsx", "hud/hud.css",
            "data/mock/talk.json")],
        WS + "shared/worldApi.ts", "argon-app/web/tests/unit/world/astar.test.ts", "argon-app/web/tests/e2e/world.spec.ts",
    ],
    "karthik": [
        *[FK_ + "voice/" + n + ".py" for n in ("__init__", "tts", "stt", "assign_voices", "sessions", "agents_setup")],
        FK_ + "api/voice.py", "argon-app/kernel/data/voices.json",
        *[KT + n for n in ("karthik/__init__.py", "test_voice_tts.py", "test_voice_api.py",
                           "fixtures/fake_llm/transcribe.json", "fixtures/fake_llm/tts_fallback.json")],
        *[WS + "world/" + n for n in ("npc/visemes.ts", "npc/LipSync.ts", "conversation/Mic.ts", "conversation/Stt.ts",
                                      "conversation/Speech.ts", "conversation/VoiceCall.ts")],
        "argon-app/web/tests/unit/voice/visemes.test.ts", "argon-app/web/tests/voice-lab/index.html",
        *["argon-app/web/assets-pipeline/" + n for n in ("assets.lock.json", "fetch.ts", "build.ts", "README.md", "lib/polyhaven.ts")],
        *["argon-app/web/public/assets/" + n for n in ("manifest.json", "CREDITS.md", "textures/x/color_2048.webp",
                                                    "models/chair.glb", "characters/avatar01.glb", "hdri/day.hdr")],
        "argon-app/web/tests/unit/assets/manifest.test.ts",
    ],
    "frozen": [
        *[FK_ + n for n in ("contracts.py", "schema.sql", "config.py", "security.py", "world_layout.py", "api/__init__.py",
                            "evals/cli.py")],
        "argon-app/kernel/data/agent_capabilities.json",
        *[WS + n for n in ("App.tsx", "shared/contracts.ts", "world/kit/types.ts", "world/kit/props.contract.ts", "world/assets/manifest.contract.ts",
                           "world/npc/FaceSpec.ts", "world/probes/types.ts", "world/data/manifest.fallback.json")],
    ],
}


def repo_root() -> str:
    """Paths in RULES are relative to the repo root, wherever the script is run from."""
    return subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()

def audit() -> int:
    bad = 0
    for expected, paths in PLANNED.items():
        for path in paths:
            got = owner_of(path)
            if got != expected:
                print(f"FAIL  {path}: rules say {got}, plan says {expected}")
                bad += 1
    tracked = subprocess.run(["git", "-C", repo_root(), "ls-files"], capture_output=True, text=True, check=True).stdout.split()
    for path in tracked:
        if owner_of(path) == "unowned":
            print(f"FAIL  {path}: no owner")
            bad += 1
    print(f"audit: {sum(map(len, PLANNED.values()))} planned + {len(tracked)} tracked files checked, {bad} problem(s)")
    return 1 if bad else 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--audit":
        return audit()
    if len(sys.argv) < 2 or sys.argv[1] not in PEOPLE:
        print(__doc__)
        return 2
    who, base = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "origin/main")
    out = subprocess.run(["git", "-C", repo_root(), "diff", "--name-only", f"{base}...HEAD"], capture_output=True, text=True,
                         check=True).stdout
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
