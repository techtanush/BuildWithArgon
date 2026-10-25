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


@router.get("/v1/ventures/{vid}/marketing/{digest}.pdf")
async def marketing_pdf(vid: str, digest: str, request: Request):
    """Serve only a PDF attached to a persisted artifact of this venture."""
    import hashlib
    import re
    from pathlib import Path
    from fastapi.responses import Response
    from ..errors import NotFoundError
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise NotFoundError("marketing PDF", digest)
    uri = f"/v1/ventures/{vid}/marketing/{digest}.pdf"
    row = await request.app.state.db.fetch_one("SELECT id FROM artifacts WHERE venture_id=? AND uri=?", (vid, uri))
    if row is None:
        raise NotFoundError("marketing PDF", digest)
    root = (Path(request.app.state.settings.data_dir) / "marketing-pdfs").resolve()
    file = root / (digest + ".pdf")
    if not file.is_file() or file.is_symlink():
        raise NotFoundError("marketing PDF", digest)
    data = file.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise NotFoundError("marketing PDF", digest)
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="marketing-plan.pdf"', "X-Content-Type-Options": "nosniff"})
