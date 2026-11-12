"""REST surface: sync, assets, backups, diagnostics."""

from __future__ import annotations

import re
import socket
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from .. import PROTOCOL_VERSION
from ..backup import manager as backups
from ..config import settings
from ..database.db import connection
from ..models.schemas import (
    BackupInfo,
    ChangesResponse,
    HealthResponse,
    ImportResult,
    PairRequest,
    PairResponse,
    PushRequest,
    PushResponse,
)
from .. import pairing
from ..services import assets as asset_store
from ..sync import engine

router = APIRouter(prefix="/api")

ASSET_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        ok=True,
        name="thoth-notes-server",
        version=PROTOCOL_VERSION,
        deviceName=socket.gethostname(),
        time=int(time.time() * 1000),
    )


@router.post("/pair", response_model=PairResponse)
def pair(payload: PairRequest, request: Request) -> PairResponse:
    """Exchanges a short-lived code for the pairing token, on the LAN only."""
    client = request.client.host if request.client else "unknown"
    if not pairing.allow_attempt(client):
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Run scripts\\pair.ps1 on the laptop for a new code.",
        )
    if not pairing.verify(settings, payload.code):
        pairing.record_failure(client)
        raise HTTPException(
            status_code=401,
            detail="That pairing code has expired. Run scripts\\pair.ps1 on the laptop for a new one.",
        )
    pairing.reset_failures(client)
    return PairResponse(
        token=settings.read_token(),
        serverUrl=settings.base_url,
        deviceName=socket.gethostname(),
    )


@router.get("/status")
def status() -> dict:
    with connection() as conn:
        counts = {
            row["kind"]: int(row["total"])
            for row in conn.execute(
                "SELECT kind, COUNT(*) AS total FROM objects GROUP BY kind"
            ).fetchall()
        }
        conflicts = conn.execute("SELECT COUNT(*) AS total FROM conflicts").fetchone()["total"]
        cursor = conn.execute("SELECT value FROM counters WHERE name = 'seq'").fetchone()["value"]
        devices = [
            row["device_id"]
            for row in conn.execute(
                "SELECT DISTINCT device_id FROM objects WHERE device_id != ''"
            ).fetchall()
        ]
    return {
        "deviceName": socket.gethostname(),
        "counts": counts,
        "conflicts": int(conflicts),
        "cursor": int(cursor),
        "devices": devices,
        "dataDir": str(settings.directory),
        "tls": settings.cert_file.exists(),
        "baseUrl": settings.base_url,
    }


@router.post("/sync/push", response_model=PushResponse)
def sync_push(payload: PushRequest) -> PushResponse:
    with connection() as conn:
        accepted, conflicts, cursor = engine.push(conn, payload.records)
    return PushResponse(
        accepted=accepted,
        conflicts=conflicts,
        cursor=cursor,
        serverTime=int(time.time() * 1000),
    )


@router.get("/sync/changes", response_model=ChangesResponse)
def sync_changes(since: int = 0, limit: int = 400) -> ChangesResponse:
    if since < 0:
        raise HTTPException(status_code=400, detail="since must be >= 0")
    with connection() as conn:
        records, cursor, has_more = engine.changes(conn, since, limit)
    return ChangesResponse(records=records, cursor=cursor, hasMore=has_more)


@router.put("/sync/assets/{asset_id}")
async def upload_asset(asset_id: str, request: Request) -> dict:
    if not ASSET_ID.match(asset_id):
        raise HTTPException(status_code=400, detail="invalid asset id")
    payload = await request.body()
    if len(payload) == 0:
        raise HTTPException(status_code=400, detail="empty asset")
    if len(payload) > settings.max_asset_bytes:
        raise HTTPException(status_code=413, detail="asset too large")
    mime = request.headers.get("content-type", "application/octet-stream")
    filename = request.headers.get("x-asset-name", "")
    with connection() as conn:
        meta = asset_store.save_asset(conn, asset_id, payload, mime, filename)
    return {"ok": True, **meta}


@router.get("/sync/assets/{asset_id}")
def download_asset(asset_id: str) -> FileResponse:
    if not ASSET_ID.match(asset_id):
        raise HTTPException(status_code=400, detail="invalid asset id")
    with connection() as conn:
        meta = asset_store.asset_metadata(conn, asset_id)
    path = asset_store.blob_path(asset_id)
    if meta is None or not path.exists():
        raise HTTPException(status_code=404, detail="asset not found")
    return FileResponse(
        path,
        media_type=str(meta["mime"]),
        filename=str(meta["filename"] or path.name),
    )


@router.post("/backup/create", response_model=BackupInfo)
def create_backup() -> BackupInfo:
    info = backups.create_backup(reason="api")
    return BackupInfo(name=info["name"], size=info["size"], createdAt=info["createdAt"])


@router.get("/backup/list", response_model=list[BackupInfo])
def list_backups() -> list[BackupInfo]:
    return [BackupInfo(**entry) for entry in backups.list_backups()]


@router.get("/backup/export")
def export_backup() -> Response:
    payload = backups.export_bytes()
    stamp = time.strftime("%Y-%m-%dT%H-%M-%S")
    return Response(
        content=payload,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="thoth-{stamp}.zip"',
            "Content-Length": str(len(payload)),
        },
    )


@router.post("/backup/import", response_model=ImportResult)
async def import_backup(request: Request) -> ImportResult:
    payload = await request.body()
    if not payload:
        raise HTTPException(status_code=400, detail="empty backup upload")
    result = backups.import_bytes(payload=payload)
    return ImportResult(**result)


@router.get("/backup/download/{name}")
def download_backup(name: str) -> FileResponse:
    path: Path | None = backups.backup_path(name)
    if path is None:
        raise HTTPException(status_code=404, detail="backup not found")
    return FileResponse(path, media_type="application/zip", filename=name)


@router.get("/conflicts")
def list_conflicts(limit: int = 200) -> dict:
    with connection() as conn:
        rows = conn.execute(
            "SELECT id, kind, object_id, label, created_at FROM conflicts ORDER BY id DESC LIMIT ?",
            (max(1, min(1000, limit)),),
        ).fetchall()
    return {
        "conflicts": [
            {
                "id": row["id"],
                "kind": row["kind"],
                "objectId": row["object_id"],
                "label": row["label"],
                "createdAt": row["created_at"],
            }
            for row in rows
        ]
    }


@router.get("/")
def api_root() -> JSONResponse:
    return JSONResponse(
        {
            "name": "thoth-notes-server",
            "protocol": PROTOCOL_VERSION,
            "docs": "/docs",
            "app": settings.base_url,
        }
    )
