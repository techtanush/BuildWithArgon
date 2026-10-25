# OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

"""Shared fixtures. Personal fixtures go in tests/<yourname>/ (conftest.py there is yours)."""
from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from foundry_kernel.app import create_app
from foundry_kernel.config import Settings
from foundry_kernel.db import Database
from foundry_kernel.seed import seed_roster


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(_env_file=None, data_dir=tmp_path / "data", web_public_dir=tmp_path / "public",
                    llm_mode="fake", cua_mode="off", scheduler_tick_seconds=0.05)


@pytest.fixture
async def db(settings: Settings) -> AsyncIterator[Database]:
    database = Database(settings.db_path)
    await database.connect()
    await seed_roster(database, settings)
    yield database
    await database.close()


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as c:
        yield c
