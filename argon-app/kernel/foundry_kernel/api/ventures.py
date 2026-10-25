# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Venture lifecycle, budget and safe document ingestion."""
from __future__ import annotations

import asyncio
import io
import json
import re
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pypdf import PdfReader

from .. import bus, gates
from ..api_models import Envelope, Page, Venture, VentureDetail
from ..errors import ConflictError, KernelError
from ..ids import new_id, utc_now
from ..records import (
    clean,
    create_ticket,
    cursor_clause,
    get_row,
    json_loads,
    page_rows,
    serialize_venture,
)

router = APIRouter(tags=["ventures"])


class CreateVenture(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    idea: str = Field(min_length=1, max_length=100_000)
    founder_name: str = Field(min_length=1, max_length=200)
    budget_usd: float | None = Field(default=None, ge=0, allow_inf_nan=False)


class VentureStatus(BaseModel):
    status: str


class VentureStarted(VentureStatus):
    brief_ticket_id: str


class UploadedFile(BaseModel):
    id: str
    name: str
    size_bytes: int
    excerpt_chars: int


class DepartmentCost(BaseModel):
    department_id: str | None
    cost_usd: float


class ModelCost(BaseModel):
    model: str | None
    cost_usd: float


class Budget(BaseModel):
    budget_usd: float
    spent_usd: float
    by_department: list[DepartmentCost]
    by_model: list[ModelCost]


@router.post("/v1/ventures", response_model=Envelope[Venture])
async def create(body: CreateVenture, request: Request):
    cfg, db = request.app.state.settings, request.app.state.db
    values = clean(body.model_dump(), cfg)
    if any(not values[key].strip() for key in ("name", "idea", "founder_name")):
        raise KernelError(400, "validation", "Name, idea and founder name must contain text")
    vid, now = new_id("ven"), utc_now()
    stem = re.sub(r"[^a-z0-9]+", "-", values["name"].lower()).strip("-")[:70] or "venture"
    budget = values["budget_usd"] if values["budget_usd"] is not None else cfg.default_budget_usd
    async with db.tx() as tx:
        slug = stem
        if await tx.fetch_one("SELECT id FROM ventures WHERE slug=?", (slug,)):
            slug = f"{stem}-{vid[4:].lower()}"
        await tx.execute("INSERT INTO ventures(id,name,slug,idea,founder_name,budget_usd,composio_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", (vid, values["name"], slug, values["idea"], values["founder_name"], budget, vid, now, now))
        await tx.execute("INSERT INTO agent_state(venture_id,agent_id) SELECT ?,id FROM agents WHERE venture_id IS NULL", (vid,))
        channels = [("all-hands", "All hands", "all_hands", None), ("exec", "Executive", "exec", None), ("incidents", "Incidents", "incident", None)]
        for dept in await tx.fetch_all("SELECT id,name FROM departments ORDER BY sort_order"):
            channels.append((f"dept-{dept['id']}", dept["name"], "department", dept["id"]))
        for slug, name, kind, department_id in channels:
            await tx.execute("INSERT INTO channels(id,venture_id,slug,name,kind,department_id,created_at) VALUES(?,?,?,?,?,?,?)", (new_id("chn"), vid, slug, name, kind, department_id, now))
        await tx.execute("INSERT INTO integrations(id,venture_id,provider,status,created_at,updated_at) VALUES(?,?,'github','not_connected',?,?)", (new_id("int"), vid, now, now))
        result = serialize_venture(await get_row(tx, "ventures", vid))
        await bus.emit(tx, venture_id=vid, type="venture.updated", entity_kind="venture", entity_id=vid, data=result)
    return {"data": result}


@router.get("/v1/ventures", response_model=Envelope[Page[Venture]])
async def list_ventures(request: Request, limit: int = Query(50, ge=1, le=200), cursor: str | None = None):
    clause, params = cursor_clause(cursor)
    rows = await request.app.state.db.fetch_all("SELECT * FROM ventures WHERE 1=1" + clause + " ORDER BY created_at DESC,id DESC LIMIT ?", (*params, limit + 1))
    rows, cursor = page_rows(rows, limit)
    return {"data": {"items": [serialize_venture(r) for r in rows], "next_cursor": cursor}}


@router.get("/v1/ventures/{vid}", response_model=Envelope[VentureDetail])
async def get_venture(vid: str, request: Request):
    db = request.app.state.db
    result = serialize_venture(await get_row(db, "ventures", vid))
    counts = await db.fetch_all("SELECT status,COUNT(*) AS n FROM tickets WHERE venture_id=? GROUP BY status", (vid,))
    pending = await db.fetch_one("SELECT COUNT(*) AS n FROM approvals WHERE venture_id=? AND status='pending'", (vid,))
    artifacts = await db.fetch_one("SELECT COUNT(*) AS n FROM artifacts WHERE venture_id=?", (vid,))
    result["stats"] = {"tickets": {r["status"]: r["n"] for r in counts}, "approvals_pending": pending["n"], "artifacts": artifacts["n"]}
    return {"data": result}


def extract_text(raw: bytes, suffix: str) -> str:
    if suffix == ".pdf":
        try:
            reader = PdfReader(io.BytesIO(raw))
            if reader.is_encrypted:
                raise ValueError("encrypted PDF")
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise KernelError(400, "invalid_file", "PDF could not be read; upload an unencrypted text PDF") from exc
    return raw.decode("utf-8-sig", errors="ignore")


@router.post("/v1/ventures/{vid}/files", response_model=Envelope[Page[UploadedFile]])
async def upload_files(vid: str, request: Request):
    db, cfg = request.app.state.db, request.app.state.settings
    await get_row(db, "ventures", vid)
    async with request.form(max_files=8, max_fields=8, max_part_size=15 * 1024 * 1024) as form:
        uploads = [value for key, value in form.multi_items() if key in ("files[]", "files") and hasattr(value, "read")]
        if not 1 <= len(uploads) <= 8:
            raise KernelError(400, "invalid_files", "Upload between 1 and 8 files")
        prepared = []
        for upload in uploads:
            name = upload.filename or ""
            if not name or Path(name).name != name or "\\" in name or "\x00" in name:
                raise KernelError(400, "invalid_file", "File names must not contain paths")
            suffix = Path(name).suffix.lower()
            if suffix not in (".md", ".txt", ".pdf", ".csv", ".json"):
                raise KernelError(400, "invalid_file", "Supported files: .md .txt .pdf .csv .json")
            raw = await upload.read(15 * 1024 * 1024 + 1)
            if len(raw) > 15 * 1024 * 1024:
                raise KernelError(400, "file_too_large", "Each file must be at most 15 MB")
            text = clean(await asyncio.to_thread(extract_text, raw, suffix), cfg)
            # PDF binaries may hold secret metadata: persist redacted extraction only.
            fid = new_id("fil")
            path = cfg.data_dir / "uploads" / vid / f"{fid}.txt"
            prepared.append((fid, clean(name, cfg), upload.content_type or "application/octet-stream", len(raw), path, text))
    written = []
    try:
        async with db.tx() as tx:
            for fid, name, mime, size, path, text in prepared:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
                written.append(path)
                await tx.execute("INSERT INTO files(id,venture_id,name,mime,size_bytes,path,excerpt,created_at) VALUES(?,?,?,?,?,?,?,?)", (fid, vid, name, mime, size, str(path), text[:12_000], utc_now()))
            await bus.emit(tx, venture_id=vid, type="venture.updated", entity_kind="venture", entity_id=vid, data=serialize_venture(await get_row(tx, "ventures", vid)))
    except BaseException:
        for path in written:
            path.unlink(missing_ok=True)
        raise
    return {"data": {"items": [{"id": f[0], "name": f[1], "size_bytes": f[3], "excerpt_chars": min(len(f[5]), 12_000)} for f in prepared]}}


async def set_status(tx, vid: str, status: str):
    await tx.execute("UPDATE ventures SET status=?,updated_at=? WHERE id=?", (status, utc_now(), vid))
    await bus.emit(tx, venture_id=vid, type="venture.updated", entity_kind="venture", entity_id=vid, data=serialize_venture(await get_row(tx, "ventures", vid)))


@router.post("/v1/ventures/{vid}/start", response_model=Envelope[VentureStarted])
async def start(vid: str, request: Request):
    async with request.app.state.db.tx() as tx:
        venture = await get_row(tx, "ventures", vid)
        if venture["status"] != "draft":
            raise ConflictError("Only a draft venture can be started; use resume for a paused venture")
        ticket = await create_ticket(tx, venture_id=vid, type="brief", department_id="intake", title=f"Brief: {venture['name']}", body=venture["idea"], created_by="system")
        await set_status(tx, vid, "running")
    return {"data": {"status": "running", "brief_ticket_id": ticket["id"]}}


@router.post("/v1/ventures/{vid}/pause", response_model=Envelope[VentureStatus])
async def pause(vid: str, request: Request):
    async with request.app.state.db.tx() as tx:
        venture = await get_row(tx, "ventures", vid)
        if venture["status"] != "running":
            raise ConflictError("Only a running venture can be paused")
        await set_status(tx, vid, "paused")
    return {"data": {"status": "paused"}}


@router.post("/v1/ventures/{vid}/resume", response_model=Envelope[VentureStatus])
async def resume(vid: str, request: Request):
    async with request.app.state.db.tx() as tx:
        venture = await get_row(tx, "ventures", vid)
        if venture["status"] != "paused":
            raise ConflictError("Only a paused venture can be resumed")
        await set_status(tx, vid, "running")
    return {"data": {"status": "running"}}


@router.get("/v1/ventures/{vid}/budget", response_model=Envelope[Budget])
async def budget(vid: str, request: Request):
    db = request.app.state.db
    venture = await get_row(db, "ventures", vid)
    return {"data": {"budget_usd": venture["budget_usd"], "spent_usd": venture["spent_usd"],
                     "by_department": await db.fetch_all("SELECT department_id,SUM(cost_usd) AS cost_usd FROM ledger WHERE venture_id=? GROUP BY department_id ORDER BY department_id", (vid,)),
                     "by_model": await db.fetch_all("SELECT model,SUM(cost_usd) AS cost_usd FROM ledger WHERE venture_id=? GROUP BY model ORDER BY model", (vid,))}}


class VentureSettings(BaseModel):
    founder_name: str
    budget_usd: float
    autopilot_next: bool
    quality_default: Literal["low", "medium", "high"]
    executor: Literal["antigravity", "local"]
    approval_id: str | None = None


class UpdateSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    founder_name: str | None = Field(default=None, min_length=2, max_length=60)
    budget_usd: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    autopilot_next: bool | None = Field(default=None, strict=True)
    quality_default: Literal["low", "medium", "high"] | None = None

    @field_validator("founder_name")
    @classmethod
    def founder_has_name(cls, name):
        if name is not None:
            name = name.strip()
            if len(name) < 2:
                raise ValueError("Founder name must contain at least two non-space characters")
        return name

    @model_validator(mode="after")
    def explicit_values(self):
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Settings values cannot be null")
        return self


async def settings_view(db, venture, cfg):
    saved = json_loads(venture["settings_json"], {})
    override = await db.fetch_one("SELECT value_json FROM kv WHERE key='executor.override'")
    executor = json_loads(override["value_json"], None) if override else None
    pending = await db.fetch_one("SELECT id FROM approvals WHERE venture_id=? AND gate_type='spend' AND status='pending' ORDER BY created_at,id LIMIT 1", (venture["id"],))
    return {"founder_name": venture["founder_name"], "budget_usd": venture["budget_usd"],
            "autopilot_next": saved.get("autopilot_next") is True,
            "quality_default": saved.get("quality_default") if saved.get("quality_default") in ("low", "medium", "high") else "high",
            "executor": executor if executor in ("antigravity", "local") else cfg.engineering_executor,
            "approval_id": pending["id"] if pending else None}


@router.get("/v1/ventures/{vid}/settings", response_model=Envelope[VentureSettings])
async def get_settings(vid: str, request: Request):
    db = request.app.state.db
    return {"data": await settings_view(db, await get_row(db, "ventures", vid), request.app.state.settings)}


@router.post("/v1/ventures/{vid}/settings", response_model=Envelope[VentureSettings])
async def update_settings(vid: str, body: UpdateSettings, request: Request):
    db, cfg = request.app.state.db, request.app.state.settings
    values = clean(body.model_dump(exclude_unset=True), cfg)
    async with db.tx() as tx:
        venture = await get_row(tx, "ventures", vid)
        saved = json_loads(venture["settings_json"], {})
        cap = venture["budget_usd"]
        desired = values.get("budget_usd", cap)
        pending = await tx.fetch_one("SELECT * FROM approvals WHERE venture_id=? AND gate_type='spend' AND status='pending' ORDER BY created_at,id LIMIT 1", (vid,))
        if desired < venture["spent_usd"]:
            raise KernelError(400, "budget_below_spend", "Budget cannot be lower than recorded spend")
        if desired != cap and pending:
            proposed = json_loads(pending["payload_json"], {})
            target = proposed.get("budget_usd", cap) + proposed.get("requested_increase_usd", 0)
            if desired != target:
                raise ConflictError("Decide the pending budget approval before proposing another budget", {"approval_id": pending["id"]})
        elif desired > cap:
            breakdown = await tx.fetch_all("SELECT department_id,SUM(cost_usd) AS cost_usd FROM ledger WHERE venture_id=? GROUP BY department_id", (vid,))
            await gates.request_approval(tx, venture_id=vid, gate_type="spend", title="Raise the venture budget",
                summary=f"Raise the approved spending limit from ${cap:.2f} to ${desired:.2f}.",
                payload={"budget_usd": cap, "spent_usd": venture["spent_usd"], "requested_increase_usd": desired-cap, "breakdown": breakdown}, requested_by_agent_id="fp.cfo")
        elif desired < cap:
            cap = desired
        for field in ("autopilot_next", "quality_default"):
            if field in values:
                saved[field] = values[field]
        await tx.execute("UPDATE ventures SET founder_name=?,budget_usd=?,settings_json=?,updated_at=? WHERE id=?", (values.get("founder_name", venture["founder_name"]), cap, json.dumps(saved), utc_now(), vid))
        updated = await get_row(tx, "ventures", vid)
        await bus.emit(tx, venture_id=vid, type="venture.updated", entity_kind="venture", entity_id=vid, data=serialize_venture(updated))
        result = await settings_view(tx, updated, cfg)
    return {"data": result}
