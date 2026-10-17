"""Conversion between the app's note-event format and real notation.

Every song in the app is a flat list of NoteEvents (pitch, start, duration, hand),
with time measured in quarter notes from the start of the piece. music21 does the
heavy lifting in both directions:

- parse_file: MusicXML / MXL / MIDI  -> NoteEvents (+ MusicXML for display)
- build_musicxml: NoteEvents         -> engraved two-staff piano MusicXML
"""

import math
import re
import tempfile
from fractions import Fraction
from pathlib import Path

from music21 import (
    chord,
    clef,
    converter,
    duration,
    instrument,
    key,
    layout,
    meter,
    note,
    stream,
    tempo,
)
from music21.musicxml.m21ToXml import GeneralObjectExporter

from src.schemas.song import Measure, NoteEvent, SongMeta

PITCH_RE = re.compile(r"^([A-Ga-g])([#b♯♭]{0,2})(-?\d)$")
STEP_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
MIDDLE_C = 60
SUPPORTED_EXTENSIONS = {".musicxml", ".xml", ".mxl", ".mid", ".midi"}

# 1/24 of a quarter fits 32nds, 16th triplets and 8th triplets exactly.
FINE_GRID = 24
# Sheet-drawing attempts, finest first: exact, then 16ths + 8th triplets, then 16ths, then 8ths.
DISPLAY_GRIDS: list[tuple[int, ...]] = [(FINE_GRID,), (4, 3), (4,), (2,)]


class MusicError(ValueError):
    pass


def normalize_pitch(raw: str) -> tuple[str, int]:
    """'bb3' -> ('Bb3', 58). Accepts # / b and the unicode sharp/flat signs."""
    match = PITCH_RE.match(raw.strip())
    if not match:
        raise MusicError(f"Invalid pitch '{raw}'. Use names like C4, F#3 or Bb2.")
    step, accidental, octave = match.groups()
    accidental = accidental.replace("♯", "#").replace("♭", "b")
    semitones = STEP_SEMITONES[step.upper()] + accidental.count("#") - accidental.count("b")
    midi = 12 * (int(octave) + 1) + semitones
    if not 21 <= midi <= 108:
        raise MusicError(f"Pitch '{raw}' is outside the 88-key range (A0-C8).")
    return f"{step.upper()}{accidental}{octave}", midi


def _to_m21_name(name: str) -> str:
    # music21 spells flats with '-' (B-3), not 'b'
    return name[0] + name[1:].replace("b", "-")


def _from_m21_pitch(p) -> tuple[str, int]:
    accidental = p.accidental.modifier.replace("-", "b") if p.accidental else ""
    return f"{p.step}{accidental}{p.octave}", int(p.midi)


def parse_key(text: str | None) -> key.Key:
    """'C minor', 'F# major', 'Bb' -> music21 Key. Unknown text falls back to C major."""
    if not text:
        return key.Key("C")
    parts = text.strip().split()
    tonic = parts[0].replace("b", "-") if len(parts[0]) > 1 else parts[0]
    mode = parts[1].lower() if len(parts) > 1 else "major"
    try:
        return key.Key(tonic.lower() if mode.startswith("min") else tonic.upper())
    except Exception:
        return key.Key("C")


def snap(value: float, divisors: tuple[int, ...] = (FINE_GRID,)) -> Fraction:
    """Nearest exact grid value, e.g. 0.333 -> 1/3. With several divisors the closest grid wins."""
    candidates = [Fraction(round(value * d), d) for d in divisors]
    return min(candidates, key=lambda c: abs(c - Fraction(value)))


