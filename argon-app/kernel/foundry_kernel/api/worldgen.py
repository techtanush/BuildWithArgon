# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.
"""World Lab API — architecture-files/05-world/13-world-lab-and-live-round.md §3.
Run history (`/v1/world/worldgen/latest|runs|files`) and the live one-building round
(`/v1/world/worldgen/live-rounds`). Response models: contracts.WorldgenRunSummary, WorldgenRun, LiveRound.
Seed: empty router."""
from fastapi import APIRouter

router = APIRouter(tags=["worldgen"])
