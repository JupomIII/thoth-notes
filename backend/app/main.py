"""FastAPI application factory and Uvicorn entry point."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import PROTOCOL_VERSION
from .api.routes import router
from .backup import manager as backups
from .config import BACKEND_DIR, Settings, settings, local_ip
from .console import enable_utf8_output
from . import pairing
from .pair_page import render_pair_page
from .database.db import init_db
from .security import LocalNetworkMiddleware, is_self_client

log = logging.getLogger("thoth")

FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"


async def _auto_backup_loop(config: Settings) -> None:
    interval = max(1, int(config.auto_backup_hours)) * 3600
    while True:
        try:
            backups.create_backup(config, reason="automatic")
            log.info("Automatic backup written to %s", config.backup_dir)
        except Exception as exc:  # noqa: BLE001 - backups must never crash the server
            log.warning("Automatic backup failed: %s", exc)
        await asyncio.sleep(interval)


def create_app(config: Settings | None = None) -> FastAPI:
    cfg = config or settings

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        init_db(cfg)
        cfg.ensure_token()
        cfg.save()
        task = asyncio.create_task(_auto_backup_loop(cfg))
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(
        title="Thoth Notes local server",
        version=str(PROTOCOL_VERSION),
        description="Offline-first notebook sync for one iPad and one Windows laptop.",
        lifespan=lifespan,
    )

    app.add_middleware(
        LocalNetworkMiddleware,
        token_provider=cfg.read_token,
        config=cfg,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.allowed_origins or [],
        allow_origin_regex=cfg.allow_origin_regex or None,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["X-Thoth-Token", "Content-Type", "X-Asset-Name"],
        expose_headers=["Content-Disposition"],
        max_age=600,
    )

    app.include_router(router)

    @app.get("/pair", include_in_schema=False)
    def pair_page(request: Request) -> HTMLResponse:
        host = request.client.host if request.client else None
        if not is_self_client(host):
            return HTMLResponse(
                "<h1>Pairing is only available on the laptop itself.</h1>",
                status_code=403,
            )
        return HTMLResponse(render_pair_page(cfg))

    @app.get("/ca", include_in_schema=False)
    def ca_profile() -> Response:
        if not cfg.ca_file.exists():
            return JSONResponse({"detail": "certificate not generated yet"}, status_code=404)
        return FileResponse(
            cfg.ca_file,
            media_type="application/x-x509-ca-cert",
            filename="thoth-rootCA.cer",
        )

    if FRONTEND_DIST.exists():
        assets_dir = FRONTEND_DIST / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str) -> FileResponse:
            candidate = (FRONTEND_DIST / path).resolve()
            if (
                path
                and candidate.is_file()
                and FRONTEND_DIST.resolve() in candidate.parents
            ):
                return FileResponse(candidate)
            return FileResponse(FRONTEND_DIST / "index.html")

    return app


app = create_app()


def run() -> None:
    """Starts Uvicorn with TLS when the certificate pair exists."""
    import uvicorn

    enable_utf8_output()
    cfg = settings
    init_db(cfg)
    cfg.ensure_token()
    use_tls = cfg.cert_file.exists() and cfg.key_file.exists()

    print()
    print("  Thoth Notes local server")
    print(f"  Data directory : {cfg.directory}")
    print(f"  iPad address   : {cfg.base_url}/")
    print(f"  LAN IP         : {local_ip()}:{cfg.port}")
    print(f"  Pairing code   : {pairing.current_code(cfg)}   (changes every {cfg.pair_code_minutes} min)")
    scheme = "https" if use_tls else "http"
    print(f"  Pairing page   : {scheme}://localhost:{cfg.port}/pair   (open on the laptop)")
    print("  Token          : stored locally in storage\\pairing-token.txt, never printed")
    if not use_tls:
        print("  WARNING: no TLS certificate found. Installed iPad PWAs cannot call http:// endpoints.")
        print("           Run scripts\\install-windows.ps1 once to generate a trusted local certificate.")
    if FRONTEND_DIST.exists():
        print("  Served app     : bundled frontend at /")
    print()

    uvicorn.run(
        "app.main:app",
        host=cfg.host,
        port=cfg.port,
        log_level="info",
        ssl_certfile=str(cfg.cert_file) if use_tls else None,
        ssl_keyfile=str(cfg.key_file) if use_tls else None,
    )


if __name__ == "__main__":
    run()
