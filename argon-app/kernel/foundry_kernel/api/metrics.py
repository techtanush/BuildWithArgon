# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Measured outcomes and latency; missing evidence is represented by null."""

from __future__ import annotations

import math
from statistics import mean
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..api_models import Envelope
from ..db import json_dumps, json_loads_or
from ..ids import utc_now
from ..records import get_row

router = APIRouter(tags=["metrics"])


class LatencySample(BaseModel):
    agent_id: str = Field(min_length=1, max_length=200)
    stt_ms: float = Field(ge=0, allow_inf_nan=False)
    answer_ms: float = Field(ge=0, allow_inf_nan=False)
    tts_ms: float = Field(ge=0, allow_inf_nan=False)
    total_ms: float = Field(ge=0, allow_inf_nan=False)


class LatencyRequest(BaseModel):
    samples: list[LatencySample] = Field(max_length=5000)


class Stored(BaseModel):
    stored: int


class Percentiles(BaseModel):
    n: int = 0
    p50_ms: float | None = None
    p90_ms: float | None = None


class LatencyMetrics(Percentiles):
    scope: str = "global"
    by_stage: dict[str, Percentiles] = Field(default_factory=dict)


class BuildMetric(BaseModel):
    ticket_id: str
    title: str
    status: str
    first_pass_passed: bool | None = None
    final_passed: bool | None = None
    iterations: float | None = None
    tests_passed: float | None = None
    tests_failed: float | None = None
    cost_usd: float | None = None
    executor: str | None = None


class EngineeringMetrics(BaseModel):
    n: int = 0
    first_run_pass_rate: float | None = None
    loop_pass_rate: float | None = None
    avg_iterations: float | None = None
    total_cost_usd: float | None = None
    cost_per_shipped_task: float | None = None
    first_pass_n: int = 0
    final_pass_n: int = 0
    tickets: list[BuildMetric] = Field(default_factory=list)


class EvalRecord(BaseModel):
    id: str
    case_id: str
    condition: str
    metrics: dict[str, Any]
    created_at: str


class EvalSuite(BaseModel):
    suite: str
    created_at: str
    items: list[EvalRecord]
    answerer: str | None = None
    capability_evidence: bool | None = None


class LatestEvals(BaseModel):
    engineering: EvalSuite | None = None
    grounding: EvalSuite | None = None
    world: EvalSuite | None = None


class GroundingMetrics(BaseModel):
    n: int = 0
    accuracy: float | None = None
    citation_accuracy: float | None = None
    route_accuracy: float | None = None
    fabrication_rate: float | None = None
    checker_agreement: float | None = None
    answerer: str | None = None
    capability_evidence: bool | None = None


class WorldMetrics(BaseModel):
    final_score: float | None = None
    run_id: str | None = None
    status: str | None = None


class CostGroup(BaseModel):
    cost_usd: float
    department_id: str | None = None
    model: str | None = None


class CostMetrics(BaseModel):
    spent_usd: float
    budget_usd: float
    by_department: list[CostGroup]
    by_model: list[CostGroup]


class Metrics(BaseModel):
    engineering: EngineeringMetrics
    grounding: GroundingMetrics
    world: WorldMetrics
    costs: CostMetrics
    latency: LatencyMetrics


def number(value: Any) -> float | None:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        return None
    return float(value)


def score(value: Any) -> float | None:
    if isinstance(value, bool):
        return float(value)
    result = number(value)
    return result if result is not None and 0 <= result <= 1 else None


def percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


async def latency_metrics(db: Any) -> LatencyMetrics:
    row = await db.fetch_one("SELECT value_json FROM kv WHERE key='latency.samples'")
    stored = json_loads_or(row["value_json"], []) if row else []
    valid = []
    for item in stored if isinstance(stored, list) else []:
        try:
            valid.append(LatencySample.model_validate(item))
        except ValueError:
            continue
    stages = {}
    for stage in ("stt_ms", "answer_ms", "tts_ms", "total_ms"):
        values = [getattr(sample, stage) for sample in valid[-500:]]
        stages[stage] = Percentiles(
            n=len(values),
            p50_ms=percentile(values, 0.5),
            p90_ms=percentile(values, 0.9),
        )
    return LatencyMetrics(**stages["total_ms"].model_dump(), by_stage=stages)


