"""Generated technique exercises: five-finger patterns, scales, arpeggios, Hanon No. 1,
a cadence progression and a blues left-hand pattern.

Exercises are built as ordinary note lists, so the whole app (sheet, falling notes,
wait/game/train modes) works on them unchanged. music21 supplies correctly spelled
scales in every key; fingerings are included only where the standard one is certain.
"""

from music21 import pitch as m21pitch
from music21 import scale as m21scale

from src.schemas.exercise import ExerciseRequest
from src.schemas.song import NoteEvent, SongMeta
from src.services.music import MusicError, sort_notes

MAJOR_KEYS = ["C", "G", "D", "A", "E", "B", "F", "Bb", "Eb", "Ab", "Db", "Gb"]
MINOR_KEYS = ["A", "E", "B", "F#", "C#", "D", "G", "C", "F"]
BLUES_KEYS = ["A", "C", "D", "E", "G"]

SCALES = {
    "major": m21scale.MajorScale,
    "natural minor": m21scale.MinorScale,
    "harmonic minor": m21scale.HarmonicMinorScale,
}

# Standard scale fingerings, ascending. "C" pattern: C G D A E major and the white-key
# minors; "F" pattern: thumb under after the fourth finger in the right hand.
C_KEYS = {("major", k) for k in "CGDAE"} | {(m, k) for m in ("natural minor", "harmonic minor") for k in "AEDGC"}
F_KEYS = {(m, "F") for m in SCALES}
RH_FINGERS = {
    "C": {1: [1, 2, 3, 1, 2, 3, 4, 5], 2: [1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5]},
    "F": {1: [1, 2, 3, 4, 1, 2, 3, 4], 2: [1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 4]},
}
LH_FINGERS = {1: [5, 4, 3, 2, 1, 3, 2, 1], 2: [5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1]}

PRACTICE_TIP = (
    "Start slowly enough to play every note right, keep your wrist loose and fingers curved, "
    "and only speed up once it feels easy. Train mode does this for you: it raises the tempo "
    "after each clean repetition."
)


def build_exercise(request: ExerciseRequest) -> tuple[list[NoteEvent], SongMeta, str, str]:
    """Notes, metadata, a stable title (to reuse saved copies) and practice notes."""
    builders = {
        "five_finger": _five_finger,
        "scale": _scale,
        "arpeggio": _arpeggio,
        "hanon": _hanon,
        "chords": _chords,
        "blues": _blues,
    }
    notes, title, tempo, tip = builders[request.kind](request)
    meta = SongMeta(title=title, artist="Exercise", tempo=tempo, key=_key_name(request))
    return sort_notes(notes), meta, title, f"{tip}\n\n{PRACTICE_TIP}"


# ---- pitch helpers ---------------------------------------------------------


def _key_name(request: ExerciseRequest) -> str:
    if request.kind in ("hanon",):
        return "C major"
    if request.kind == "blues":
        return f"{request.key} major"
    mode = "major" if request.scale == "major" else "minor"
    return f"{request.key} {mode}"


def _m21(name: str) -> str:
    return name[0] + name[1:].replace("b", "-")


def _name(p: m21pitch.Pitch) -> tuple[str, int]:
    accidental = p.accidental.modifier.replace("-", "b") if p.accidental and p.accidental.alter else ""
    return f"{p.step}{accidental}{p.octave}", int(p.midi)


def _start_octave(tonic: str) -> int:
    """Right-hand starting octave: low keys start on octave 4, high ones (A, B...) drop to 3."""
    return 4 if m21pitch.Pitch(_m21(tonic)).pitchClass <= 7 else 3


def _degrees(request: ExerciseRequest, scale_kind: str, octaves_span: int) -> list[tuple[str, int]]:
    """Scale pitches from the tonic up `octaves_span` octaves (inclusive), right-hand register."""
    if scale_kind != "major" and request.key not in MINOR_KEYS:
        raise MusicError(f"{request.key} minor isn't available. Choose one of: {', '.join(MINOR_KEYS)}.")
    if scale_kind == "major" and request.key not in MAJOR_KEYS:
        raise MusicError(f"{request.key} major isn't available. Choose one of: {', '.join(MAJOR_KEYS)}.")
    tonic = _m21(request.key)
    start = m21pitch.Pitch(f"{tonic}{_start_octave(request.key)}")
    top = start.transpose(12 * octaves_span)
    return [_name(p) for p in SCALES[scale_kind](tonic).getPitches(start, top)]


def _event(pitch: tuple[str, int], start: float, length: float, hand: str, finger: int | None) -> NoteEvent:
    name, midi = pitch
    return NoteEvent(pitch=name, midi=midi, start=start, duration=length, hand=hand, finger=finger)


