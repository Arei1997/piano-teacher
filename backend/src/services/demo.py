from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models import Song
from src.schemas.song import NoteEvent, SongMeta
from src.services.music import build_musicxml, normalize_pitch

# Beethoven's "Ode to Joy" (public domain), as (pitch, beats) per hand.
ODE_RIGHT = [
    ("E4", 1), ("E4", 1), ("F4", 1), ("G4", 1), ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1),
    ("C4", 1), ("C4", 1), ("D4", 1), ("E4", 1), ("E4", 1.5), ("D4", 0.5), ("D4", 2),
    ("E4", 1), ("E4", 1), ("F4", 1), ("G4", 1), ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1),
    ("C4", 1), ("C4", 1), ("D4", 1), ("E4", 1), ("D4", 1.5), ("C4", 0.5), ("C4", 2),
]
ODE_RIGHT_FINGERS = [3, 3, 4, 5, 5, 4, 3, 2, 1, 1, 2, 3, 3, 2, 2, 3, 3, 4, 5, 5, 4, 3, 2, 1, 1, 2, 3, 2, 1, 1]
ODE_LEFT = [("C3", 4), ("G2", 4), ("A2", 4), ("G2", 4), ("C3", 4), ("G2", 4), ("F2", 2), ("G2", 2), ("C3", 4)]
ODE_LEFT_FINGERS = [1, 5, 4, 5, 1, 5, 5, 4, 1]


def _sequence(notes, fingers, hand: str) -> list[NoteEvent]:
    events, start = [], 0.0
    for (pitch, beats), finger in zip(notes, fingers):
        name, midi = normalize_pitch(pitch)
        events.append(NoteEvent(pitch=name, midi=midi, start=start, duration=beats, hand=hand, finger=finger))
        start += beats
    return events


def seed_demo(db: Session) -> None:
    if db.scalar(select(Song.id).limit(1)) is not None:
        return
    notes = _sequence(ODE_RIGHT, ODE_RIGHT_FINGERS, "R") + _sequence(ODE_LEFT, ODE_LEFT_FINGERS, "L")
    notes.sort(key=lambda n: (n.start, n.hand != "L"))
    meta = SongMeta(title="Ode to Joy", artist="Ludwig van Beethoven", tempo=100, key="C major")
    musicxml, measures = build_musicxml(notes, meta)
    db.add(
        Song(
            title=meta.title,
            artist=meta.artist,
            source="import",
            tempo=meta.tempo,
            time_signature=list(meta.time_signature),
            key=meta.key,
            notes=[n.model_dump() for n in notes],
            measures=[m.model_dump() for m in measures],
            musicxml=musicxml,
            teacher_notes="A five-finger-position warm-up: right hand thumb on middle C (C4) the whole time.",
        )
    )
    db.commit()
