# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.
"""MAY: one-way Slack mirror of group chat via Composio (02-models-and-integrations/11-services-catalog.md).

Honest minimal version: Slack is not in `composio.ALLOWED_TOOLKITS`, so mirroring stays off until a recorded
decision adds it (02-models-and-integrations/08). Callers can always call `mirror_message`; it returns
False (and logs why) whenever it did not post."""
from __future__ import annotations

import logging
from typing import Any

from .composio import ALLOWED_TOOLKITS, ComposioClient, ComposioError

log = logging.getLogger(__name__)

SLACK_SEND_SLUG = "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL"  # VERIFY before enabling
MIRRORED_CHANNELS = {"all-hands", "exec"}


async def mirror_message(settings: Any, db: Any, venture_id: str, channel_slug: str, body: str) -> bool:
    if not settings.slack_mirror_channel or channel_slug not in MIRRORED_CHANNELS:
        return False
    if "slack" not in ALLOWED_TOOLKITS:
        log.info("slack mirror skipped: the slack toolkit is not allowed (needs a recorded decision)")
        return False
    client = ComposioClient(settings)
    venture = await db.fetch_one("SELECT composio_user_id FROM ventures WHERE id = ?", (venture_id,))
    if not client.configured or venture is None:
        return False
    try:
        await client.execute(SLACK_SEND_SLUG, venture["composio_user_id"],
                             {"channel": settings.slack_mirror_channel, "text": f"#{channel_slug}: {body}"[:3000]})
    except ComposioError as exc:
        log.warning("slack mirror failed: %s", exc.user_message)
        return False
    return True
