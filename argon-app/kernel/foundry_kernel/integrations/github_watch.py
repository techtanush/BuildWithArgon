# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Polls GitHub issues/PR comments -> tickets. Seed: start/stop are no-ops."""
from fastapi import FastAPI


async def start(app: FastAPI) -> None:
    """Start polling when Composio + a venture repo exist."""


async def stop(app: FastAPI) -> None:
    """Stop polling."""
