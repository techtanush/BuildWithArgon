# OWNER: tanush
"""Department roster and live venture work."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

from .. import bus
from ..api_models import Department, DepartmentDetail, Envelope, Page
from ..ids import utc_now
from ..records import (
    get_row,
    serialize_artifact,
    serialize_department,
    serialize_ticket,
    serialize_venture,
)

router = APIRouter(tags=["departments"])


@router.get("/v1/ventures/{vid}/departments", response_model=Envelope[Page[Department]])
async def list_departments(vid: str, request: Request):
    db = request.app.state.db
    await get_row(db, "ventures", vid)
    rows = await db.fetch_all("SELECT * FROM departments ORDER BY sort_order,id")
    return {"data": {"items": [await serialize_department(db, row, vid) for row in rows]}}


@router.get("/v1/ventures/{vid}/departments/{dept}", response_model=Envelope[DepartmentDetail])
async def get_department(vid: str, dept: str, request: Request):
    db = request.app.state.db
    await get_row(db, "ventures", vid)
    result = await serialize_department(db, await get_row(db, "departments", dept), vid)
    result["recent_tickets"] = [await serialize_ticket(db, row) for row in await db.fetch_all("SELECT * FROM tickets WHERE venture_id=? AND department_id=? ORDER BY created_at DESC,id DESC LIMIT 20", (vid, dept))]
    result["recent_artifacts"] = [serialize_artifact(row) for row in await db.fetch_all("SELECT * FROM artifacts WHERE venture_id=? AND department_id=? ORDER BY created_at DESC,id DESC LIMIT 20", (vid, dept))]
    channel = await db.fetch_one("SELECT id FROM channels WHERE venture_id=? AND department_id=?", (vid, dept))
    result["channel_id"] = channel["id"]
    return {"data": result}


class DepartmentResumed(BaseModel):
    department_id: str
    paused: bool


@router.post("/v1/ventures/{vid}/departments/{dept}/resume", response_model=Envelope[DepartmentResumed])
async def resume_department(vid: str, dept: str, request: Request):
    async with request.app.state.db.tx() as tx:
        venture = await get_row(tx, "ventures", vid)
        await get_row(tx, "departments", dept)
        await tx.execute("INSERT INTO kv(key,value_json,updated_at) VALUES(?,'false',?) ON CONFLICT(key) DO UPDATE SET value_json='false',updated_at=excluded.updated_at", (f"dept.paused.{vid}.{dept}", utc_now()))
        await bus.emit(tx, venture_id=vid, type="venture.updated", entity_kind="venture", entity_id=vid, data=serialize_venture(venture))
    return {"data": {"department_id": dept, "paused": False}}
