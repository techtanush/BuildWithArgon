# OWNER: ayan
"""Computers API (04-api-contract.md §Cloud computers) against rows inserted directly."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from foundry_kernel.ids import new_id, utc_now

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def seed(settings: Any) -> dict[str, str]:
    vid, cid, tid = new_id("ven"), new_id("cmp"), new_id("ctk")
    folder = Path(settings.data_dir) / "computers" / tid
    folder.mkdir(parents=True)
    (folder / "1.png").write_bytes(PNG)
    now = utc_now()
    con = sqlite3.connect(settings.db_path)
    with con:
        con.execute("INSERT INTO ventures (id, name, slug, idea, founder_name, composio_user_id, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?)", (vid, "T", vid.lower(), "idea", "Alex", f"foundry:{vid}", now, now))
        con.execute("INSERT INTO computers (id, venture_id, agent_id, provider, status, image, last_screenshot_path, created_at, "
                    "updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (cid, vid, "eng.qa", "cua_sandbox", "busy", "ubuntu", f"computers/{tid}/1.png", now, now))
        con.execute("INSERT INTO computer_tasks (id, venture_id, computer_id, agent_id, goal, allowed_domains_json, status, "
                    "steps, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (tid, vid, cid, "eng.qa", "Visual QA", json.dumps(["localhost"]), "running", 1, now))
        con.execute("INSERT INTO computer_actions (task_id, step, action_json, reason, guard, screenshot_path, created_at) "
                    "VALUES (?,?,?,?,?,?,?)", (tid, 1, json.dumps({"type": "click", "x": 1, "y": 2}), "click Save", "allow",
                                               f"computers/{tid}/1.png", now))
    con.close()
    return {"vid": vid, "cid": cid, "tid": tid}


def test_list_and_task(client: Any, settings: Any) -> None:
    ids = seed(settings)
    r = client.get(f"/v1/ventures/{ids['vid']}/computers")
    assert r.status_code == 200
    item = r.json()["data"]["items"][0]
    assert item["id"] == ids["cid"] and item["provider"] == "cua_sandbox"
    assert item["current_task"] == {"id": ids["tid"], "goal": "Visual QA", "steps": 1, "status": "running"}
    r = client.get(f"/v1/computer-tasks/{ids['tid']}")
    data = r.json()["data"]
    assert data["allowed_domains"] == ["localhost"] and data["actions"][0]["guard"] == "allow"
    assert data["actions"][0]["screenshot_url"] == f"/v1/computer-tasks/{ids['tid']}/screens/1.png"


def test_screens(client: Any, settings: Any) -> None:
    ids = seed(settings)
    r = client.get(f"/v1/computers/{ids['cid']}/screen.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == PNG
    assert client.get(f"/v1/computer-tasks/{ids['tid']}/screens/1.png").content == PNG
    assert client.get(f"/v1/computer-tasks/{ids['tid']}/screens/2.png").status_code == 404


def test_not_found(client: Any, settings: Any) -> None:
    seed(settings)
    assert client.get("/v1/ventures/ven_NOPE/computers").status_code == 404
    r = client.get("/v1/computer-tasks/ctk_../screens/1.png")
    assert r.status_code == 404
    r = client.get(f"/v1/computers/{new_id('cmp')}/screen.png")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert client.get(f"/v1/computer-tasks/{new_id('ctk')}").status_code == 404
    assert client.post(f"/v1/computers/{new_id('cmp')}/stop", json={}).status_code == 404


def test_stop(client: Any, settings: Any) -> None:
    ids = seed(settings)
    r = client.post(f"/v1/computers/{ids['cid']}/stop", json={})
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["status"] == "stopped" and data["current_task"] is None
    task = client.get(f"/v1/computer-tasks/{ids['tid']}").json()["data"]
    assert task["status"] == "stopped" and task["completed_at"]
