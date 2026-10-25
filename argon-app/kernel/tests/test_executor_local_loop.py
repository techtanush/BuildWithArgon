# OWNER: ayan
"""E-03: the local repair loop runs until pass or MAX_BUILD_ITERATIONS and enforces the no-weakening rule
(scripted FakeLLM outputs + a fake npm runner)."""
from __future__ import annotations

from pathlib import Path

from foundry_kernel.contracts import ExecutorInput
from foundry_kernel.executors.local_loop import LocalLoopExecutor
from foundry_kernel.llm.fake import FakeLLM
from tests.ayan.eng_helpers import FakeRunner, block, notes

SMOKE = ("smoke renders App without crashing", ("tests/smoke.test.ts", "passed"))
LIB_TEST = "import { it, expect } from 'vitest';\nimport { add } from '../src/lib/add';\nit('adds', () => { expect(add(1, 2)).toBe(3); });\nit('adds zero', () => { expect(add(0, 2)).toBe(2); });"


def inp(max_iterations: int = 4) -> ExecutorInput:
    return ExecutorInput(venture_id="ven_T", ticket_id="tkt_01ABCDEFGH", run_id="run_T", title="Add", body="Add numbers",
                         acceptance_criteria=[{"id": "AC-1", "text": "add works"}], max_iterations=max_iterations)


def suite(**extra: tuple[str, str]) -> dict[str, tuple[str, str]]:
    return {SMOKE[0]: SMOKE[1], **extra}


async def _log(level: str, msg: str) -> None:
    pass


def build_output() -> str:
    return block("src/lib/add.ts", "export const add = (a: number, b: number) => a + b;") + "\n" + \
        block("tests/add.test.ts", LIB_TEST) + "\n" + notes("add module")


async def test_passes_first_time(settings) -> None:
    llm = FakeLLM()
    llm.script("engineering_build", [build_output()])
    runner = FakeRunner([{"tests": suite(adds=("tests/add.test.ts", "passed"))}])
    ex = LocalLoopExecutor(settings, llm, runner=runner)
    res = await ex.run(inp(), _log)
    assert res.status == "passed" and res.iterations == 1 and res.first_pass_passed
    assert res.summary == "add module" and res.tests_passed == 2 and res.build_ok
    ws = Path(res.workspace_path or "")
    assert (ws / "src/lib/add.ts").exists() and "src/lib/add.ts" in res.files_changed
    assert res.preview_path and Path(res.preview_path).name == "dist"
    assert ["npm", "install", "--no-audit", "--no-fund"] in runner.calls  # no template cache in tests
    assert [c[0] for c in llm.calls] == ["engineering_build"]


async def test_repairs_until_pass(settings) -> None:
    llm = FakeLLM()
    llm.script("engineering_build", [build_output()])
    llm.script("engineering_fix", [block("src/lib/add.ts", "export const add = (a: number, b: number) => a + b; // fixed") + "\n" + notes("fixed")])
    runner = FakeRunner([{"tests": suite(adds=("tests/add.test.ts", "failed"))},
                         {"tests": suite(adds=("tests/add.test.ts", "passed"))}])
    res = await LocalLoopExecutor(settings, llm, runner=runner).run(inp(), _log)
    assert res.status == "passed" and res.iterations == 2 and not res.first_pass_passed
    assert [c[0] for c in llm.calls] == ["engineering_build", "engineering_fix"]
    assert "Verification failed (iteration 1/4)" in llm.calls[1][1] and "adds" in llm.calls[1][1]


async def test_fails_after_max_iterations(settings) -> None:
    llm = FakeLLM()
    llm.script("engineering_build", [build_output()])
    llm.script("engineering_fix", [notes("tried"), notes("tried again")])
    runner = FakeRunner([{"tests": suite(adds=("tests/add.test.ts", "failed")), "build": 1}])
    res = await LocalLoopExecutor(settings, llm, runner=runner).run(inp(max_iterations=3), _log)
    assert res.status == "failed" and res.iterations == 3 and not res.first_pass_passed
    assert any("adds" in f for f in res.failures) and any(f.startswith("build failed") for f in res.failures)


async def test_removed_test_is_rejected_until_restored(settings) -> None:
    llm = FakeLLM()
    llm.script("engineering_build", [build_output()])
    llm.script("engineering_fix", [notes("dropped a test"), notes("restored")])
    runner = FakeRunner([
        {"tests": suite(adds=("tests/add.test.ts", "passed"), **{"adds zero": ("tests/add.test.ts", "failed")})},
        {"tests": suite(adds=("tests/add.test.ts", "passed"))},  # 'adds zero' vanished, no new test in that file
        {"tests": suite(adds=("tests/add.test.ts", "passed"), **{"adds zero": ("tests/add.test.ts", "passed")})},
    ])
    ex = LocalLoopExecutor(settings, llm, runner=runner)
    res = await ex.run(inp(), _log)
    assert res.status == "passed" and res.iterations == 3
    assert ex.iterations_detail[1]["rejected"] and ex.iterations_detail[1]["removed_tests"] == ["adds zero"]
    assert "You removed tests:" in llm.calls[2][1] and "adds zero" in llm.calls[2][1]


async def test_weakened_assertions_are_rejected(settings) -> None:
    llm = FakeLLM()
    llm.script("engineering_build", [block("tests/smoke.test.ts", "import { it } from 'vitest';\nit('smoke renders App without crashing', () => {});") + "\n" + notes()])
    llm.script("engineering_fix", [notes("restored")])
    runner = FakeRunner([{"tests": suite()}])
    ex = LocalLoopExecutor(settings, llm, runner=runner)
    res = await ex.run(inp(max_iterations=2), _log)
    assert ex.iterations_detail[0]["rejected"] and ex.iterations_detail[0]["weakened_files"] == ["tests/smoke.test.ts"]
    assert res.status == "failed" and any("removed or weakened" in f for f in res.failures)


async def test_truncated_output_asks_to_continue(settings) -> None:
    llm = FakeLLM()
    llm.script("engineering_build", [block("src/lib/add.ts", "export const add = (a: number, b: number) => a + b;")
                                     + '\n<<<FILE path="tests/add.test.ts">>>\nimport { it'])
    llm.script("engineering_fix", [block("tests/add.test.ts", LIB_TEST) + "\n" + notes("continued")])
    runner = FakeRunner([{"tests": suite(adds=("tests/add.test.ts", "passed"))}])
    res = await LocalLoopExecutor(settings, llm, runner=runner).run(inp(), _log)
    assert res.status == "passed" and res.iterations == 1
    assert "truncated inside tests/add.test.ts" in llm.calls[1][1]
    assert "expect(add(1, 2))" in (Path(res.workspace_path or "") / "tests/add.test.ts").read_text()


async def test_unsafe_blocks_are_not_written(settings, tmp_path) -> None:
    llm = FakeLLM()
    llm.script("engineering_build", [block("../escape.ts", "x") + "\n" + block(".env", "KEY=1") + "\n"
                                     + block("src/ok.ts", "export const ok = 1;") + "\n" + notes()])
    runner = FakeRunner([{"tests": suite()}])
    res = await LocalLoopExecutor(settings, llm, runner=runner).run(inp(), _log)
    ws = Path(res.workspace_path or "")
    assert (ws / "src/ok.ts").exists() and not (ws / ".env").exists() and not (ws.parent / "escape.ts").exists()
