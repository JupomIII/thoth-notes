import time

from app import pairing
from app.config import settings


def test_pairing_code_exchanges_for_token(bare_client):
    code = pairing.current_code(settings)
    response = bare_client.post("/api/pair", json={"code": code, "deviceName": "iPad test"})
    assert response.status_code == 200
    body = response.json()
    assert body["token"] == settings.read_token()
    assert body["serverUrl"].startswith("http")
    assert body["deviceName"]


def test_pairing_rejects_unknown_code(bare_client):
    response = bare_client.post("/api/pair", json={"code": "ZZZZZZ"})
    assert response.status_code == 401


def test_pairing_code_rotates_every_window():
    window = pairing._window(settings)
    now = 1_700_000_000.0
    first = pairing.code_for(settings, now)
    second = pairing.code_for(settings, now + window)
    assert len(first) == pairing.CODE_LENGTH
    assert first != second


def test_previous_window_is_still_accepted():
    window = pairing._window(settings)
    now = 1_700_000_000.0
    previous = pairing.code_for(settings, now - window)
    assert pairing.verify(settings, previous.lower(), now)
    assert not pairing.verify(settings, "AAAAAA", now) or pairing.code_for(settings, now) == "AAAAAA"


def test_pairing_is_public_but_token_endpoints_are_not(bare_client):
    assert bare_client.get("/api/health").status_code == 200
    assert bare_client.get("/api/status").status_code == 401
