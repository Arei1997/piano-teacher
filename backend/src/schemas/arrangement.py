"""The shape the AI writes songs in (via structured outputs).

The model thinks in measures, not absolute time, so it writes each bar's right and
left hand separately; services.arrangement converts this into NoteEvents.
"""

from typing import Literal

from pydantic import BaseModel, Field


class ArrangedEvent(BaseModel):
    beat: float = Field(description="Offset from the start of the measure in quarter notes, starting at 0.")
    pitches: list[str] = Field(description="Scientific pitch names struck together, e.g. ['G4', 'A4']. Use # or b.")
    duration: float = Field(description="Length in quarter notes: 0.25 sixteenth, 0.5 eighth, 1 quarter, 2 half, 4 whole.")
    fingers: list[int] = Field(description="Suggested finger (1=thumb ... 5=pinky) for each pitch, same order. Empty if unsure.")


class ArrangedMeasure(BaseModel):
    number: int = Field(description="Measure number, starting at 1.")
    right_hand: list[ArrangedEvent]
    left_hand: list[ArrangedEvent]


class Arrangement(BaseModel):
    title: str
    artist: str | None
    tempo: int = Field(description="Quarter-note beats per minute.")
    time_signature: Literal["2/4", "3/4", "4/4", "6/8", "9/8", "12/8", "2/2", "5/4"]
    key: str = Field(description="Key such as 'C major' or 'A minor'.")
    teacher_notes: str = Field(
        description="Short practice advice for this piece, and anything uncertain about the arrangement or transcription."
    )
    measures: list[ArrangedMeasure]
