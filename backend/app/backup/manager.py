"""ZIP backups with a checksummed manifest, plus rotation and validation."""

from __future__ import annotations

import hashlib
import io
import json
import re
import time
import zipfile
from pathlib import Path
from typing import Any

from ..config import Settings, settings as global_settings
from ..database.db import connection
from ..models.schemas import SYNC_KINDS

FORMAT = "thoth-backup"
VERSION = 1
APP_VERSION = "1.0.0"

KIND_FILES: dict[str, str] = {
    "folder": "folders.json",
    "notebook": "notebooks.json",
    "page": "pages.json",
    "stroke": "strokes.json",
    "text": "texts.json",
    "image": "images.json",
    "asset": "assets.json",
}

NAME_PATTERN = re.compile(r"^thoth-[0-9T\-]+\.zip$")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _extension_for(mime: str, filename: str) -> str:
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
        if re.fullmatch(r"[a-z0-9]{1,8}", ext):
            return ext
    return {
        "application/pdf": "pdf",
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/heic": "heic",
    }.get(mime, "bin")


def _collect(cfg: Settings) -> tuple[dict[str, bytes], dict[str, int]]:
    files: dict[str, bytes] = {}
    counts: dict[str, int] = {}
    with connection(cfg) as conn:
        for kind, name in KIND_FILES.items():
            rows = conn.execute(
                "SELECT data FROM objects WHERE kind = ? ORDER BY seq ASC", (kind,)
            ).fetchall()
            payload = json.dumps([json.loads(row["data"]) for row in rows], separators=(",", ":"))
            files[name] = payload.encode("utf-8")
            counts[kind] = len(rows)

        asset_rows = conn.execute("SELECT * FROM asset_files ORDER BY id ASC").fetchall()
        index: list[dict[str, str]] = []
        for row in asset_rows:
            path = cfg.blob_dir / row["id"]
            if not path.exists():
                continue
            ext = _extension_for(row["mime"], row["filename"])
            entry = f"assets/{row['id']}.{ext}"
            files[entry] = path.read_bytes()
            index.append({"id": row["id"], "file": entry})
        files["asset-files.json"] = json.dumps(index, separators=(",", ":")).encode("utf-8")

        conflicts = conn.execute("SELECT * FROM conflicts ORDER BY id ASC").fetchall()
        files["conflicts.json"] = json.dumps(
            [
                {
                    "kind": row["kind"],
                    "objectId": row["object_id"],
                    "label": row["label"],
                    "local": json.loads(row["local"]),
                    "server": json.loads(row["server"]),
                    "createdAt": row["created_at"],
                }
                for row in conflicts
            ],
            separators=(",", ":"),
        ).encode("utf-8")

        meta = {row["key"]: row["value"] for row in conn.execute("SELECT * FROM meta").fetchall()}
        files["settings.json"] = json.dumps({"server": meta}, separators=(",", ":")).encode("utf-8")

    checksums = {name: _sha256(payload) for name, payload in files.items()}
    manifest = {
        "format": FORMAT,
        "version": VERSION,
        "appVersion": APP_VERSION,
        "createdAt": int(time.time() * 1000),
        "counts": counts,
        "checksums": checksums,
    }
    files["manifest.json"] = json.dumps(manifest, indent=2).encode("utf-8")
    return files, counts


def create_backup(cfg: Settings | None = None, reason: str = "manual") -> dict[str, Any]:
    config = cfg or global_settings
    files, counts = _collect(config)
    stamp = time.strftime("%Y-%m-%dT%H-%M-%S", time.localtime())
    millis = int(time.time() * 1000) % 1000
    name = f"thoth-{stamp}-{millis:03d}.zip"
    target = config.backup_dir / name
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for filename, payload in files.items():
            archive.writestr(filename, payload)
    rotate(config)
    return {
        "name": name,
        "size": target.stat().st_size,
        "createdAt": int(time.time() * 1000),
        "reason": reason,
        "counts": counts,
    }


