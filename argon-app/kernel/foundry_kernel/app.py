# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""FastAPI app. Run: uv run uvicorn foundry_kernel.app:app --host 127.0.0.1 --port 8787 --reload"""
from __future__ import annotations

import asyncio
import secrets
import sqlite3
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException

from . import scheduler
from .api import ROUTERS
from .computers import manager as computer_manager
from .config import Settings, get_settings
from .db import Database, redact_value
from .errors import KernelError
from .ids import utc_now
from .integrations import github_watch
from .llm.client import build_llm_client
from .seed import seed_roster


class HealthData(BaseModel):
    status: Literal["ok", "degraded"]
    db: bool
    version: str


class HealthResponse(BaseModel):
    data: HealthData


async def stop_answer_checks(db: Database) -> None:
    tasks = list(getattr(db, "_answer_checks", set()))
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def recover_interrupted(db: Database) -> None:
    """Interrupted work is retriable; attempts remain evidence of prior execution."""
    from .bus import emit
    from .records import get_row, serialize_run, serialize_ticket

    now = utc_now()
    async with db.tx() as tx:
        tickets = await tx.fetch_all("SELECT id, venture_id FROM tickets WHERE status='in_progress'")
        runs = await tx.fetch_all("SELECT id, venture_id FROM runs WHERE status IN ('running','queued')")
        states = await tx.fetch_all("SELECT venture_id, agent_id FROM agent_state WHERE status='working'")
        await tx.execute("UPDATE tickets SET status='open', started_at=NULL, updated_at=? WHERE status='in_progress'", (now,))
        await tx.execute("UPDATE runs SET status='failed', error='kernel restarted', completed_at=? WHERE status IN ('running','queued')", (now,))
        await tx.execute("UPDATE agent_state SET status='idle', current_ticket_id=NULL, last_active_at=? WHERE status='working'", (now,))
        for ticket in tickets:
            await emit(tx, venture_id=ticket["venture_id"], type="ticket.updated", entity_kind="ticket",
                       entity_id=ticket["id"], data=await serialize_ticket(tx, await get_row(tx, "tickets", ticket["id"])))
        for run in runs:
            recovered = serialize_run(await get_row(tx, "runs", run["id"]))
            recovered.pop("output_text", None)
            await emit(tx, venture_id=run["venture_id"], type="run.finished", entity_kind="run",
                       entity_id=run["id"], data=recovered)
        for state in states:
            await emit(tx, venture_id=state["venture_id"], type="agent.status", entity_kind="agent",
                       entity_id=state["agent_id"], data={"agent_id": state["agent_id"], "status": "idle", "current_ticket_id": None})


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        db = Database(cfg.db_path, cfg)
        async with AsyncExitStack() as cleanup:
            cleanup.push_async_callback(db.close)
            await db.connect()
            cleanup.push_async_callback(stop_answer_checks, db)
            app.state.settings = cfg
            app.state.db = db
            app.state.llm = build_llm_client(cfg, db)
            await seed_roster(db, cfg)
            await recover_interrupted(db)
            for hook in (scheduler, github_watch, computer_manager):
                # Register first so a partially started hook also gets cleaned up.
                cleanup.push_async_callback(hook.stop, app)
                await hook.start(app)
            yield

    app = FastAPI(title="Foundry Kernel", version="0.1.0", lifespan=lifespan)

    def error(status: int, code: str, message: str, details: Any = None,
              headers: dict[str, str] | None = None) -> JSONResponse:
        return JSONResponse(status_code=status, headers=headers,
                            content=redact_value({"error": {"code": code, "message": message,
                                                            "details": details or {}}}, cfg))

    @app.middleware("http")
    async def bearer_auth(request: Request, call_next: Any) -> Any:
        if cfg.kernel_token and (request.url.path == "/v1" or request.url.path.startswith("/v1/")):
            authorization = request.headers.get("authorization", "")
            scheme, _, token = authorization.partition(" ")
            expected = cfg.kernel_token.get_secret_value()
            if scheme.lower() != "bearer" or not secrets.compare_digest(token.encode(), expected.encode()):
                return error(401, "unauthorized", "A valid bearer token is required", headers={"WWW-Authenticate": "Bearer"})
        return await call_next(request)

    @app.exception_handler(KernelError)
    async def kernel_error(_: Request, exc: KernelError) -> JSONResponse:
        return error(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        code = {404: "not_found", 409: "conflict", 401: "unauthorized", 403: "forbidden"}.get(exc.status_code, "http_error")
        return error(exc.status_code, code, str(exc.detail), headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Do not reflect submitted inputs (which can contain credentials).
        details = {"errors": [{"loc": list(e["loc"]), "type": e["type"], "message": e["msg"]} for e in exc.errors()]}
        return error(422, "validation_error", "Request does not match the schema", details)

    @app.exception_handler(sqlite3.IntegrityError)
    async def integrity_error(_: Request, exc: sqlite3.IntegrityError) -> JSONResponse:
        duplicate = "UNIQUE constraint failed" in str(exc)
        return error(409 if duplicate else 400, "conflict" if duplicate else "validation_error",
                     "A record with those identifiers already exists" if duplicate else "The request violates a data constraint")

    @app.get("/health", response_model=HealthResponse)
    async def health(request: Request) -> HealthResponse:
        ok = await request.app.state.db.ping()
        return HealthResponse(data=HealthData(status="ok" if ok else "degraded", db=ok, version="0.1.0"))

    for module in ROUTERS:
        app.include_router(module.router)
    return app


app = create_app()
