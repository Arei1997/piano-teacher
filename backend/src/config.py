import secrets
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    ai_api_key: str | None = None
    # Only needed when the API key is not scoped to a single workspace.
    ai_workspace_id: str | None = None
    ai_model: str = "claude-opus-5-5"
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'pianoteacher.db').as_posix()}"
    cors_origins: list[str] = ["http://localhost:5173", "https://localhost:5173"]
    max_upload_mb: int = 20

    # Hosting: set APP_PASSWORD to require a login (keeps strangers off your AI key).
    app_password: str | None = None
    # Signs login cookies. Set it when hosting, or everyone is logged out on each restart.
    session_secret: str = secrets.token_hex(32)
    # The built frontend (pnpm build). When present, the backend serves the whole app.
    frontend_dist: Path = BACKEND_DIR.parent / "frontend" / "dist"

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, url: str) -> str:
        # Hosted Postgres URLs (Neon, Render...) say postgres:// or postgresql://;
        # SQLAlchemy needs the driver named to use psycopg 3.
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix) :]
        return url


settings = Settings()
