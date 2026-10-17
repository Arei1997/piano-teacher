from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.database import Base, SessionLocal, engine
from src.routers import chat, songs
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
)
app.include_router(songs.router)
app.include_router(chat.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "ai_configured": bool(settings.ai_api_key)}
