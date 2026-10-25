# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Cua computer lifecycle. Seed: no-ops."""
from fastapi import FastAPI


async def start(app: FastAPI) -> None:
    """Prepare the Cua client if CUA_MODE != off."""


async def stop(app: FastAPI) -> None:
    """Stop all computers."""