async def latest_evals(db: Any) -> LatestEvals:
    rows = await db.fetch_all(
        "SELECT * FROM eval_results ORDER BY created_at DESC,id DESC"
    )
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        row["metrics"] = json_loads_or(row["metrics_json"], {})
        if not isinstance(row["metrics"], dict):
            row["metrics"] = {}
        grouped.setdefault(row["suite"], []).append(row)
    result = LatestEvals()
    for name, candidates in grouped.items():
        newest = candidates[0]

        def cohort_id(row):
            return row["metrics"].get(
                "evaluation_id",
                row["metrics"].get("report_id", row["metrics"].get("run_id")),
            )

        cohort = cohort_id(newest)
        selected = [
            row
            for row in candidates
            if (
                cohort_id(row) == cohort
                if cohort is not None
                else row["created_at"] == newest["created_at"]
            )
        ]
        # Preserve every case in the latest evaluation, including failed cases.
        records = [
            EvalRecord(
                **{
                    key: row[key]
                    for key in ("id", "case_id", "condition", "metrics", "created_at")
                }
            )
            for row in sorted(
                selected, key=lambda row: (row["case_id"], row["condition"], row["id"])
            )
        ]
        if name in {"engineering", "grounding", "world"}:
            metadata = newest["metrics"]
            setattr(
                result,
                name,
                EvalSuite(
                    suite=name,
                    created_at=newest["created_at"],
                    items=records,
                    answerer=metadata.get("answerer")
                    if isinstance(metadata.get("answerer"), str)
                    else None,
                    capability_evidence=metadata.get("capability_evidence")
                    if isinstance(metadata.get("capability_evidence"), bool)
                    else None,
                ),
            )
    return result


def average_metric(records: list[EvalRecord], *keys: str) -> float | None:
    values = []
    for row in records:
        value = next(
            (
                score(row.metrics[key])
                for key in keys
                if score(row.metrics.get(key)) is not None
            ),
            None,
        )
        if value is not None:
            values.append(value)
    return mean(values) if values else None


def grounding_metrics(suite: EvalSuite | None) -> GroundingMetrics:
    if suite is None:
        return GroundingMetrics()
    rows = suite.items
    summary = rows[-1].metrics.get("summary") if rows else None
    if isinstance(summary, dict):
        return GroundingMetrics(
            n=int(number(summary.get("n")) or len(rows)),
            accuracy=score(summary.get("accuracy", summary.get("fact_accuracy"))),
            citation_accuracy=score(summary.get("citation_accuracy")),
            route_accuracy=score(summary.get("route_accuracy")),
            fabrication_rate=score(summary.get("fabrication_rate")),
            checker_agreement=score(summary.get("checker_agreement")),
            answerer=suite.answerer,
            capability_evidence=suite.capability_evidence,
        )
    routing = [row for row in rows if row.metrics.get("route_required") is not False]
    return GroundingMetrics(
        n=len(rows),
        accuracy=average_metric(
            rows, "fact_pass", "fact_score", "fact", "fact_accuracy", "accuracy"
        ),
        citation_accuracy=average_metric(
            rows, "citation_pass", "citation_score", "citation", "citation_accuracy"
        ),
        route_accuracy=average_metric(
            routing, "route_pass", "route_score", "route", "route_accuracy"
        ),
        fabrication_rate=average_metric(
            rows, "fabricated", "fabrication", "fabrication_rate"
        ),
        checker_agreement=average_metric(rows, "checker_agrees", "checker_agreement"),
        answerer=suite.answerer,
        capability_evidence=suite.capability_evidence,
    )


def build_evidence(ticket: dict, artifacts: list[dict]) -> dict:
    evidence = {}
    for artifact in artifacts:
        metadata = json_loads_or(artifact["meta_json"], {})
        if isinstance(metadata, dict):
            evidence.update(metadata)
            for key in ("result", "executor_result"):
                if isinstance(metadata.get(key), dict):
                    evidence.update(metadata[key])
    result = json_loads_or(ticket["result_json"], {})
    if isinstance(result, dict):
        evidence.update(result)
        for key in ("result", "executor_result"):
            if isinstance(result.get(key), dict):
                evidence.update(result[key])
    return evidence


