# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""GET /preview/{vid}/{ticket_id}/{path:path} — built product previews from data/workspaces/{vid}/{ticket_id}/dist/
(01-architecture/04-api-contract.md §Metrics & preview). Path traversal is rejected; an empty path serves index.html."""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from ..errors import NotFoundError

router = APIRouter(tags=["preview"])
ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


def resolve_preview(data_dir: Path, vid: str, ticket_id: str, path: str) -> Path | None:
    if not ID_RE.match(vid) or not ID_RE.match(ticket_id) or "\\" in path or "\x00" in path:
        return None
    root = (Path(data_dir) / "workspaces" / vid / ticket_id / "dist").resolve()
    if not root.is_dir():
        return None
    target = (root / (path or "index.html")).resolve()
    if target != root and root not in target.parents:
        return None
    if target.is_dir():
        target = target / "index.html"
    return target if target.is_file() else None


@router.get("/preview/{vid}/{ticket_id}/{path:path}", include_in_schema=False)
async def preview(vid: str, ticket_id: str, path: str, request: Request) -> FileResponse:
    target = resolve_preview(request.app.state.settings.data_dir, vid, ticket_id, path)
    if target is None:
        raise NotFoundError("preview file", f"{vid}/{ticket_id}/{path}")
    return FileResponse(target)
