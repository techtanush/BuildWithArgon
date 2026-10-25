# OWNER: ayan
"""Computer-use evidence: screenshots -> data/computers/<task_id>/<step>.png, URLs for the dashboard,
artifact attachments. Spec: 02-models-and-integrations/10-cua-cloud-computers.md."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

ID_RE = re.compile(r"^(cmp|ctk)_[0-9A-Z]{26}$")
TASK_RE = re.compile(r"^ctk_[0-9A-Z]{26}$")
ROOT = "computers"


def valid_id(value: str, prefix: str | None = None) -> bool:
    return bool(ID_RE.match(value or "")) and (prefix is None or value.startswith(prefix + "_"))


def _root(settings: Any) -> Path:
    return (Path(settings.data_dir) / ROOT).resolve()


def save_screenshot(settings: Any, task_id: str, step: int, png: bytes) -> str:
    """Write the PNG and return its path relative to DATA_DIR (e.g. `computers/ctk_…/3.png`)."""
    if not TASK_RE.match(task_id) or step < 0:
        raise ValueError(f"invalid evidence target {task_id!r}/{step}")
    folder = _root(settings) / task_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{int(step)}.png").write_bytes(png)
    return f"{ROOT}/{task_id}/{int(step)}.png"


def resolve(settings: Any, rel_path: str | None) -> Path | None:
    """Absolute path for a stored relative path, only if it stays under data/computers and exists."""
    if not rel_path:
        return None
    root = _root(settings)
    path = (Path(settings.data_dir) / rel_path).resolve()
    if root not in path.parents or not path.is_file():
        return None
    return path


def step_path(settings: Any, task_id: str, step: int) -> Path | None:
    if not TASK_RE.match(task_id):
        return None
    return resolve(settings, f"{ROOT}/{task_id}/{int(step)}.png")


def screen_url(task_id: str, step: int) -> str:
    return f"/v1/computer-tasks/{task_id}/screens/{int(step)}.png"


def artifact_meta(task_id: str, steps: list[int]) -> dict[str, Any]:
    """`meta` fragment for an artifact that cites a computer task (source cards open the task)."""
    return {"computer_task_id": task_id, "screenshots": [screen_url(task_id, s) for s in steps]}
