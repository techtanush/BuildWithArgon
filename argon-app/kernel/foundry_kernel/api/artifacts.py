# OWNER: tanush
"""Artifact inspection and filtering."""
from fastapi import APIRouter, Query, Request

from ..api_models import Artifact, Envelope, Page
from ..records import get_row, list_rows, serialize_artifact

router = APIRouter(tags=["artifacts"])


@router.get("/v1/ventures/{vid}/artifacts", response_model=Envelope[Page[Artifact]])
async def list_artifacts(vid: str, request: Request, department_id: str | None = None, kind: str | None = None, limit: int = Query(50, ge=1, le=200), cursor: str | None = None):
    db = request.app.state.db
    await get_row(db, "ventures", vid)
    rows, cursor = await list_rows(db, "artifacts", venture_id=vid, limit=limit, cursor=cursor, filters={"department_id": department_id, "kind": kind})
    return {"data": {"items": [serialize_artifact(row) for row in rows], "next_cursor": cursor}}


@router.get("/v1/artifacts/{aid}", response_model=Envelope[Artifact])
async def get_artifact(aid: str, request: Request):
    return {"data": serialize_artifact(await get_row(request.app.state.db, "artifacts", aid))}