async def engineering_metrics(db: Any, venture_id: str) -> EngineeringMetrics:
    tickets = await db.fetch_all(
        "SELECT * FROM tickets WHERE venture_id=? AND type IN ('eng.build','eng.fix') AND status IN ('done','failed') ORDER BY created_at,id",
        (venture_id,),
    )
    artifacts = await db.fetch_all(
        "SELECT * FROM artifacts WHERE venture_id=? AND kind IN ('code','test_report','build') ORDER BY created_at,id",
        (venture_id,),
    )
    measured = []
    for ticket in tickets:
        evidence = build_evidence(
            ticket,
            [
                artifact
                for artifact in artifacts
                if artifact["ticket_id"] == ticket["id"]
            ],
        )
        final = evidence.get("final_passed")
        if not isinstance(final, bool):
            final = (
                {"passed": True, "failed": False}.get(evidence["status"])
                if isinstance(evidence.get("status"), str)
                else None
            )
        if final is None and isinstance(evidence.get("build_ok"), bool):
            failures = number(evidence.get("tests_failed"))
            if failures is not None:
                final = evidence["build_ok"] and failures == 0
        cost = await db.fetch_one(
            "SELECT COUNT(*) AS n,SUM(l.cost_usd) AS cost FROM ledger l JOIN runs r ON r.id=l.run_id WHERE r.ticket_id=?",
            (ticket["id"],),
        )
        measured.append(
            BuildMetric(
                ticket_id=ticket["id"],
                title=ticket["title"],
                status=ticket["status"],
                first_pass_passed=evidence.get("first_pass_passed")
                if isinstance(evidence.get("first_pass_passed"), bool)
                else None,
                final_passed=final,
                iterations=number(evidence.get("iterations")),
                tests_passed=number(evidence.get("tests_passed")),
                tests_failed=number(evidence.get("tests_failed")),
                cost_usd=cost["cost"]
                if cost["n"]
                else number(evidence.get("cost_usd")),
                executor=evidence.get("executor")
                if isinstance(evidence.get("executor"), str)
                else None,
            )
        )
    first = [
        float(row.first_pass_passed)
        for row in measured
        if row.first_pass_passed is not None
    ]
    final = [
        float(row.final_passed) for row in measured if row.final_passed is not None
    ]
    iterations = [row.iterations for row in measured if row.iterations is not None]
    costs = [row.cost_usd for row in measured if row.cost_usd is not None]
    shipped = len(
        {
            artifact["ticket_id"] or artifact["id"]
            for artifact in artifacts
            if artifact["kind"] == "build"
        }
    )
    total = sum(costs) if costs else None
    return EngineeringMetrics(
        n=len(measured),
        first_run_pass_rate=mean(first) if first else None,
        loop_pass_rate=mean(final) if final else None,
        avg_iterations=mean(iterations) if iterations else None,
        total_cost_usd=total,
        cost_per_shipped_task=total / shipped
        if total is not None and shipped
        else None,
        first_pass_n=len(first),
        final_pass_n=len(final),
        tickets=measured,
    )


@router.post("/v1/telemetry/latency", response_model=Envelope[Stored])
async def store_latency(body: LatencyRequest, request: Request):
    db = request.app.state.db
    async with db.tx() as tx:
        current = await tx.fetch_one(
            "SELECT value_json FROM kv WHERE key='latency.samples'"
        )
        rows = json_loads_or(current["value_json"], []) if current else []
        if not isinstance(rows, list):
            rows = []
        samples = (rows + [sample.model_dump() for sample in body.samples])[-500:]
        await tx.execute(
            "INSERT INTO kv(key,value_json,updated_at) VALUES('latency.samples',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
            (json_dumps(samples, db.settings), utc_now()),
        )
    return {"data": {"stored": len(body.samples)}}


@router.get("/v1/evals/latest", response_model=Envelope[LatestEvals])
async def evals_latest(request: Request):
    return {"data": await latest_evals(request.app.state.db)}


@router.get("/v1/ventures/{vid}/metrics", response_model=Envelope[Metrics])
async def metrics(vid: str, request: Request):
    db = request.app.state.db
    venture = await get_row(db, "ventures", vid)
    evaluations = await latest_evals(db)
    world = await db.fetch_one(
        "SELECT id,status,final_score FROM worldgen_runs ORDER BY started_at DESC,id DESC LIMIT 1"
    )
    return {
        "data": Metrics(
            engineering=await engineering_metrics(db, vid),
            grounding=grounding_metrics(evaluations.grounding),
            world=WorldMetrics(
                final_score=number(world["final_score"]) if world else None,
                run_id=world["id"] if world else None,
                status=world["status"] if world else None,
            ),
            costs=CostMetrics(
                spent_usd=venture["spent_usd"],
                budget_usd=venture["budget_usd"],
                by_department=await db.fetch_all(
                    "SELECT department_id,SUM(cost_usd) AS cost_usd FROM ledger WHERE venture_id=? GROUP BY department_id ORDER BY department_id",
                    (vid,),
                ),
                by_model=await db.fetch_all(
                    "SELECT model,SUM(cost_usd) AS cost_usd FROM ledger WHERE venture_id=? GROUP BY model ORDER BY model",
                    (vid,),
                ),
            ),
            latency=await latency_metrics(db),
        )
    }
