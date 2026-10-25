# OWNER: tanush
"""Metrics must be computed from records, including failures and absent evidence."""

import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from foundry_kernel.ids import new_id, utc_now
from tests.test_api_contract import create_ticket, create_venture, data, rows, write


def sample(total, agent_id="eng.builder"):
    return {
        "agent_id": agent_id,
        "stt_ms": total / 10,
        "answer_ms": total / 2,
        "tts_ms": total / 4,
        "total_ms": total,
    }


def test_empty_metrics_do_not_claim_success_or_zero_latency(client):
    vid = create_venture(client)["id"]
    result = data(client.get(f"/v1/ventures/{vid}/metrics"))
    for name in (
        "first_run_pass_rate",
        "loop_pass_rate",
        "avg_iterations",
        "total_cost_usd",
        "cost_per_shipped_task",
    ):
        assert result["engineering"][name] is None
    assert result["engineering"]["n"] == 0 and result["engineering"]["tickets"] == []
    assert result["grounding"]["accuracy"] is None and result["grounding"]["n"] == 0
    assert result["world"]["final_score"] is None
    assert result["latency"]["p50_ms"] is None and result["latency"]["n"] == 0
    assert result["costs"]["spent_usd"] == 0
    assert data(client.get("/v1/evals/latest")) == {
        "engineering": None,
        "grounding": None,
        "world": None,
    }


def test_build_metrics_preserve_failed_builds_and_artifact_evidence(client):
    vid = create_venture(client)["id"]
    first = create_ticket(
        client, vid, type="eng.build", department_id="engineering", title="First build"
    )["id"]
    second = create_ticket(
        client, vid, type="eng.fix", department_id="engineering", title="Repair"
    )["id"]
    write(
        client,
        "UPDATE tickets SET status='done',result_json=? WHERE id=?",
        (
            json.dumps(
                {
                    "first_pass_passed": True,
                    "final_passed": True,
                    "iterations": 1,
                    "cost_usd": 1.5,
                }
            ),
            first,
        ),
    )
    write(client, "UPDATE tickets SET status='failed' WHERE id=?", (second,))
    write(
        client,
        "INSERT INTO artifacts(id,venture_id,ticket_id,department_id,kind,title,meta_json,created_at) VALUES(?,?,?,'engineering','test_report','Failed verification',?,?)",
        (
            new_id("art"),
            vid,
            second,
            json.dumps(
                {
                    "executor_result": {
                        "first_pass_passed": False,
                        "status": "failed",
                        "iterations": 4,
                        "tests_passed": 2,
                        "tests_failed": 3,
                        "cost_usd": 2.5,
                    }
                }
            ),
            utc_now(),
        ),
    )
    result = data(client.get(f"/v1/ventures/{vid}/metrics"))["engineering"]
    assert result["n"] == 2 and result["first_pass_n"] == result["final_pass_n"] == 2
    assert result["first_run_pass_rate"] == result["loop_pass_rate"] == 0.5
    assert result["avg_iterations"] == 2.5 and result["total_cost_usd"] == 4
    assert result["cost_per_shipped_task"] is None
    failed = next(row for row in result["tickets"] if row["ticket_id"] == second)
    assert failed["final_passed"] is False and failed["tests_failed"] == 3


def test_done_without_verification_does_not_become_a_passing_build(client):
    vid = create_venture(client)["id"]
    ticket = create_ticket(client, vid, type="eng.build", department_id="engineering")[
        "id"
    ]
    write(
        client,
        "UPDATE tickets SET status='done',result_json='{}' WHERE id=?",
        (ticket,),
    )
    result = data(client.get(f"/v1/ventures/{vid}/metrics"))["engineering"]
    assert (
        result["n"] == 1
        and result["loop_pass_rate"] is None
        and result["final_pass_n"] == 0
    )


def test_metrics_exclude_other_ventures_and_prefer_actual_ledger_cost(client):
    first, second = create_venture(client)["id"], create_venture(client, "Other")["id"]
    ticket = create_ticket(
        client, first, type="eng.build", department_id="engineering"
    )["id"]
    other = create_ticket(
        client, second, type="eng.build", department_id="engineering"
    )["id"]
    for tid in (ticket, other):
        write(
            client,
            "UPDATE tickets SET status='done',result_json=? WHERE id=?",
            (json.dumps({"final_passed": True, "cost_usd": 999}), tid),
        )
    rid = new_id("run")
    write(
        client,
        "INSERT INTO runs(id,venture_id,ticket_id,kind,job,model,status,created_at) VALUES(?,?,?,'ticket','engineering_build','gemini-4-argon','succeeded',?)",
        (rid, first, ticket, utc_now()),
    )
    from foundry_kernel import ledger

    async def charge():
        async with client.app.state.db.tx() as tx:
            await ledger.record(
                tx,
                venture_id=first,
                run_id=rid,
                kind="model",
                department_id="engineering",
                model="gemini-4-argon",
                cost_usd=2,
            )

    client.portal.call(charge)
    result = data(client.get(f"/v1/ventures/{first}/metrics"))
    assert (
        result["engineering"]["n"] == 1 and result["engineering"]["total_cost_usd"] == 2
    )
    assert result["costs"]["spent_usd"] == 2
    assert result["costs"]["by_department"][0]["cost_usd"] == 2