def _hand_part(
    notes: list[NoteEvent], hand: str, meta: SongMeta, total_length: Fraction, divisors: tuple[int, ...]
) -> stream.PartStaff:
    part = stream.PartStaff(id=f"piano-{hand}")
    part.insert(0, instrument.Piano())
    part.insert(0, clef.TrebleClef() if hand == "R" else clef.BassClef())
    part.insert(0, parse_key(meta.key))
    part.insert(0, meter.TimeSignature(f"{meta.time_signature[0]}/{meta.time_signature[1]}"))
    if hand == "R":
        part.insert(0, tempo.MetronomeMark(number=meta.tempo))

    # Notes struck together with the same length become one chord. Exact fractions
    # (not floats) are required for music21 to write tuplets such as triplets.
    smallest = Fraction(1, max(divisors))
    groups: dict[tuple[Fraction, Fraction], list[NoteEvent]] = {}
    for n in notes:
        groups.setdefault((snap(n.start, divisors), max(smallest, snap(n.duration, divisors))), []).append(n)
    end = Fraction(0)
    for (start, length), group in sorted(groups.items()):
        names = [_to_m21_name(n.pitch) for n in sorted(group, key=lambda n: n.midi)]
        element = note.Note(names[0]) if len(names) == 1 else chord.Chord(names)
        element.duration = duration.Duration(length)
        part.insert(start, element)
        end = max(end, start + length)

    # Pad so both staves end on the same barline.
    if end < total_length:
        part.insert(end, note.Rest(quarterLength=total_length - end))

    # chordify resolves overlapping notes (e.g. a held bass under moving notes)
    # into a single non-overlapping voice with ties, which notation requires.
    flat = part.chordify() if notes else part
    return flat.makeNotation()


def build_musicxml(notes: list[NoteEvent], meta: SongMeta) -> tuple[str, list[Measure]]:
    """Engrave notes as a two-staff piano score.

    Overlapping rhythms (e.g. a triplet against a held chord) can split into lengths
    no notation can write. Each retry draws the sheet on a coarser rhythmic grid;
    the notes used for playback and practice are never changed.
    """
    measure_length = Fraction(meta.time_signature[0] * 4, meta.time_signature[1])
    end = max((n.start + n.duration for n in notes), default=float(measure_length))
    bars = math.ceil(snap(end) / measure_length)
    total_length = max(1, bars) * measure_length

    last_error: Exception | None = None
    for divisors in DISPLAY_GRIDS:
        score = stream.Score()
        score.metadata = _metadata(meta)
        right = _hand_part([n for n in notes if n.hand == "R"], "R", meta, total_length, divisors)
        left = _hand_part([n for n in notes if n.hand == "L"], "L", meta, total_length, divisors)
        score.insert(0, right)
        score.insert(0, left)
        score.insert(0, layout.StaffGroup([right, left], symbol="brace", barTogether=True))
        try:
            return _to_xml(score), _measures(score)
        except Exception as exc:  # music21 raises several exception types for unwritable rhythms
            last_error = exc
    raise MusicError(f"Could not draw this song as sheet music: {last_error}")


def _metadata(meta: SongMeta):
    from music21 import metadata

    md = metadata.Metadata()
    md.title = meta.title
    if meta.artist:
        md.composer = meta.artist
    return md


def _to_xml(score: stream.Score) -> str:
    return GeneralObjectExporter(score).parse().decode("utf-8")


def _measures(score: stream.Score) -> list[Measure]:
    """Where each bar starts. Needed because pickups and time-signature changes
    make bar numbers impossible to derive from note times alone."""
    part = score.parts[0]
    return [
        Measure(number=m.number, start=round(float(m.getOffsetBySite(part)), 4), length=round(float(m.quarterLength), 4))
        for m in part.getElementsByClass(stream.Measure)
    ]


def parse_file(data: bytes, filename: str) -> tuple[list[NoteEvent], SongMeta, str, list[Measure]]:
    """Read an uploaded notation file into note events, metadata, display MusicXML and bar positions."""
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise MusicError(f"Unsupported file type '{suffix}'. Use MusicXML, MXL or MIDI.")

    # music21 detects .mxl / .mid by extension, so parse from a real file.
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"upload{suffix}"
        path.write_bytes(data)
        try:
            score = converter.parse(str(path))
        except Exception as exc:
            raise MusicError(f"Could not read '{filename}': {exc}") from exc

    if not isinstance(score, stream.Score):
        score = stream.Score([score])

    meta = _read_meta(score, Path(filename).stem.replace("_", " ").replace("-", " ").strip().title())
    notes = _read_notes(score)
    if not notes:
        raise MusicError("The file contains no notes.")

    # MIDI carries no engraving, so re-engrave it cleanly from the notes.
    if suffix in {".mid", ".midi"}:
        musicxml, measures = build_musicxml(notes, meta)
    else:
        try:
            musicxml, measures = _to_xml(score), _measures(score)
        except Exception:  # an original we can't re-export: engrave our own from the notes
            musicxml, measures = build_musicxml(notes, meta)
    return notes, meta, musicxml, measures


