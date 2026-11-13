"""Sync, conflict and asset behaviour against the real FastAPI app."""

from __future__ import annotations

import uuid


def notebook_record(updated_at: int, device: str, title: str, deleted_at: int | None = None) -> dict:
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
            "createdAt": 1,
            "updatedAt": updated_at,
            "version": 1,
            "deviceId": device,
            "deletedAt": deleted_at,
        },
        "createdAt": 1,
        "updatedAt": updated_at,
        "version": 1,
        "deviceId": device,
        "deletedAt": deleted_at,
    }


def test_requires_token(bare_client):
    response = bare_client.get("/api/status")
    assert response.status_code == 401
    health = bare_client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["ok"] is True


def test_rejects_bad_token(bare_client):
    response = bare_client.get("/api/status", headers={"X-Thoth-Token": "wrong"})
    assert response.status_code == 401


def test_push_and_pull_roundtrip(client):
    record = notebook_record(1_700_000_000_000, "device-a", "Roundtrip")
    push = client.post("/api/sync/push", json={"deviceId": "device-a", "records": [record]})
    assert push.status_code == 200, push.text
    body = push.json()
    assert len(body["accepted"]) == 1
    assert body["conflicts"] == []

    pull = client.get("/api/sync/changes", params={"since": 0, "limit": 500})
    assert pull.status_code == 200
    ids = {item["id"] for item in pull.json()["records"]}
    assert record["id"] in ids

    # Incremental pull from the cursor must not repeat earlier records.
    cursor = pull.json()["cursor"]
    again = client.get("/api/sync/changes", params={"since": cursor}).json()
    assert all(item["id"] != record["id"] for item in again["records"])


def test_older_write_is_preserved_as_conflict(client):
    newer = notebook_record(2_000, "device-a", "Newer title")
    client.post("/api/sync/push", json={"deviceId": "device-a", "records": [newer]}).raise_for_status()

    stale = dict(newer)
    stale["updatedAt"] = 1_000
    stale["data"] = {**newer["data"], "title": "Stale title", "updatedAt": 1_000}
    conflict_response = client.post(
        "/api/sync/push", json={"deviceId": "device-b", "records": [stale]}
    )
    assert conflict_response.status_code == 200
    payload = conflict_response.json()
    assert payload["accepted"] == []
    assert len(payload["conflicts"]) == 1
    assert payload["conflicts"][0]["server"]["data"]["title"] == "Newer title"
    assert payload["conflicts"][0]["client"]["data"]["title"] == "Stale title"

    pull = client.get("/api/sync/changes", params={"since": 0, "limit": 5000}).json()
    stored = next(item for item in pull["records"] if item["id"] == newer["id"])
    assert stored["data"]["title"] == "Newer title"


def test_newer_write_wins_and_bumps_sequence(client):
    first = notebook_record(3_000, "device-a", "First")
    client.post("/api/sync/push", json={"deviceId": "device-a", "records": [first]}).raise_for_status()
    cursor = client.get("/api/sync/changes", params={"since": 0, "limit": 5000}).json()["cursor"]

    second = {**first, "updatedAt": 4_000, "data": {**first["data"], "title": "Second", "updatedAt": 4_000}}
    response = client.post("/api/sync/push", json={"deviceId": "device-b", "records": [second]})
    assert response.status_code == 200
    accepted = response.json()["accepted"]
    assert len(accepted) == 1
    assert accepted[0]["updatedAt"] >= 4_000

    changes = client.get("/api/sync/changes", params={"since": cursor}).json()
    updated = next(item for item in changes["records"] if item["id"] == first["id"])
    assert updated["data"]["title"] == "Second"


def test_tombstone_propagates(client):
    record = notebook_record(5_000, "device-a", "Delete me")
    client.post("/api/sync/push", json={"deviceId": "device-a", "records": [record]}).raise_for_status()

    tombstone = {
        **record,
        "updatedAt": 6_000,
        "deletedAt": 6_000,
        "data": {**record["data"], "updatedAt": 6_000, "deletedAt": 6_000},
    }
    client.post("/api/sync/push", json={"deviceId": "device-a", "records": [tombstone]}).raise_for_status()

    changes = client.get("/api/sync/changes", params={"since": 0, "limit": 5000}).json()
    stored = next(item for item in changes["records"] if item["id"] == record["id"])
    assert stored["deletedAt"] == 6_000


def test_asset_upload_and_download(client):
    asset_id = str(uuid.uuid4())
    payload = b"%PDF-1.4 thoth test asset"
    upload = client.put(
        f"/api/sync/assets/{asset_id}",
        content=payload,
        headers={"Content-Type": "application/pdf"},
    )
    assert upload.status_code == 200, upload.text
    download = client.get(f"/api/sync/assets/{asset_id}")
    assert download.status_code == 200
    assert download.content == payload


def test_rejects_oversized_kind(client):
    record = notebook_record(7_000, "device-a", "Bad kind")
    record["kind"] = "galaxy"
    response = client.post("/api/sync/push", json={"deviceId": "device-a", "records": [record]})
    assert response.status_code == 422

def test_repeated_rejected_push_records_one_conflict(client):
    newer = notebook_record(9_000, "device-a", "Server copy")
    client.post("/api/sync/push", json={"deviceId": "device-a", "records": [newer]}).raise_for_status()

    stale = {
        **newer,
        "updatedAt": 8_000,
        "data": {**newer["data"], "title": "Stale copy", "updatedAt": 8_000},
    }
    for _ in range(3):
        response = client.post("/api/sync/push", json={"deviceId": "device-b", "records": [stale]})
        assert response.status_code == 200
        assert len(response.json()["conflicts"]) == 1

    listed = client.get("/api/conflicts", params={"limit": 100}).json()["conflicts"]
    mine = [row for row in listed if row["objectId"] == newer["id"]]
    assert len(mine) == 1

def test_ordinary_edits_record_no_conflicts(client):
    record = notebook_record(10_000, "device-a", "Draft")
    client.post("/api/sync/push", json={"deviceId": "device-a", "records": [record]}).raise_for_status()

    for step, title in enumerate(["Second draft", "Third draft"], start=1):
        stamp = 10_000 + step * 1_000
        edited = {
            **record,
            "updatedAt": stamp,
            "version": step + 1,
            "data": {**record["data"], "title": title, "updatedAt": stamp, "version": step + 1},
        }
        response = client.post("/api/sync/push", json={"deviceId": "device-a", "records": [edited]})
        assert response.status_code == 200
        assert response.json()["conflicts"] == [], response.json()

    listed = client.get("/api/conflicts", params={"limit": 200}).json()["conflicts"]
    assert [row for row in listed if row["objectId"] == record["id"]] == []
