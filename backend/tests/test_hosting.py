from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config import Settings, settings
from src.main import serve_frontend


def test_without_a_password_everything_is_open(client):
    assert client.get("/api/songs").status_code == 200
    health = client.get("/api/health").json()
    assert health["login_required"] is False and health["logged_in"] is True


def test_password_protects_the_api(client, monkeypatch):
    monkeypatch.setattr(settings, "app_password", "s3cret")
    client.cookies.clear()

    assert client.get("/api/songs").status_code == 401
    assert client.get("/api/health").json() == {
        "status": "ok",
        "ai_configured": True,
        "login_required": True,
        "logged_in": False,
    }
    assert client.post("/api/login", json={"password": "nope"}).status_code == 401

    assert client.post("/api/login", json={"password": "s3cret"}).status_code == 204
    assert client.get("/api/songs").status_code == 200  # cookie now set
    assert client.get("/api/health").json()["logged_in"] is True

    # Changing the password logs existing sessions out.
    monkeypatch.setattr(settings, "app_password", "changed")
    assert client.get("/api/songs").status_code == 401

    client.post("/api/logout")
    client.cookies.clear()


def test_hosted_postgres_urls_use_the_psycopg_driver():
    assert Settings(database_url="postgres://u:p@host/db").database_url == "postgresql+psycopg://u:p@host/db"
    assert Settings(database_url="postgresql://u:p@host/db").database_url == "postgresql+psycopg://u:p@host/db"
    assert Settings(database_url="sqlite:///x.db").database_url == "sqlite:///x.db"


def test_built_frontend_is_served_with_spa_fallback(tmp_path):
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app-123.js").write_text("console.log(1)")
    (tmp_path / "manifest.webmanifest").write_text("{}")
    (tmp_path.parent / "secret.txt").write_text("private")

    app = FastAPI()
    serve_frontend(app, tmp_path)
    web = TestClient(app)

    asset = web.get("/assets/app-123.js")
    assert asset.text == "console.log(1)" and "immutable" in asset.headers["cache-control"]
    assert web.get("/manifest.webmanifest").text == "{}"
    assert web.get("/practice/anything").text == "<html>app</html>"  # client-side route
    assert web.get("/").headers["cache-control"] == "no-cache"
    assert "private" not in web.get("/../secret.txt").text  # no escaping the build folder
    assert web.get("/api/nothing").status_code == 404
