"""Pydantic models shared by the sync API. Mirrors shared/schemas/sync.schema.json."""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

SyncKind = Literal["folder", "notebook", "page", "stroke", "text", "image", "asset"]
SYNC_KINDS: tuple[str, ...] = (
    "folder",
    "notebook",
    "page",
    "stroke",
    "text",
    "image",
    "asset",
)

MAX_RECORD_BYTES = 3 * 1024 * 1024


class SyncRecord(BaseModel):
    kind: SyncKind
    id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    data: dict[str, Any]
    createdAt: int = Field(ge=0)
    updatedAt: int = Field(ge=0)
    version: int = Field(ge=0, le=10_000_000)
    deviceId: str = Field(default="", max_length=128)
    deletedAt: int | None = None

    @field_validator("data")
    @classmethod
    def data_is_bounded(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value)) > MAX_RECORD_BYTES:
            raise ValueError("record payload exceeds 3 MiB")
        return value


class PushRequest(BaseModel):
    deviceId: str = Field(min_length=1, max_length=128)
    records: list[SyncRecord] = Field(default_factory=list, max_length=500)


class AcceptedRecord(BaseModel):
    kind: SyncKind
    id: str
    version: int
    updatedAt: int


class PushConflict(BaseModel):
    kind: SyncKind
    id: str
    server: SyncRecord
    client: SyncRecord


class PushResponse(BaseModel):
    accepted: list[AcceptedRecord]
    conflicts: list[PushConflict]
    cursor: int
    serverTime: int


class ChangesResponse(BaseModel):
    records: list[SyncRecord]
    cursor: int
    hasMore: bool


class HealthResponse(BaseModel):
    ok: bool
    name: str
    version: int
    deviceName: str
    time: int


class BackupInfo(BaseModel):
    name: str
    size: int
    createdAt: int


class ImportResult(BaseModel):
    ok: bool
    inserted: int
    updated: int
    skipped: int
    assets: int
    errors: list[str]
