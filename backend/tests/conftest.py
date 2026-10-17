import os
import tempfile
from pathlib import Path

import pytest

_db = Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db.as_posix()}"
os.environ["AI_API_KEY"] = "test-key"

from fastapi.testclient import TestClient  # noqa: E402

from src.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