def _read_meta(score: stream.Score, fallback_title: str) -> SongMeta:
    flat = score.flatten()
    marks = flat.getElementsByClass(tempo.MetronomeMark)
    signatures = flat.getElementsByClass(meter.TimeSignature)
    key_sigs = flat.getElementsByClass(key.KeySignature)

    bpm = 90
    if marks and marks[0].number:
        # Convert to quarter-note BPM (e.g. dotted-quarter = 60 in 6/8).
        bpm = round(marks[0].getQuarterBPM() or marks[0].number)
    ts = (signatures[0].numerator, signatures[0].denominator) if signatures else (4, 4)

    key_name = None
    if key_sigs:
        k = key_sigs[0] if isinstance(key_sigs[0], key.Key) else key_sigs[0].asKey()
        key_name = f"{k.tonic.name.replace('-', 'b')} {k.mode}"

    md = score.metadata
    title = (md.title or md.movementName) if md else None
    if title and title.startswith("upload."):  # music21 falls back to the temp file's name
        title = None
    artist = md.composer if md else None
    if artist == "Music21":  # music21's placeholder composer
        artist = None
    return SongMeta(
        title=title or fallback_title,
        artist=artist,
        tempo=max(20, min(300, bpm)),
        time_signature=ts,
        key=key_name,
    )


def _read_notes(score: stream.Score) -> list[NoteEvent]:
    parts = [p for p in score.parts if p.flatten().notes]
    piano = [p for p in parts if _is_piano(p)]
    if piano:
        parts = piano

    hands: list[str | None]
    if len(parts) == 1:
        hands = [None]  # split one staff at middle C
    else:
        # The part with the lowest average pitch is the left hand.
        averages = [_average_midi(p) for p in parts]
        lowest = averages.index(min(averages))
        hands = ["L" if i == lowest else "R" for i in range(len(parts))]

    events: list[NoteEvent] = []
    for part, hand in zip(parts, hands):
        # Tied notes are one held key press. music21's stripTies misses ties
        # inside chords, so merge them per pitch: midi -> the event still being held.
        open_ties: dict[int, NoteEvent] = {}
        for element in part.flatten().notes:
            if element.duration.isGrace or element.quarterLength <= 0:
                continue
            start = round(float(element.offset), 4)
            length = round(float(element.quarterLength), 4)
            members = element.notes if isinstance(element, chord.Chord) else [element]
            for member in members:
                name, midi = _from_m21_pitch(member.pitch)
                if not 21 <= midi <= 108:
                    continue
                tie = (member.tie or element.tie).type if (member.tie or element.tie) else None
                held = open_ties.get(midi)
                if held and tie in ("stop", "continue") and abs(held.start + held.duration - start) < 1e-3:
                    held.duration = round(held.duration + length, 4)
                    if tie == "stop":
                        del open_ties[midi]
                    continue
                event = NoteEvent(
                    pitch=name,
                    midi=midi,
                    start=start,
                    duration=length,
                    hand=hand or ("R" if midi >= MIDDLE_C else "L"),
                )
                events.append(event)
                if tie in ("start", "continue"):
                    open_ties[midi] = event
                else:
                    open_ties.pop(midi, None)
    return sort_notes(events)


def _is_piano(part: stream.Part) -> bool:
    inst = part.getInstrument(returnDefault=False)
    return isinstance(part, stream.PartStaff) or isinstance(inst, (instrument.Piano, instrument.KeyboardInstrument))


def _average_midi(part: stream.Part) -> float:
    pitches = [p.midi for n in part.flatten().notes for p in n.pitches]
    return sum(pitches) / len(pitches)


def sort_notes(events: list[NoteEvent]) -> list[NoteEvent]:
    return sorted(events, key=lambda n: (n.start, n.hand != "L", n.midi))
