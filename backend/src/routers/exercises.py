from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from src.database import get_db
from src.models import Song
from src.routers.songs import save_song, to_out
from src.schemas.exercise import ExerciseRequest
from src.schemas.song import SongOut
from src.services.exercises import build_exercise
from src.services.music import MusicError, build_musicxml

router = APIRouter(prefix="/api/exercises", tags=["exercises"])


@router.post("", response_model=SongOut)
async def open_exercise(request: ExerciseRequest, db: Session = Depends(get_db)):
    """Build an exercise, or reuse the saved copy so best scores and edits carry over."""
    try:
        notes, meta, title, tips = build_exercise(request)
    except MusicError as exc:
        raise HTTPException(422, str(exc)) from exc
    existing = db.scalar(select(Song).where(Song.source == "exercise", Song.title == title))
    if existing:
        return to_out(existing)
    musicxml, measures = await run_in_threadpool(build_musicxml, notes, meta)
    return save_song(db, notes, meta, musicxml, measures, "exercise", tips)
