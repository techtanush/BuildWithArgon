# OWNER: tanush
"""Settings extensions preserve spending gates and venture isolation."""
import json

import pytest

from foundry_kernel.ids import utc_now
from tests.tanush.helpers import execute


def create(client, name="Pantry Pal"):
    result=client.post("/v1/ventures",json={"name":name,"idea":"Track pantry expiry","founder_name":"Tanush"})
    assert result.status_code==200, result.text
    return result.json()["data"]["id"]


def update(client, vid, **changes):
    result=client.post(f"/v1/ventures/{vid}/settings",json=changes)
    assert result.status_code==200, result.text
    return result.json()["data"]


def read(client, vid):
    result=client.get(f"/v1/ventures/{vid}/settings")
    assert result.status_code==200, result.text
    return result.json()["data"]


def rows(client, sql, args=()):
    return client.portal.call(client.app.state.db.fetch_all,sql,args)


def write(client, sql, args=()):
    return client.portal.call(execute,client.app.state.db,sql,args)


def test_defaults_and_settings_persist_in_venture_json(client):
    vid=create(client)
    initial=read(client,vid)
    assert initial=={"founder_name":"Tanush","budget_usd":25,"autopilot_next":False,"quality_default":"high","executor":"antigravity","approval_id":None}
    updated=update(client,vid,founder_name="  Alex  ",autopilot_next=True,quality_default="low")
    assert updated["founder_name"]=="Alex" and updated["autopilot_next"] is True and updated["quality_default"]=="low"
    assert read(client,vid)==updated
    stored=rows(client,"SELECT settings_json FROM ventures WHERE id=?",(vid,))[0]
    assert json.loads(stored["settings_json"])=={"autopilot_next":True,"quality_default":"low"}
    assert rows(client,"SELECT id FROM events WHERE venture_id=? AND type='venture.updated'",(vid,))


def test_budget_increase_always_requires_approval_even_on_draft(client):
    vid=create(client)
    updated=update(client,vid,budget_usd=35,founder_name="Alex")
    assert updated["budget_usd"]==25 and updated["founder_name"]=="Alex" and updated["approval_id"]
    gate=rows(client,"SELECT * FROM approvals WHERE id=?",(updated["approval_id"],))[0]
    assert gate["gate_type"]=="spend" and gate["status"]=="pending"
    assert json.loads(gate["payload_json"])["requested_increase_usd"]==10
    result=client.post(f"/v1/approvals/{gate['id']}/decision",json={"decision":"approve","decided_by":"Tanush"})
    assert result.status_code==200
    assert read(client,vid)["budget_usd"]==35 and read(client,vid)["approval_id"] is None


def test_repeated_proposal_reuses_pending_gate_and_different_proposal_conflicts(client):
    vid=create(client)
    first=update(client,vid,budget_usd=35)
    second=update(client,vid,budget_usd=35,quality_default="medium")
    assert first["approval_id"]==second["approval_id"] and second["quality_default"]=="medium"
    assert len(rows(client,"SELECT id FROM approvals WHERE venture_id=? AND gate_type='spend' AND status='pending'",(vid,)))==1
    different=client.post(f"/v1/ventures/{vid}/settings",json={"budget_usd":45,"founder_name":"Wrong mutation"})
    assert different.status_code==409
    assert read(client,vid)["founder_name"]=="Tanush" and read(client,vid)["budget_usd"]==25


def test_rejected_budget_never_raises_cap_and_new_proposal_can_be_created(client):
    vid=create(client)
    pending=update(client,vid,budget_usd=40)
    decision=client.post(f"/v1/approvals/{pending['approval_id']}/decision",json={"decision":"reject","decided_by":"Tanush"})
    assert decision.status_code==200 and read(client,vid)["budget_usd"]==25
    next_gate=update(client,vid,budget_usd=30)
    assert next_gate["approval_id"]!=pending["approval_id"] and next_gate["budget_usd"]==25


