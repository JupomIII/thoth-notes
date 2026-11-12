"""Attachment storage on the Windows filesystem."""

from __future__ import annotations

import hashlib
import re
import sqlite3
from pathlib import Path

from ..config import Settings, settings as global_settings

SAFE_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def blob_path(asset_id: str, cfg: Settings | None = None) -> Path:
    config = cfg or global_settings
    if not SAFE_ID.match(asset_id):
        raise ValueError("invalid asset id")
    return config.blob_dir / asset_id


def save_asset(
    conn: sqlite3.Connection,
    asset_id: str,
    payload: bytes,
    mime: str,
    filename: str = "",
    cfg: Settings | None = None,
) -> dict[str, object]:
    config = cfg or global_settings
    digest = hashlib.sha256(payload).hexdigest()
    path = blob_path(asset_id, config)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(payload)
    tmp.replace(path)
    conn.execute(
        "INSERT INTO asset_files(id, mime, byte_size, sha256, filename) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, byte_size = excluded.byte_size,"
        " sha256 = excluded.sha256, filename = excluded.filename",
        (asset_id, mime, len(payload), digest, filename),
    )
    return {
        "id": asset_id,
        "mime": mime,
        "byteSize": len(payload),
        "sha256": digest,
        "filename": filename or path.name,
    }


def asset_metadata(conn: sqlite3.Connection, asset_id: str) -> dict[str, object] | None:
    row = conn.execute("SELECT * FROM asset_files WHERE id = ?", (asset_id,)).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "mime": row["mime"],
        "byteSize": row["byte_size"],
        "sha256": row["sha256"],
        "filename": row["filename"],
    }


def asset_exists(asset_id: str, cfg: Settings | None = None) -> bool:
    try:
        return blob_path(asset_id, cfg).exists()
    except ValueError:
        return False
