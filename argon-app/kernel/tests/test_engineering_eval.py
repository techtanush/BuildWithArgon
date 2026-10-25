# OWNER: ayan
"""V-01 plumbing: the engineering eval runs both conditions, runs hidden tests the model never saw, writes results."""
from __future__ import annotations

import json

import pytest

from foundry_kernel.evals import engineering_eval
from foundry_kernel.llm.fake import FakeLLM
from tests.ayan.eng_helpers import FakeRunner, block, notes


async def test_eval_writes_results_for_both_conditions(settings, tmp_path) -> None:
    out = block("src/lib/settle.ts", "export const balances = () => ({});") + "\n" + notes("settle")
    llm = FakeLLM()
    llm.script("eval_baseline", [out])
    llm.script("engineering_build", [out])
    runner = FakeRunner([{"tests": {"settles": ("tests/settle.test.ts", "passed")}}],
                        hidden={"h1": ("tests/hidden/split-bill.test.ts", "passed"), "h2": ("tests/hidden/split-bill.test.ts", "failed")})
    path = await engineering_eval.run_eval(settings, brief="split-bill", condition="both", repeats=1, llm=llm, runner=runner,
                                           results_dir=tmp_path)
    data = json.loads(path.read_text())
    assert data["fake"] is True and [c["condition"] for c in data["cases"]] == ["baseline", "loop"]
    assert all(c["hidden_passed"] == 1 and c["hidden_total"] == 2 and not c["all_hidden_pass"] for c in data["cases"])
    assert data["summary"]["loop"]["n"] == 1
    assert not any("hidden_tests" in p or "toEqual" in p for _, p in llm.calls)  # hidden tests never reach the model


def test_refuses_fake_mode(monkeypatch) -> None:
    from foundry_kernel.config import Settings

    monkeypatch.setattr(engineering_eval, "get_settings", lambda: Settings(_env_file=None, llm_mode="fake"))
    with pytest.raises(SystemExit):
        engineering_eval.main([])
