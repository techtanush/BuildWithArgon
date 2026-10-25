# OWNER: ayan
"""Test doubles for the engineering loop: a scripted command runner that never spawns npm."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class FakeRunner:
    """Each `npm test` consumes the next outcome: {"tests": {fullName: (file, "passed"|"failed")}, "build": exit code,
    "dist": bool}. The last outcome repeats. `npx vitest run tests/hidden ...` uses `hidden` if given."""

    def __init__(self, outcomes: list[dict[str, Any]], hidden: dict[str, tuple[str, str]] | None = None) -> None:
        self.outcomes = outcomes
        self.hidden = hidden or {}
        self.i = 0
        self.calls: list[list[str]] = []

    @staticmethod
    def write_report(path: Path, cwd: Path, tests: dict[str, tuple[str, str]]) -> None:
        by_file: dict[str, list[dict[str, Any]]] = {}
        for name, (file, status) in tests.items():
            by_file.setdefault(file, []).append({"fullName": name, "title": name, "status": status,
                                                 "failureMessages": [] if status == "passed" else [f"AssertionError in {name}"]})
        passed = sum(1 for _, s in tests.values() if s == "passed")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"numPassedTests": passed, "numFailedTests": len(tests) - passed,
                                    "testResults": [{"name": str(cwd / f), "status": "passed", "assertionResults": a}
                                                    for f, a in by_file.items()]}))

    async def __call__(self, cmd: list[str], cwd: Path, timeout: int) -> tuple[int, str]:
        self.calls.append(cmd)
        if cmd[:2] == ["npm", "install"]:
            return 0, "installed"
        outcome = self.outcomes[min(self.i, len(self.outcomes) - 1)]
        if cmd[:2] == ["npm", "test"]:
            out = next(a.split("=", 1)[1] for a in cmd if a.startswith("--outputFile="))
            self.write_report(cwd / out, cwd, outcome["tests"])
            return (0 if all(s == "passed" for _, s in outcome["tests"].values()) else 1), "vitest output"
        if cmd[:3] == ["npm", "run", "build"]:
            self.i += 1
            if outcome.get("build", 0) == 0 and outcome.get("dist", True):
                (cwd / "dist").mkdir(exist_ok=True)
                (cwd / "dist" / "index.html").write_text("<!doctype html><title>preview</title>")
            return outcome.get("build", 0), "build output"
        if cmd[:3] == ["npx", "vitest", "run"]:
            out = next(a.split("=", 1)[1] for a in cmd if a.startswith("--outputFile="))
            self.write_report(cwd / out, cwd, self.hidden)
            return 0, "hidden"
        return 0, ""


def block(path: str, content: str) -> str:
    return f'<<<FILE path="{path}">>>\n{content}\n<<<END FILE>>>'


def notes(summary: str = "done") -> str:
    return 'FOUNDRY_NOTES {"summary":"' + summary + '","tests_added":[],"assumptions":[]}'
