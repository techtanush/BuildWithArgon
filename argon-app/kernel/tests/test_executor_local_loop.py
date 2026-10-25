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


async def test_nonzero_test_exit_cannot_pass_green_report(settings, tmp_path) -> None:
    runner = FakeRunner([{"tests": suite()}])

    async def bad_exit(cmd, cwd, timeout):
        code, output = await runner(cmd, cwd, timeout)
        return (1 if cmd[:2] == ["npm", "test"] else code), output

    v = await LocalLoopExecutor(settings, FakeLLM(), runner=bad_exit).verify(tmp_path)
    assert not v.ok and v.failed > 0
    assert any("exited with status 1" in f for f in v.failures)


async def test_unresolved_truncation_never_passes(settings) -> None:
    llm = FakeLLM()
    cut = '<<<FILE path="src/cut.ts">>>\nexport const x = '
    llm.script("engineering_build", [cut])
    llm.script("engineering_fix", [cut, cut])
    result = await LocalLoopExecutor(settings, llm, runner=FakeRunner([{"tests": suite()}])).run(inp(1), _log)
    assert result.status == "failed"
    assert any("truncated" in f for f in result.failures)


async def test_apply_rejects_symlink_and_reserved_report(settings, tmp_path) -> None:
    from foundry_kernel.executors import fileblocks

    ws = tmp_path / "workspace"
    ws.mkdir()
    outside = tmp_path / "outside.ts"
    outside.write_text("original")
    (ws / "link.ts").symlink_to(outside)
    ex = LocalLoopExecutor(settings, FakeLLM(), runner=FakeRunner([{"tests": suite()}]))
    written = await ex.apply(ws, fileblocks.parse(block("link.ts", "changed") + "\n" + block(".foundry/vitest.json", "{}")), _log)
    assert written == [] and outside.read_text() == "original"


def test_workspace_identifiers_cannot_escape(settings) -> None:
    import pytest
    from foundry_kernel.executors import workspace

    for vid, tid in [("../outside", "tkt_X"), ("ven_X", "../../outside"), ("ven_X", ".")]:
        with pytest.raises(ValueError):
            workspace.create_workspace(settings, vid, tid)


def test_multiple_prerequisite_changes_are_combined(settings) -> None:
    from foundry_kernel.executors import workspace

    left = workspace.create_workspace(settings, "ven_T", "tkt_left")
    right = workspace.create_workspace(settings, "ven_T", "tkt_right")
    (left / "src/lib/left.ts").write_text("export const left = 1;")
    (right / "src/lib/right.ts").write_text("export const right = 2;")
    (right / "src/lib/with space.ts").write_text("export const spaced = 3;")
    combined = workspace.create_workspace(settings, "ven_T", "tkt_join", base=left)
    workspace.overlay_changes(combined, right)
    assert (combined / "src/lib/left.ts").exists() and (combined / "src/lib/right.ts").exists()
    assert (combined / "src/lib/with space.ts").read_text() == "export const spaced = 3;"


def test_conflicting_prerequisite_changes_fail_without_partial_overlay(settings) -> None:
    import pytest
    from foundry_kernel.executors import workspace

    left = workspace.create_workspace(settings, "ven_T", "tkt_left")
    right = workspace.create_workspace(settings, "ven_T", "tkt_right")
    (left / "src/App.tsx").write_text("left implementation")
    (right / "src/App.tsx").write_text("right implementation")
    (right / "src/lib/new.ts").write_text("new implementation")
    combined = workspace.create_workspace(settings, "ven_T", "tkt_join", base=left)
    with pytest.raises(ValueError, match="conflicting prerequisite changes"):
        workspace.overlay_changes(combined, right)
    assert (combined / "src/App.tsx").read_text() == "left implementation"
    assert not (combined / "src/lib/new.ts").exists()


async def test_subprocess_timeout_kills_child_process_group(tmp_path) -> None:
    import asyncio
    import os
    import pytest
    from foundry_kernel.executors import workspace

    if os.name != "posix":
        pytest.skip("runner uses POSIX process sessions")
    code, output = await workspace.subprocess_runner(
        ["/bin/sh", "-c", "(sleep 0.4; printf leaked > escaped.txt) & printf ready > ready.txt; wait"], tmp_path, 0.15)
    assert code == 124 and "timeout" in output
    assert (tmp_path / "ready.txt").exists()
    await asyncio.sleep(0.45)
    assert not (tmp_path / "escaped.txt").exists()


async def test_subprocess_cancellation_kills_child_process_group(tmp_path) -> None:
    import asyncio
    import os
    import pytest
    from foundry_kernel.executors import workspace

    if os.name != "posix":
        pytest.skip("runner uses POSIX process sessions")
    task = asyncio.create_task(workspace.subprocess_runner(
        ["/bin/sh", "-c", "(sleep 0.4; printf leaked > escaped.txt) & printf ready > ready.txt; wait"], tmp_path, 10))
    for _ in range(100):
        if (tmp_path / "ready.txt").exists():
            break
        await asyncio.sleep(0.01)
    assert (tmp_path / "ready.txt").exists()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0.45)
    assert not (tmp_path / "escaped.txt").exists()