def rotate(cfg: Settings | None = None) -> list[str]:
    config = cfg or global_settings
    backups = sorted(
        (p for p in config.backup_dir.glob("thoth-*.zip") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    keep = max(1, int(config.rotate_keep))
    removed: list[str] = []
    for path in backups[keep:]:
        try:
            path.unlink()
            removed.append(path.name)
        except OSError:
            continue
    return removed


def list_backups(cfg: Settings | None = None) -> list[dict[str, Any]]:
    config = cfg or global_settings
    entries: list[dict[str, Any]] = []
    for path in sorted(config.backup_dir.glob("thoth-*.zip"), reverse=True):
        stat = path.stat()
        entries.append(
            {
                "name": path.name,
                "size": stat.st_size,
                "createdAt": int(stat.st_mtime * 1000),
            }
        )
    return entries


def backup_path(name: str, cfg: Settings | None = None) -> Path | None:
    config = cfg or global_settings
    if not NAME_PATTERN.match(name):
        return None
    path = config.backup_dir / name
    return path if path.is_file() else None


def export_bytes(cfg: Settings | None = None) -> bytes:
    config = cfg or global_settings
    files, _counts = _collect(config)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for filename, payload in files.items():
            archive.writestr(filename, payload)
    return buffer.getvalue()


def import_bytes(cfg: Settings | None = None, payload: bytes = b"") -> dict[str, Any]:
    config = cfg or global_settings
    errors: list[str] = []
    inserted = updated = skipped = asset_count = 0

    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile:
        return {
            "ok": False,
            "inserted": 0,
            "updated": 0,
            "skipped": 0,
            "assets": 0,
            "errors": ["File is not a valid ZIP archive"],
        }

    with archive:
        names = set(archive.namelist())
        if "manifest.json" not in names:
            return {
                "ok": False,
                "inserted": 0,
                "updated": 0,
                "skipped": 0,
                "assets": 0,
                "errors": ["manifest.json is missing"],
            }
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except json.JSONDecodeError:
            return {
                "ok": False,
                "inserted": 0,
                "updated": 0,
                "skipped": 0,
                "assets": 0,
                "errors": ["manifest.json is not valid JSON"],
            }
        if manifest.get("format") != FORMAT:
            errors.append("Unsupported backup format")
        for name, expected in (manifest.get("checksums") or {}).items():
            if name not in names:
                errors.append(f"Missing entry: {name}")
                continue
            if _sha256(archive.read(name)) != expected:
                errors.append(f"Checksum mismatch: {name}")

        if errors:
            return {
                "ok": False,
                "inserted": 0,
                "updated": 0,
                "skipped": 0,
                "assets": 0,
                "errors": errors,
            }

        with connection(config) as conn:
            for kind, name in KIND_FILES.items():
                if name not in names:
                    continue
                try:
                    rows = json.loads(archive.read(name))
                except json.JSONDecodeError:
                    errors.append(f"{name} is not valid JSON")
                    continue
                if not isinstance(rows, list):
                    continue
                for row in rows:
                    if not isinstance(row, dict) or "id" not in row:
                        skipped += 1
                        continue
                    outcome = _merge_backup_row(conn, kind, row)
                    if outcome == "inserted":
                        inserted += 1
                    elif outcome == "updated":
                        updated += 1
                    else:
                        skipped += 1

            if "asset-files.json" in names:
                index = json.loads(archive.read("asset-files.json"))
                for item in index:
                    entry = item.get("file")
                    asset_id = item.get("id")
                    if not entry or not asset_id or entry not in names:
                        skipped += 1
                        continue
                    target = config.blob_dir / asset_id
                    if target.exists():
                        skipped += 1
                        continue
                    target.write_bytes(archive.read(entry))
                    meta = _asset_meta_for(conn, asset_id)
                    if meta is None:
                        conn.execute(
                            "INSERT OR REPLACE INTO asset_files(id, mime, byte_size, sha256, filename)"
                            " VALUES (?, ?, ?, ?, ?)",
                            (
                                asset_id,
                                "application/octet-stream",
                                target.stat().st_size,
                                _sha256(target.read_bytes()),
                                target.name,
                            ),
                        )
                    asset_count += 1

    return {
        "ok": not errors,
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "assets": asset_count,
        "errors": errors,
    }


def _asset_meta_for(conn: Any, asset_id: str) -> Any:
    return conn.execute("SELECT 1 FROM asset_files WHERE id = ?", (asset_id,)).fetchone()


def _merge_backup_row(conn: Any, kind: str, row: dict[str, Any]) -> str:
    object_id = str(row.get("id"))
    updated_at = int(row.get("updatedAt") or 0)
    version = int(row.get("version") or 1)
    device_id = str(row.get("deviceId") or "backup")
    deleted_at = row.get("deletedAt")
    existing = conn.execute(
        "SELECT * FROM objects WHERE kind = ? AND id = ?", (kind, object_id)
    ).fetchone()
    if existing is None:
        from ..database.db import next_seq

        seq = next_seq(conn)
        conn.execute(
            "INSERT INTO objects(kind, id, data, created_at, updated_at, version, device_id, deleted_at, seq)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                kind,
                object_id,
                json.dumps(row),
                int(row.get("createdAt") or updated_at),
                updated_at,
                version,
                device_id,
                deleted_at,
                seq,
            ),
        )
        return "inserted"
    if int(existing["updated_at"]) >= updated_at:
        return "skipped"
    from ..database.db import next_seq

    seq = next_seq(conn)
    conn.execute(
        "UPDATE objects SET data = ?, updated_at = ?, version = ?, device_id = ?,"
        " deleted_at = ?, seq = ? WHERE kind = ? AND id = ?",
        (
            json.dumps(row),
            updated_at,
            version,
            device_id,
            deleted_at,
            seq,
            kind,
            object_id,
        ),
    )
    return "updated"


def count_objects(cfg: Settings | None = None) -> dict[str, int]:
    config = cfg or global_settings
    with connection(config) as conn:
        counts = {kind: 0 for kind in SYNC_KINDS}
        for row in conn.execute(
            "SELECT kind, COUNT(*) AS total FROM objects GROUP BY kind"
        ).fetchall():
            counts[row["kind"]] = int(row["total"])
        return counts
