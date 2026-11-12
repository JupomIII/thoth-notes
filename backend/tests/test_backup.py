"""Backup integrity, rotation and restore behaviour."""

from __future__ import annotations

import io
import json
import uuid
import zipfile

from app.backup import manager


def _record(title: str) -> dict:
    object_id = str(uuid.uuid4())
    return {
        "kind": "notebook",
        "id": object_id,
        "data": {
            "id": object_id,
            "title": title,
            "folderId": None,
            "coverColor": "#4a6156",
            "favorite": False,
            "archived": False,
            "sortIndex": 1,
            "lastOpenedAt": None,
            "createdAt": 10,
            "updatedAt": 20,
            "version": 1,
            "deviceId": "device-a",
            "deletedAt": None,
        },
        "createdAt": 10,
        "updatedAt": 20,
        "version": 1,
        "deviceId": "device-a",
        "deletedAt": None,
    }


def test_backup_export_import_roundtrip(client):
    record = _record("Backup me")
    client.post("/api/sync/push", json={"deviceId": "device-a", "records": [record]}).raise_for_status()

    created = client.post("/api/backup/create")
    assert created.status_code == 200
    name = created.json()["name"]

    archive_bytes = client.get("/api/backup/download/" + name)
    assert archive_bytes.status_code == 200

    with zipfile.ZipFile(io.BytesIO(archive_bytes.content)) as archive:
        names = set(archive.namelist())
        assert "manifest.json" in names
        assert "notebooks.json" in names
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["format"] == "thoth-backup"
        assert manifest["counts"]["notebook"] >= 1
        assert "notebooks.json" in manifest["checksums"]
        # Backup rows are full entities, identical to sync payload data.
        titles = [row["title"] for row in json.loads(archive.read("notebooks.json"))]
        assert "Backup me" in titles

    # Re-importing the same archive must not duplicate rows.
    imported = client.post(
        "/api/backup/import",
        content=archive_bytes.content,
        headers={"Content-Type": "application/zip"},
    )
    assert imported.status_code == 200
    result = imported.json()
    assert result["ok"] is True
    assert result["inserted"] == 0
    assert result["updated"] == 0


def test_corrupted_backup_is_rejected(client):
    exported = client.get("/api/backup/export")
    assert exported.status_code == 200

    source = zipfile.ZipFile(io.BytesIO(exported.content))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as tampered:
        for item in source.infolist():
            payload = source.read(item.filename)
            if item.filename == "notebooks.json":
                payload = payload.replace(b"Backup me", b"Tampered")
            tampered.writestr(item.filename, payload)

    response = client.post(
        "/api/backup/import",
        content=buffer.getvalue(),
        headers={"Content-Type": "application/zip"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert any("Checksum mismatch" in error for error in body["errors"])


def test_rotation_keeps_newest(client):
    for _ in range(6):
        client.post("/api/backup/create")
    listing = client.get("/api/backup/list").json()
    assert len(listing) <= manager.global_settings.rotate_keep
    assert listing, "at least one backup should remain"


def test_invalid_zip_rejected(client):
    response = client.post(
        "/api/backup/import", content=b"not a zip", headers={"Content-Type": "application/zip"}
    )
    assert response.status_code == 200
    assert response.json()["ok"] is False