def _down_octave(pitch: tuple[str, int]) -> tuple[str, int]:
    name, midi = pitch
    return f"{name[:-1]}{int(name[-1]) - 1}", midi - 12


def _melody(
    pitches: list[tuple[str, int]],
    lengths: list[float],
    hands: str,
    rh_fingers: list[int] | None,
    lh_fingers: list[int] | None,
) -> list[NoteEvent]:
    """A line for the right hand, the left hand an octave lower, or both in parallel."""
    notes, start = [], 0.0
    for i, (p, length) in enumerate(zip(pitches, lengths)):
        if hands in ("right", "both"):
            notes.append(_event(p, start, length, "R", rh_fingers[i] if rh_fingers else None))
        if hands in ("left", "both"):
            notes.append(_event(_down_octave(p), start, length, "L", lh_fingers[i] if lh_fingers else None))
        start += length
    return notes


def _quarters_to_bar(count: int) -> list[float]:
    """Quarter notes, with the last one held to the end of its 4/4 bar."""
    lengths = [1.0] * count
    lengths[-1] = 4 - (count - 1) % 4
    return lengths


def _hands_label(hands: str) -> str:
    return {"right": "right hand", "left": "left hand", "both": "hands together"}[hands]


# ---- exercises --------------------------------------------------------------


def _five_finger(r: ExerciseRequest):
    first_five = _degrees(r, r.scale, 1)[:5]
    line = first_five + first_five[-2::-1]  # 1 2 3 4 5 4 3 2 1
    rh = [1, 2, 3, 4, 5, 4, 3, 2, 1]
    lh = [5, 4, 3, 2, 1, 2, 3, 4, 5]
    notes = _melody(line, _quarters_to_bar(len(line)), r.hands, rh, lh)
    title = f"Five-finger pattern · {r.key} {r.scale} · {_hands_label(r.hands)}"
    tip = "Keep each finger over its own key. Play evenly, lifting fingers no higher than needed."
    return notes, title, 90, tip


def _scale(r: ExerciseRequest):
    up = _degrees(r, r.scale, r.octaves)
    line = up + up[-2::-1]
    pattern = "C" if (r.scale, r.key) in C_KEYS else "F" if (r.scale, r.key) in F_KEYS else None
    rh = lh = None
    if pattern:
        rh_up = RH_FINGERS[pattern][r.octaves]
        rh = rh_up + rh_up[-2::-1]
    if pattern == "C" or (pattern == "F" and r.key == "F"):
        lh_up = LH_FINGERS[r.octaves]
        lh = lh_up + lh_up[-2::-1]
    notes = _melody(line, _quarters_to_bar(len(line)), r.hands, rh, lh)
    octaves = "1 octave" if r.octaves == 1 else "2 octaves"
    title = f"{r.key} {r.scale} scale · {octaves} · {_hands_label(r.hands)}"
    tip = "Pass the thumb under smoothly without twisting your wrist; keep the sound even."
    if not pattern:
        tip += " Fingering isn't shown for this key: use the one from your method book or teacher."
    return notes, title, 80, tip


def _arpeggio(r: ExerciseRequest):
    scale = _degrees(r, r.scale, r.octaves)
    up = [p for i, p in enumerate(scale) if i % 7 in (0, 2, 4)]  # 1-3-5 in each octave, plus the top tonic
    line = up + up[-2::-1]
    white_root = (r.scale == "major" and r.key in "CFG") or (r.scale != "major" and r.key in "ADE")
    rh_up = [1, 2, 3, 5] if r.octaves == 1 else [1, 2, 3, 1, 2, 3, 5]
    lh_up = [5, 4, 2, 1] if r.octaves == 1 else [5, 4, 2, 1, 4, 2, 1]
    rh = rh_up + rh_up[-2::-1]
    lh = lh_up + lh_up[-2::-1] if white_root else None
    notes = _melody(line, _quarters_to_bar(len(line)), r.hands, rh, lh)
    octaves = "1 octave" if r.octaves == 1 else "2 octaves"
    title = f"{r.key} {r.scale} arpeggio · {octaves} · {_hands_label(r.hands)}"
    tip = "Let the hand travel with the arm. Aim for a smooth, connected line across the stretches."
    return notes, title, 72, tip


