from starlette.testclient import TestClient

from app.feasibility import app

client = TestClient(app)


def test_health_reports_the_lan_address():
    body = client.get("/health").json()
    assert body["ok"] is True
    assert body["service"] == "thoth-notes-feasibility"
    assert body["port"] == 8787
    assert body["lanIp"]


def test_sync_test_answers_get_and_post():
    assert client.get("/sync/test").json()["method"] == "GET"
    posted = client.post("/sync/test", json={"probe": 1}).json()
    assert posted["ok"] is True
    assert posted["method"] == "POST"


def test_every_response_is_cross_origin_readable():
    response = client.get("/health", headers={"Origin": "https://jupomiii.github.io"})
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.headers["cache-control"] == "no-store"


def test_preflight_allows_private_network_requests():
    response = client.options(
        "/health",
        headers={
            "Origin": "https://jupomiii.github.io",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Private-Network": "true",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-private-network"] == "true"


def test_index_page_is_served_for_ipad_checks():
    response = client.get("/")
    assert response.status_code == 200
    assert "Local HTTP probe is running" in response.text
