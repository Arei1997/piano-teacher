from pathlib import Path

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


settings = Settings()