def _hanon(r: ExerciseRequest):
    """Hanon, The Virtuoso Pianist, No. 1 (public domain), in eighth notes."""
    c_major = _degrees(ExerciseRequest(kind="scale", key="C", scale="major"), "major", 3)
    groups = [[d, d + 2, d + 3, d + 4, d + 5, d + 4, d + 3, d + 2] for d in range(14)]  # up two octaves
    groups += [[d, d - 2, d - 3, d - 4, d - 5, d - 4, d - 3, d - 2] for d in range(18, 4, -1)]  # and back down
    line = [c_major[d] for group in groups for d in group] + [c_major[0]]
    rh = ([1, 2, 3, 4, 5, 4, 3, 2] * 14) + ([5, 4, 3, 2, 1, 2, 3, 4] * 14) + [1]
    lh = ([5, 4, 3, 2, 1, 2, 3, 4] * 14) + ([1, 2, 3, 4, 5, 4, 3, 2] * 14) + [5]

    # Both hands play the same notes, the left hand two octaves lower.
    notes = []
    for i, p in enumerate(line):
        start, length = i * 0.5, 0.5 if i < len(line) - 1 else 4.0
        if r.hands in ("right", "both"):
            notes.append(_event(p, start, length, "R", rh[i]))
        if r.hands in ("left", "both"):
            notes.append(_event(_down_octave(_down_octave(p)), start, length, "L", lh[i]))
    title = f"Hanon No. 1 · {_hands_label(r.hands)}"
    tip = "Lift each finger and play it firmly, especially 4 and 5. Start at 60 BPM and build up over weeks."
    return notes, title, 60, tip


def _chords(r: ExerciseRequest):
    """I-IV-V-I (i-iv-V-i in minor) with close voice leading, played twice."""
    kind = "major" if r.scale == "major" else "harmonic minor"  # the raised 7th gives minor keys a major V
    scale = _degrees(r, kind, 1)
    leading = _down_octave(scale[6])  # 7th degree, just under the tonic
    voicings = [
        [scale[0], scale[2], scale[4]],  # I
        [scale[0], scale[3], scale[5]],  # IV 6/4
        [leading, scale[1], scale[4]],  # V 6
        [scale[0], scale[2], scale[4]],  # I
    ]
    rh_fingers = [[1, 3, 5], [1, 2, 5], [1, 2, 5], [1, 3, 5]]
    bass = [_down_octave(scale[0]), _down_octave(scale[3]), _down_octave(scale[4]), _down_octave(scale[0])]
    bass = [_down_octave(p) if p[1] >= 55 else p for p in bass]  # keep the bass below G3

    notes = []
    for rep in range(2):
        for i, (chord, root) in enumerate(zip(voicings, bass)):
            start = (rep * 4 + i) * 4.0
            if r.hands in ("right", "both"):
                notes += [_event(p, start, 4, "R", f) for p, f in zip(chord, rh_fingers[i])]
            if r.hands in ("left", "both"):
                notes.append(_event(root, start, 4, "L", None))
    numerals = "I–IV–V–I" if r.scale == "major" else "i–iv–V–i"
    title = f"Chord progression {numerals} · {r.key} {'major' if r.scale == 'major' else 'minor'} · {_hands_label(r.hands)}"
    tip = "Move to each chord by the shortest path; the common notes stay put. Listen for all three notes landing together."
    return notes, title, 60, tip


def _blues(r: ExerciseRequest):
    """12-bar blues, left-hand boogie: root with 5th, 6th, flat 7th, 6th."""
    if r.key not in BLUES_KEYS:
        raise MusicError(f"Blues is available in: {', '.join(BLUES_KEYS)}.")
    flats = r.key in ("C", "G")  # their flat 7ths (Bb over C, Eb over F) are flats
    tonic = m21pitch.Pitch(f"{r.key}2")
    if tonic.midi < 40:  # keep roots between E2 and D#3
        tonic = tonic.transpose(12)
    form = [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7]  # I I I I IV IV I I V IV I V, in semitones above the tonic
    shape = [7, 7, 9, 9, 10, 10, 9, 9]

    def spelled(midi: int) -> tuple[str, int]:
        p = m21pitch.Pitch(midi=midi)
        if flats and p.accidental and p.accidental.alter > 0:
            p = p.getEnharmonic()
        return _name(p)

    notes = []
    for bar, offset in enumerate(form):
        root = int(tonic.midi) + offset
        if root > 51:
            root -= 12
        for i, upper in enumerate(shape):
            start = bar * 4 + i * 0.5
            notes.append(_event(spelled(root), start, 0.5, "L", 5))
            notes.append(_event(spelled(root + upper), start, 0.5, "L", {7: 2, 9: 1, 10: 1}[upper]))
    title = f"12-bar blues left hand · {r.key}"
    tip = "Keep the pinky on the root and rock between fingers 2 and 1 on top. Once it's steady, try swinging the eighths."
    return notes, title, 90, tip
