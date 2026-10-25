# OWNER: ayan
"""Capture wrappers reject stale evidence and reap timed-out browser processes."""
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from foundry_kernel.worldgen import capture


async def test_missing_report_does_not_reuse_previous_capture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    old = tmp_path / 'probes' / 'iter-0' / 'engineering.json'
    old.parent.mkdir(parents=True)
    old.write_text('{"building":"engineering"}')
    proc = AsyncMock()
    proc.returncode = 0
    proc.communicate.return_value = (b'ok', None)
    monkeypatch.setattr(capture, '_cmd', lambda: ['fake'])
    monkeypatch.setattr(capture.asyncio, 'create_subprocess_exec', AsyncMock(return_value=proc))
    with pytest.raises(capture.CaptureError, match='no report'):
        await capture.run_capture(root=tmp_path, iteration=0, depts=['engineering'])
    assert not old.exists()


async def test_portrait_timeout_kills_and_reaps_child(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import Mock
    proc = AsyncMock()
    proc.kill = Mock()
    proc.pid = None
    proc.communicate.side_effect = [TimeoutError(), (b'', None)]
    monkeypatch.setattr(capture, '_cmd', lambda: ['fake'])
    monkeypatch.setattr(capture.asyncio, 'create_subprocess_exec', AsyncMock(return_value=proc))
    with pytest.raises(capture.CaptureError, match='timed out'):
        await capture.run_portraits(out_dir=tmp_path)
    proc.kill.assert_called_once()
    assert proc.communicate.await_count == 2


@pytest.mark.parametrize("portraits", [False, True])
async def test_cancel_capture_kills_process_group(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, portraits: bool) -> None:
    import asyncio
    import signal
    from unittest.mock import Mock
    proc = AsyncMock()
    proc.pid = 12345
    started = asyncio.Event()
    # Use a coroutine function so the subprocess starts waiting, rather than a prebuilt result.
    calls = 0
    async def communicate():
        nonlocal calls
        calls += 1
        if calls == 1:
            started.set()
            await asyncio.Future()
        return b"", None
    proc.communicate.side_effect = communicate
    killpg = Mock()
    monkeypatch.setattr(capture.os, "killpg", killpg)
    monkeypatch.setattr(capture, "_cmd", lambda: ["fake"])
    spawn = AsyncMock(return_value=proc)
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", spawn)
    task = asyncio.create_task(capture.run_portraits(out_dir=tmp_path) if portraits else
                               capture.run_capture(root=tmp_path, iteration=0, depts=["engineering"]))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    killpg.assert_called_once_with(12345, signal.SIGKILL)
    assert calls == 2
    assert spawn.call_args.kwargs["start_new_session"] is True
