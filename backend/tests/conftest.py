import os
import tempfile

# A throwaway data directory must exist before the app package reads settings.
os.environ.setdefault("THOTH_DATA_DIR", tempfile.mkdtemp(prefix="thoth-test-"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    application = create_app()
    with TestClient(application) as test_client:
        token = settings.read_token()
        assert token, "server must create a pairing token on startup"
        test_client.headers.update({"X-Thoth-Token": token})
        yield test_client


@pytest.fixture(scope="session")
def bare_client():
    application = create_app()
    with TestClient(application) as test_client:
        yield test_client