async def test_explicit_unavailable_docker_never_executes_host_or_model(settings, monkeypatch) -> None:
    from foundry_kernel.executors import workspace

    monkeypatch.setattr(workspace, "docker_available", lambda: False)
    async def forbidden(*args, **kwargs):
        raise AssertionError("host execution forbidden")
    monkeypatch.setattr(workspace, "subprocess_runner", forbidden)
    llm = FakeLLM()
    docker_settings = settings.model_copy(update={"local_sandbox": "docker"})
    result = await LocalLoopExecutor(docker_settings, llm).run(inp(), _log)
    assert result.status == "failed" and result.iterations == 0
    assert any("refusing host execution" in failure for failure in result.failures)
    assert llm.calls == []


def test_default_subprocess_runner_and_injected_fake_are_preserved(settings) -> None:
    from foundry_kernel.executors import workspace

    runner, warning = workspace.default_runner(settings.model_copy(update={"local_sandbox": "subprocess"}))
    assert runner is workspace.subprocess_runner and warning is None
    fake = FakeRunner([{"tests": suite()}])
    executor = LocalLoopExecutor(settings.model_copy(update={"local_sandbox": "docker"}), FakeLLM(), runner=fake)
    assert executor.runner is fake and executor.install_runner is fake


def test_prepare_cache_strips_secrets_from_npm_environment(settings, monkeypatch) -> None:
    import subprocess
    from foundry_kernel.executors import workspace

    monkeypatch.setenv("GEMINI_API_KEY", "test-secret-not-a-real-key")
    monkeypatch.setenv("GITHUB_TOKEN", "test-secret-not-a-real-token")
    seen = []
    def run(cmd, **kwargs):
        seen.append(kwargs)
        assert kwargs["env"] == workspace.sandbox_env(workspace.template_cache(settings))
        assert "GEMINI_API_KEY" not in kwargs["env"] and "GITHUB_TOKEN" not in kwargs["env"]
        return subprocess.CompletedProcess(cmd, 0, "", "")
    monkeypatch.setattr(workspace.subprocess, "run", run)
    assert workspace.prepare_cache(settings) == {}
    assert len(seen) == 1


async def test_live_subprocess_execution_fails_closed_without_unsafe_opt_in(settings, monkeypatch) -> None:
    from foundry_kernel.executors import workspace

    monkeypatch.delenv("ALLOW_UNSANDBOXED_EXECUTION", raising=False)
    async def forbidden(*args, **kwargs):
        raise AssertionError("live generated code must not execute on host")
    monkeypatch.setattr(workspace, "subprocess_runner", forbidden)
    llm = FakeLLM()
    live_settings = settings.model_copy(update={"llm_mode": "live", "local_sandbox": "subprocess"})
    executor = LocalLoopExecutor(live_settings, llm)
    assert executor.install_runner is workspace.unavailable_runner
    result = await executor.run(inp(), _log)
    assert result.status == "failed" and result.iterations == 0
    assert any("ALLOW_UNSANDBOXED_EXECUTION=1" in failure for failure in result.failures)
    assert llm.calls == []


def test_unsafe_host_execution_requires_exact_explicit_development_opt_in(settings, monkeypatch) -> None:
    from foundry_kernel.executors import workspace

    live_settings = settings.model_copy(update={"llm_mode": "live", "local_sandbox": "subprocess"})
    for value in ("0", "true", "yes", ""):
        monkeypatch.setenv("ALLOW_UNSANDBOXED_EXECUTION", value)
        runner, _ = workspace.default_runner(live_settings)
        assert runner is workspace.unavailable_runner
    monkeypatch.setenv("ALLOW_UNSANDBOXED_EXECUTION", "1")
    runner, warning = workspace.default_runner(live_settings)
    assert runner is workspace.subprocess_runner
    assert warning and "host filesystem and network access" in warning
    monkeypatch.delenv("ALLOW_UNSANDBOXED_EXECUTION")
    runner, warning = workspace.default_runner(settings.model_copy(update={"llm_mode": "fake", "local_sandbox": "subprocess"}))
    assert runner is workspace.subprocess_runner and warning is None


async def test_antigravity_local_fallback_does_not_bypass_live_isolation(settings, monkeypatch) -> None:
    from foundry_kernel.executors.antigravity import AntigravityExecutor

    monkeypatch.delenv("ALLOW_UNSANDBOXED_EXECUTION", raising=False)
    llm = FakeLLM()
    live_settings = settings.model_copy(update={"llm_mode": "live", "local_sandbox": "subprocess"})
    result = await AntigravityExecutor(live_settings, llm).run(inp(), _log)
    assert result.status == "failed" and result.iterations == 0
    assert llm.calls == []
