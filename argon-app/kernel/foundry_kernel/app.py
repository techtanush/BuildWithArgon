# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""FastAPI app. Run: uv run uvicorn foundry_kernel.app:app --host 127.0.0.1 --port 8787 --reload"""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import scheduler
from .api import ROUTERS
from .computers import manager as computer_manager
from .config import Settings, get_settings
from .db import Database
from .errors import KernelError
from .integrations import github_watch
from .llm.client import build_llm_client
from .seed import seed_roster


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        db = Database(cfg.db_path)
        await db.connect()
        app.state.settings = cfg
        app.state.db = db
        app.state.llm = build_llm_client(cfg, db)
        await seed_roster(db, cfg)
        await scheduler.start(app)
        await github_watch.start(app)
        await computer_manager.start(app)
        try:
            yield
        finally:
            await computer_manager.stop(app)
            await github_watch.stop(app)
            await scheduler.stop(app)
            await db.close()

    app = FastAPI(title="Foundry Kernel", version="0.1.0", lifespan=lifespan)

    @app.exception_handler(KernelError)
    async def kernel_error(_: Request, exc: KernelError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code,
                            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}})

    @app.get("/health")
    async def health(request: Request) -> dict[str, object]:
        ok = await request.app.state.db.ping()
        return {"data": {"status": "ok" if ok else "degraded", "db": ok, "version": "0.1.0"}}

    for module in ROUTERS:
        app.include_router(module.router)
    return app


app = create_app()