def test_latest_evaluation_preserves_entire_cohort_and_failed_cases(client):
    vid = create_venture(client)["id"]
    cases = [
        ("old", "old", "2026-10-25T10:00:00Z", 1, 1, 1, False, True),
        ("G01", "latest", "2026-10-25T11:00:00Z", 1, 1, 1, False, True),
        ("G02", "latest", "2026-10-25T11:00:01Z", 0, 0, None, True, False),
    ]
    for case, cohort, created, fact, citation, route, fabricated, agrees in cases:
        metrics = {
            "evaluation_id": cohort,
            "fact_score": fact,
            "citation_score": citation,
            "route_score": route,
            "fabricated": fabricated,
            "checker_agrees": agrees,
        }
        write(
            client,
            "INSERT INTO eval_results(id,suite,case_id,condition,metrics_json,created_at) VALUES(?,'grounding',?,'default',?,?)",
            (new_id("evl"), case, json.dumps(metrics), created),
        )
    latest = data(client.get("/v1/evals/latest"))["grounding"]
    assert [row["case_id"] for row in latest["items"]] == ["G01", "G02"]
    assert latest["items"][1]["metrics"]["fact_score"] == 0
    grounding = data(client.get(f"/v1/ventures/{vid}/metrics"))["grounding"]
    assert grounding == {
        "n": 2,
        "accuracy": 0.5,
        "citation_accuracy": 0.5,
        "route_accuracy": 1,
        "fabrication_rate": 0.5,
        "checker_agreement": 0.5,
        "answerer": None,
        "capability_evidence": None,
    }


def test_world_score_uses_latest_record_and_does_not_reuse_old_success(client):
    vid = create_venture(client)["id"]
    for rid, status, score, timestamp in (
        ("wgr_old", "succeeded", 0.9, "2026-10-25T10:00:00Z"),
        ("wgr_new", "failed", None, "2026-10-25T11:00:00Z"),
    ):
        write(
            client,
            "INSERT INTO worldgen_runs(id,status,final_score,data_path,started_at) VALUES(?,?,?,?,?)",
            (rid, status, score, rid, timestamp),
        )
    world = data(client.get(f"/v1/ventures/{vid}/metrics"))["world"]
    assert world == {"run_id": "wgr_new", "status": "failed", "final_score": None}


def test_grounding_report_summary_keeps_fake_evidence_label(client):
    vid = create_venture(client)["id"]
    summary = {
        "n": 2,
        "accuracy": 0.5,
        "citation_accuracy": 1,
        "route_accuracy": None,
        "fabrication_rate": 0,
        "checker_agreement": 0.5,
    }
    for index in range(2):
        metrics = {
            "report_id": "report_fake",
            "answerer": "fake",
            "capability_evidence": False,
            "summary": summary,
            "fact_pass": bool(index),
            "citation_pass": True,
            "route_required": False,
            "route_pass": True,
            "fabrication": False,
            "checker_agreement": bool(index),
        }
        write(
            client,
            "INSERT INTO eval_results(id,suite,case_id,condition,metrics_json,created_at) VALUES(?,'grounding',?,'default',?,?)",
            (new_id("evl"), f"G{index}", json.dumps(metrics), utc_now()),
        )
    metrics = data(client.get(f"/v1/ventures/{vid}/metrics"))["grounding"]
    assert metrics["accuracy"] == 0.5 and metrics["route_accuracy"] is None
    assert metrics["answerer"] == "fake" and metrics["capability_evidence"] is False
    suite = data(client.get("/v1/evals/latest"))["grounding"]
    assert len(suite["items"]) == 2 and suite["capability_evidence"] is False


def test_latency_percentiles_are_measured_and_rolling_500(client):
    vid = create_venture(client)["id"]
    assert data(
        client.post(
            "/v1/telemetry/latency", json={"samples": [sample(100), sample(200)]}
        )
    ) == {"stored": 2}
    measured = data(client.get(f"/v1/ventures/{vid}/metrics"))["latency"]
    assert (
        measured["n"] == 2 and measured["p50_ms"] == 150 and measured["p90_ms"] == 190
    )
    assert measured["by_stage"]["answer_ms"]["p50_ms"] == 75
    assert measured["scope"] == "global"
    data(
        client.post(
            "/v1/telemetry/latency", json={"samples": [sample(n) for n in range(501)]}
        )
    )
    stored = json.loads(
        rows(client, "SELECT value_json FROM kv WHERE key='latency.samples'")[0][
            "value_json"
        ]
    )
    assert (
        len(stored) == 500
        and stored[0]["total_ms"] == 1
        and stored[-1]["total_ms"] == 500
    )


def test_concurrent_telemetry_posts_do_not_lose_batches(client):
    def submit(index):
        return client.post("/v1/telemetry/latency", json={"samples": [sample(index)]})

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(submit, range(20)))
    assert all(response.status_code == 200 for response in results)
    stored = json.loads(
        rows(client, "SELECT value_json FROM kv WHERE key='latency.samples'")[0][
            "value_json"
        ]
    )
    assert len(stored) == 20 and {row["total_ms"] for row in stored} == set(range(20))


@pytest.mark.parametrize("invalid", [-1, "bad", None])
def test_invalid_latency_is_rejected_without_partial_storage(client, invalid):
    body = sample(20)
    body["answer_ms"] = invalid
    response = client.post(
        "/v1/telemetry/latency", json={"samples": [sample(10), body]}
    )
    assert response.status_code == 422 and "error" in response.json()
    assert rows(client, "SELECT * FROM kv WHERE key='latency.samples'") == []


def test_metrics_missing_venture_has_contract_error(client):
    response = client.get("/v1/ventures/ven_missing/metrics")
    assert response.status_code == 404 and "error" in response.json()
