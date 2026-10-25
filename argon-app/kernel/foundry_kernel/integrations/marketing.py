# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.
"""Later: marketing video providers (Higgsfield / Gemini Omni Flash). Interface only in this build —
02-models-and-integrations/08-optional-integrations.md. Every output would be gated by `outreach`."""
from __future__ import annotations

from typing import Protocol

PLANNED = "planned: see architecture-files/02-models-and-integrations/08"


class MarketingVideoProvider(Protocol):
    async def generate_video(self, *, venture_id: str, brief: str, duration_s: int = 15) -> str:
        """Returns a local path to the generated video."""
        ...


def get_provider(name: str = "omni") -> MarketingVideoProvider:
    raise NotImplementedError(PLANNED)


async def generate_marketing_video(venture_id: str, brief: str, duration_s: int = 15) -> str:
    raise NotImplementedError(PLANNED)
