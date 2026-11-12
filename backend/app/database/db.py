"""SQLite access. One connection per request keeps the server dependency-free."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from typing import Any, Iterator

from ..config import Settings, settings as global_settings

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS objects (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    deleted_at INTEGER,
    seq INTEGER NOT NULL,
    PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS idx_objects_seq ON objects(seq);
CREATE INDEX IF NOT EXISTS idx_objects_kind ON objects(kind);

CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    label TEXT NOT NULL,
    local TEXT NOT NULL,
    server TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_files (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    filename TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def connect(cfg: Settings | None = None) -> sqlite3.Connection:
    config = cfg or global_settings
    config.directory.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.db_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=8000")
    return conn


@contextmanager
def connection(cfg: Settings | None = None) -> Iterator[sqlite3.Connection]:
    conn = connect(cfg)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(cfg: Settings | None = None) -> None:
    with connection(cfg) as conn:
        conn.executescript(SCHEMA)
        conn.execute(
            "INSERT OR IGNORE INTO counters(name, value) VALUES('seq', 0)",
        )
        conn.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )


def next_seq(conn: sqlite3.Connection) -> int:
    conn.execute("UPDATE counters SET value = value + 1 WHERE name = 'seq'")
    row = conn.execute("SELECT value FROM counters WHERE name = 'seq'").fetchone()
    return int(row["value"]) if row else 1


def current_seq(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM counters WHERE name = 'seq'").fetchone()
    return int(row["value"]) if row else 0


def row_to_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "kind": row["kind"],
        "id": row["id"],
        "data": json.loads(row["data"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "version": row["version"],
        "deviceId": row["device_id"],
        "deletedAt": row["deleted_at"],
    }
