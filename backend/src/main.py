from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from src import auth
from src.config import settings
from src.database import Base, SessionLocal, engine
from src.routers import chat, exercises, songs
from src.services.demo import seed_demo


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_demo(db)
    yield


app = FastAPI(title="Piano Teacher", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
app.middleware("http")(auth.require_login)
app.include_router(auth.router)
app.include_router(songs.router)
app.include_router(chat.router)
app.include_router(exercises.router)


@app.get("/api/health")
def health(request: Request):
    return {
        "status": "ok",
        "ai_configured": bool(settings.ai_api_key),
        "login_required": bool(settings.app_password),
        "logged_in": auth.is_authenticated(request),
    }


def serve_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built frontend from `dist`, so one server runs the whole app."""
    dist = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        file = (dist / path).resolve()
        if path and file.is_file() and file.is_relative_to(dist):
            # Hashed build assets never change; everything else must revalidate.
            cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
            return FileResponse(file, headers={"Cache-Control": cache})
        # Any other route belongs to the single-page app.
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})


if settings.frontend_dist.is_dir():
    serve_frontend(app, settings.frontend_dist)
