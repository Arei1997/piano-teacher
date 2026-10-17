from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from src.config import settings
from src.database import get_db
from src.models import Song
from src.schemas.arrangement import Arrangement
from src.schemas.song import (
    GenerateRequest,
    Measure,
    NoteEvent,
    NotesUpdate,
    SongMeta,
    SongOut,
    SongSummary,
    Source,
)
from src.services import llm
from src.services.arrangement import arrangement_to_notes
from src.services.music import MusicError, build_musicxml, normalize_pitch, parse_file, sort_notes

router = APIRouter(prefix="/api/songs", tags=["songs"])

SHEET_TYPES = llm.IMAGE_TYPES | {llm.PDF_TYPE}


def to_out(song: Song) -> SongOut:
    return SongOut(
        id=song.id,
        title=song.title,
        artist=song.artist,
        source=song.source,
        tempo=song.tempo,
        time_signature=tuple(song.time_signature),
        key=song.key,
        notes=[NoteEvent(**n) for n in song.notes],
        measures=[Measure(**m) for m in song.measures or []],
        musicxml=song.musicxml,
        teacher_notes=song.teacher_notes,
        created_at=song.created_at,
    )


def save_song(
    db: Session,
    notes: list[NoteEvent],
    meta: SongMeta,
    musicxml: str,
    measures: list[Measure],
    source: Source,
    teacher_notes: str | None = None,
) -> SongOut:
    song = Song(
        title=meta.title,
        artist=meta.artist,
        source=source,
        tempo=meta.tempo,
        time_signature=list(meta.time_signature),
        key=meta.key,
        notes=[n.model_dump() for n in notes],
        measures=[m.model_dump() for m in measures],
        musicxml=musicxml,
        teacher_notes=teacher_notes,
    )
    db.add(song)
    db.commit()
    return to_out(song)


@router.get("", response_model=list[SongSummary])
def list_songs(db: Session = Depends(get_db)):
    songs = db.scalars(select(Song).order_by(Song.created_at.desc())).all()
    return [SongSummary(id=s.id, title=s.title, artist=s.artist, source=s.source, created_at=s.created_at) for s in songs]


@router.get("/{song_id}", response_model=SongOut)
def get_song(song_id: int, db: Session = Depends(get_db)):
    song = db.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    return to_out(song)


@router.delete("/{song_id}", status_code=204)
def delete_song(song_id: int, db: Session = Depends(get_db)):
    song = db.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    db.delete(song)
    db.commit()


@router.put("/{song_id}/notes", response_model=SongOut)
async def update_notes(song_id: int, update: NotesUpdate, db: Session = Depends(get_db)):
    """Save corrected notes (e.g. fixing a misread transcription) and redraw the sheet from them."""
    song = db.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    try:
        notes = []
        for n in update.notes:
            name, midi = normalize_pitch(n.pitch)
            notes.append(NoteEvent(pitch=name, midi=midi, **n.model_dump(exclude={"pitch"})))
        notes = sort_notes(notes)
        meta = SongMeta(
            title=song.title,
            artist=song.artist,
            tempo=song.tempo,
            time_signature=tuple(song.time_signature),
            key=song.key,
        )
        musicxml, measures = await run_in_threadpool(build_musicxml, notes, meta)
    except MusicError as exc:
        raise HTTPException(422, str(exc)) from exc
    song.notes = [n.model_dump() for n in notes]
    song.measures = [m.model_dump() for m in measures]
    song.musicxml = musicxml
    db.commit()
    return to_out(song)


@router.post("/import", response_model=SongOut, status_code=201)
async def import_song(file: UploadFile = File(...), db: Session = Depends(get_db)):
    data = await _read_limited(file)
    try:
        notes, meta, musicxml, measures = await run_in_threadpool(parse_file, data, file.filename or "upload")
    except MusicError as exc:
        raise HTTPException(422, str(exc)) from exc
    return save_song(db, notes, meta, musicxml, measures, "import")


@router.post("/generate", response_model=SongOut, status_code=201)
async def generate_song(request: GenerateRequest, db: Session = Depends(get_db)):
    arrangement = await _call_ai(llm.generate_arrangement(request))
    return await _save_arrangement(db, arrangement, "ai")


@router.post("/transcribe", response_model=SongOut, status_code=201)
async def transcribe_song(
    files: list[UploadFile] = File(...),
    title: str | None = Form(default=None),
    db: Session = Depends(get_db),
):
    pages = []
    for upload in files:
        if upload.content_type not in SHEET_TYPES:
            raise HTTPException(415, f"'{upload.filename}' must be a PNG, JPEG, WebP, GIF or PDF.")
        pages.append((upload.content_type, await _read_limited(upload)))
    arrangement = await _call_ai(llm.transcribe_sheet(pages, title))
    return await _save_arrangement(db, arrangement, "scan")


async def _call_ai(call):
    try:
        return await call
    except llm.LlmError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc


async def _save_arrangement(db: Session, arrangement: Arrangement, source: Source) -> SongOut:
    try:
        notes, meta, warnings = arrangement_to_notes(arrangement)
        musicxml, measures = await run_in_threadpool(build_musicxml, notes, meta)
    except MusicError as exc:
        raise HTTPException(422, str(exc)) from exc
    teacher_notes = arrangement.teacher_notes
    if warnings:
        teacher_notes += "\n\nSkipped while importing: " + "; ".join(warnings[:10])
    return save_song(db, notes, meta, musicxml, measures, source, teacher_notes)


async def _read_limited(upload: UploadFile) -> bytes:
    data = await upload.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"'{upload.filename}' is larger than {settings.max_upload_mb} MB.")
    return data
