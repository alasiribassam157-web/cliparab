"""ASGI entrypoint: ``uvicorn app.main:app``."""

from __future__ import annotations

import logging
import os

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from .config import Settings
from .routes import Ctx, build_routes


def create_app(settings: Settings | None = None) -> Starlette:
    settings = settings or Settings()
    ctx = Ctx(settings)
    app = Starlette(
        routes=build_routes(ctx),
        middleware=[Middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
                               allow_headers=["*"], expose_headers=["ETag", "X-Request-ID", "Retry-After"])],
    )
    app.state.ctx = ctx
    return app


def run() -> None:  # pragma: no cover
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run("app.main:app", host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8000")), factory=False)


def __getattr__(name: str):  # lazy module-level ``app`` so imports in tests don't touch the disk
    if name == "app":
        global app
        app = create_app()
        return app
    raise AttributeError(name)
