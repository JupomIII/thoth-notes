"""Incremental, conflict-aware merge of notebook objects.

Merge rule (deterministic on both devices):
  1. A record wins if its (updatedAt, deviceId) tuple is greater.
  2. The loser is preserved in the `conflicts` table instead of being dropped.
  3. When an incoming record wins, its server timestamp is bumped so it is
     strictly newer than what the server held; clients adopt the returned value.
"""

from __future__ import annotations

import json
import sqlite3
import time
from typing import Any

from ..database.db import current_seq, next_seq, row_to_record
from ..models.schemas import SyncRecord


def _label(kind: str, data: dict[str, Any]) -> str:
    if kind == "notebook":
        return str(data.get("title") or "Notebook")
    if kind == "folder":
        return str(data.get("name") or "Folder")
    if kind == "page":
        title = data.get("title") or ""
        return f"Page {title}".strip()
    if kind == "stroke":
        return f"Stroke ({data.get('tool') or 'ink'})"
    if kind == "text":
        return "Text block"
    if kind == "image":
        return "Image placement"
    return "Attachment"


def _record_conflict(
    conn: sqlite3.Connection,
    kind: str,
    object_id: str,
    label: str,
    local: dict[str, Any],
    server: dict[str, Any],
) -> None:
    """Stores one row per object and decision.

    A push that is retried after a lost response carries the same losing copy
    again; without this check the laptop piles up identical conflicts.
    """
    local_json = json.dumps(local)
    server_json = json.dumps(server)
    exists = conn.execute(
        "SELECT 1 FROM conflicts WHERE kind = ? AND object_id = ? AND local = ? AND server = ?",
        (kind, object_id, local_json, server_json),
    ).fetchone()
    if exists:
        return
    conn.execute(
        "INSERT INTO conflicts(kind, object_id, label, local, server, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (kind, object_id, label, local_json, server_json, int(time.time() * 1000)),
    )


def _conflict_key(updated_at: int, device_id: str) -> tuple[int, str]:
    return (int(updated_at), str(device_id or ""))


def apply_record(conn: sqlite3.Connection, record: SyncRecord) -> tuple[dict[str, Any], str]:
    """Merges one incoming record into the server archive.

    Returns ``(stored_data, outcome)`` where outcome is one of ``inserted``,
    ``updated``, ``identical`` or ``rejected`` (the incoming copy was older, so
    the server keeps its version and the conflict is preserved).
    """
    existing = conn.execute(
        "SELECT * FROM objects WHERE kind = ? AND id = ?",
        (record.kind, record.id),
    ).fetchone()

    incoming_data = dict(record.data)
    incoming_json = json.dumps(incoming_data, sort_keys=True, separators=(",", ":"))

    if existing is None:
        seq = next_seq(conn)
        stored_data = {
            **incoming_data,
            "id": record.id,
            "updatedAt": record.updatedAt,
            "version": max(1, record.version),
            "deviceId": record.deviceId,
            "deletedAt": record.deletedAt,
        }
        conn.execute(
            "INSERT INTO objects(kind, id, data, created_at, updated_at, version, device_id, deleted_at, seq)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                record.kind,
                record.id,
                json.dumps(stored_data),
                record.createdAt,
                record.updatedAt,
                max(1, record.version),
                record.deviceId,
                record.deletedAt,
                seq,
            ),
        )
        return stored_data, "inserted"

    existing_data = json.loads(existing["data"])
    existing_json = json.dumps(existing_data, sort_keys=True, separators=(",", ":"))

    if existing_json == incoming_json:
        # Same content: converge on the server's envelope without a new sequence.
        return existing_data, "identical"

    incoming_wins = _conflict_key(record.updatedAt, record.deviceId) > _conflict_key(
        existing["updated_at"], existing["device_id"]
    )

    if not incoming_wins:
        _record_conflict(
            conn,
            record.kind,
            record.id,
            _label(record.kind, incoming_data),
            incoming_data,
            existing_data,
        )
        return existing_data, "rejected"

    # No conflict row here on purpose: this is an ordinary newer write, and the
    # losing device still has its copy in its own queue. It will be rejected when
    # it arrives, which is where the disagreement is recorded once. Recording the
    # superseded copy here filled the conflict list with every routine edit.
    updated_at = max(record.updatedAt, int(existing["updated_at"]) + 1)
    version = int(existing["version"]) + 1
    seq = next_seq(conn)
    stored_data = {
        **incoming_data,
        "id": record.id,
        "updatedAt": updated_at,
        "version": version,
        "deviceId": record.deviceId,
        "deletedAt": record.deletedAt,
    }
    conn.execute(
        "UPDATE objects SET data = ?, updated_at = ?, version = ?, device_id = ?,"
        " deleted_at = ?, seq = ? WHERE kind = ? AND id = ?",
        (
            json.dumps(stored_data),
            updated_at,
            version,
            record.deviceId,
            record.deletedAt,
            seq,
            record.kind,
            record.id,
        ),
    )
    return stored_data, "updated"


def push(
    conn: sqlite3.Connection, records: list[SyncRecord]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    accepted: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []

    for record in records:
        _stored, outcome = apply_record(conn, record)
        after = conn.execute(
            "SELECT * FROM objects WHERE kind = ? AND id = ?",
            (record.kind, record.id),
        ).fetchone()
        if after is None:
            continue
        if outcome == "rejected":
            # Incoming lost the merge: report as a conflict for the client.
            conflicts.append(
                {
                    "kind": record.kind,
                    "id": record.id,
                    "server": row_to_record(after),
                    "client": record.model_dump(by_alias=False),
                }
            )
            continue
        accepted.append(
            {
                "kind": after["kind"],
                "id": after["id"],
                "version": after["version"],
                "updatedAt": after["updated_at"],
            }
        )

    return accepted, conflicts, current_seq(conn)


def changes(conn: sqlite3.Connection, since: int, limit: int) -> tuple[list[dict[str, Any]], int, bool]:
    limit = max(1, min(2000, limit))
    rows = conn.execute(
        "SELECT * FROM objects WHERE seq > ? ORDER BY seq ASC LIMIT ?",
        (since, limit + 1),
    ).fetchall()
    has_more = len(rows) > limit
    trimmed = rows[:limit]
    cursor = int(trimmed[-1]["seq"]) if trimmed else since
    return [row_to_record(row) for row in trimmed], cursor, has_more
