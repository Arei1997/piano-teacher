from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Hand = Literal["R", "L"]
Source = Literal["import", "ai", "scan", "exercise"]


class NoteEvent(BaseModel):
    """One key press. Time is in quarter notes from the start of the piece."""

    pitch: str
    midi: int
    start: float
    duration: float
    hand: Hand
    finger: int | None = None


class Measure(BaseModel):
    number: int
    start: float
    length: float


class SongMeta(BaseModel):
    title: str
    artist: str | None = None
    tempo: int = 90
    time_signature: tuple[int, int] = (4, 4)
    key: str | None = None


class SongSummary(BaseModel):
    id: int
    title: str
    artist: str | None
    source: Source
    created_at: datetime


class SongOut(SongMeta):
    id: int
    source: Source
    notes: list[NoteEvent]
    measures: list[Measure]
    musicxml: str
    teacher_notes: str | None = None
    created_at: datetime


class NoteInput(BaseModel):
    pitch: str
    start: float = Field(ge=0)
    duration: float = Field(gt=0)
    hand: Hand
    finger: int | None = Field(default=None, ge=1, le=5)


class NotesUpdate(BaseModel):
    notes: list[NoteInput] = Field(min_length=1, max_length=20000)


class GenerateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    artist: str | None = Field(default=None, max_length=200)
    difficulty: Literal["beginner", "intermediate", "advanced"] = "beginner"
    hands: Literal["both", "right", "left"] = "both"
    instructions: str | None = Field(default=None, max_length=2000)
