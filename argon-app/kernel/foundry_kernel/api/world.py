# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""GET /v1/world/manifest only (world_layout.build_manifest). Worldgen history + live round live in
ayan's api/worldgen.py. Routes for `world` — see architecture-files/01-architecture/04-api-contract.md. Seed: empty router."""
from fastapi import APIRouter

router = APIRouter(tags=["world"])
