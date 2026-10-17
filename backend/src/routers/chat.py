from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from src.database import get_db
from src.models import Song
from src.routers.songs import to_out
from src.schemas.chat import ChatRequest
from src.services.llm import stream_chat

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("")
def chat(request: ChatRequest, db: Session = Depends(get_db)):
    if request.messages[-1].role != "user":
        raise HTTPException(422, "The last message must be from the user.")
    song = None
    if request.song_id is not None:
        found = db.get(Song, request.song_id)
        song = to_out(found) if found else None
    return StreamingResponse(
        stream_chat(request.messages, song, request.position),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