def test_budget_reduction_cannot_hide_spend_or_mutate_pending_proposal(client):
    vid=create(client)
    write(client,"UPDATE ventures SET spent_usd=10 WHERE id=?",(vid,))
    assert update(client,vid,budget_usd=15)["budget_usd"]==15
    result=client.post(f"/v1/ventures/{vid}/settings",json={"budget_usd":9,"autopilot_next":True})
    assert result.status_code==400 and result.json()["error"]["code"]=="budget_below_spend"
    assert read(client,vid)["autopilot_next"] is False and read(client,vid)["budget_usd"]==15
    update(client,vid,budget_usd=20)
    assert client.post(f"/v1/ventures/{vid}/settings",json={"budget_usd":12}).status_code==409


@pytest.mark.parametrize("changes",[{"founder_name":"A"},{"founder_name":"   "},{"founder_name":"a"*61},{"budget_usd":0},{"budget_usd":-1},{"budget_usd":"NaN"},{"budget_usd":"Infinity"},{"quality_default":"ultra"},{"autopilot_next":"yes"},{"founder_name":None},{"executor":"local"}])
def test_settings_reject_invalid_or_readonly_fields(client,changes):
    vid=create(client)
    before=read(client,vid)
    response=client.post(f"/v1/ventures/{vid}/settings",json=changes)
    assert response.status_code==422 and "error" in response.json()
    assert read(client,vid)==before


def test_executor_reports_runtime_override_and_settings_are_venture_scoped(client):
    first,second=create(client),create(client,"Other company")
    update(client,first,founder_name="Alex",autopilot_next=True)
    assert read(client,second)["founder_name"]=="Tanush" and read(client,second)["autopilot_next"] is False
    write(client,"INSERT INTO kv(key,value_json,updated_at) VALUES('executor.override',?,?)",(json.dumps("local"),utc_now()))
    assert read(client,first)["executor"]=="local"
    write(client,"UPDATE kv SET value_json=? WHERE key='executor.override'",(json.dumps("invented"),))
    assert read(client,first)["executor"]=="antigravity"


def test_department_resume_is_explicit_idempotent_and_scoped(client):
    first,second=create(client),create(client,"Other company")
    for vid in (first,second):
        write(client,"INSERT INTO kv(key,value_json,updated_at) VALUES(?,'true',?)",(f"dept.paused.{vid}.engineering",utc_now()))
    before=client.get(f"/v1/ventures/{first}/departments/engineering").json()["data"]
    assert before["paused"] is True
    result=client.post(f"/v1/ventures/{first}/departments/engineering/resume",json={})
    assert result.status_code==200 and result.json()["data"]=={"department_id":"engineering","paused":False}
    assert client.get(f"/v1/ventures/{first}/departments/engineering").json()["data"]["paused"] is False
    assert client.get(f"/v1/ventures/{second}/departments/engineering").json()["data"]["paused"] is True
    assert client.post(f"/v1/ventures/{first}/departments/engineering/resume",json={}).status_code==200
    assert rows(client,"SELECT value_json FROM kv WHERE key=?",(f"dept.paused.{second}.engineering",))[0]["value_json"]=="true"


@pytest.mark.parametrize("method,path",[("get","/v1/ventures/ven_missing/settings"),("post","/v1/ventures/ven_missing/settings"),("post","/v1/ventures/ven_missing/departments/engineering/resume")])
def test_settings_extensions_require_existing_venture(client,method,path):
    kwargs={"json":{}} if method=="post" else {}
    response=getattr(client,method)(path,**kwargs)
    assert response.status_code==404 and "error" in response.json()


def test_department_resume_rejects_unknown_department_without_writes(client):
    vid=create(client)
    response=client.post(f"/v1/ventures/{vid}/departments/missing/resume",json={})
    assert response.status_code==404
    assert not rows(client,"SELECT key FROM kv WHERE key=?",(f"dept.paused.{vid}.missing",))


def test_settings_founder_text_is_redacted(client):
    vid=create(client)
    key="ghp_"+"z"*25
    updated=update(client,vid,founder_name=key)
    assert updated["founder_name"]=="[REDACTED]"
    assert key not in json.dumps(rows(client,"SELECT * FROM ventures WHERE id=?",(vid,)))
    assert key not in json.dumps(rows(client,"SELECT * FROM events WHERE venture_id=?",(vid,)))
