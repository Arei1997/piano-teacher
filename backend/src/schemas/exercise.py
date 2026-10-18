from typing import Literal

from pydantic import BaseModel

ExerciseKind = Literal["five_finger", "scale", "arpeggio", "hanon", "chords", "blues"]


class ExerciseRequest(BaseModel):
    kind: ExerciseKind
    key: str = "C"
    scale: Literal["major", "natural minor", "harmonic minor"] = "major"
    hands: Literal["right", "left", "both"] = "right"
    octaves: Literal[1, 2] = 1
