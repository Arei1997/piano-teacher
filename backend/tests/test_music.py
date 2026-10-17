import tempfile
from pathlib import Path

import pytest
from music21 import chord, corpus, meter, note, stream, tempo

from src.schemas.arrangement import ArrangedEvent, ArrangedMeasure, Arrangement
from src.schemas.song import Measure, NoteEvent, SongMeta
from src.services.arrangement import arrangement_to_notes, describe_duration, format_measures, locate
from src.services.music import MusicError, build_musicxml, normalize_pitch, parse_file


def ev(pitch, start, length, hand):
    name, midi = normalize_pitch(pitch)
    return NoteEvent(pitch=name, midi=midi, start=start, duration=length, hand=hand)


def signature(notes):
    return sorted((n.hand, n.pitch, n.start, n.duration) for n in notes)


@pytest.mark.parametrize(
    "raw, expected",
    [("C4", ("C4", 60)), ("a0", ("A0", 21)), ("C8", ("C8", 108)), ("Bb3", ("Bb3", 58)), ("F#5", ("F#5", 78)), ("E♭4", ("Eb4", 63))],
)
def test_normalize_pitch(raw, expected):
    assert normalize_pitch(raw) == expected


@pytest.mark.parametrize("raw", ["H4", "C", "G#9", "Ab0"])
def test_normalize_pitch_rejects(raw):
    with pytest.raises(MusicError):
        normalize_pitch(raw)


def test_musicxml_round_trip_keeps_held_notes_chords_and_ties():
    notes = [
        ev("A3", 0, 0.5, "R"),
        ev("G4", 0.5, 1, "R"),
        ev("A4", 0.5, 1, "R"),
        ev("Bb4", 1.5, 3, "R"),  # tied over the barline
        ev("A2", 0, 4, "L"),  # held under a moving note
        ev("E3", 1, 0.5, "L"),
        ev("C3", 4, 2, "L"),
    ]
    xml, measures = build_musicxml(notes, SongMeta(title="Test", tempo=72, key="A minor"))
    assert [(m.number, m.start, m.length) for m in measures] == [(1, 0, 4), (2, 4, 4)]
    back, meta, _, _ = parse_file(xml.encode(), "test.musicxml")
    assert signature(back) == signature(notes)
    assert (meta.title, meta.tempo, meta.key, meta.time_signature) == ("Test", 72, "A minor", (4, 4))


def test_pickup_bar_is_kept_in_measure_positions():
    path = Path(corpus.getWork("joplin/maple_leaf_rag"))
    notes, meta, _, measures = parse_file(path.read_bytes(), "maple_leaf_rag.mxl")
    assert meta.title == "Maple Leaf Rag"
    assert meta.time_signature == (2, 4)
    assert (measures[0].number, measures[0].length) == (0, 0.5)  # eighth-note pickup
    assert (measures[1].number, measures[1].start) == (1, 0.5)
    assert locate(0.75, measures, meta.time_signature) == (1, 0.25)
    assert {n.hand for n in notes} == {"R", "L"}


def test_midi_import_splits_single_track_at_middle_c():
    part = stream.Part()
    part.append(tempo.MetronomeMark(number=120))
    part.append(meter.TimeSignature("4/4"))
    part.append(chord.Chord(["C3", "G3", "E4"], quarterLength=2))
    part.append(note.Note("D4", quarterLength=2))
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "song.mid"
        stream.Score([part]).write("midi", fp=str(path))
        notes, meta, xml, _ = parse_file(path.read_bytes(), "song.mid")
    assert signature(notes) == [("L", "C3", 0.0, 2.0), ("L", "G3", 0.0, 2.0), ("R", "D4", 2.0, 2.0), ("R", "E4", 0.0, 2.0)]
    assert meta.tempo == 120
    assert "<score-partwise" in xml


def test_parse_file_rejects_unknown_extension():
    with pytest.raises(MusicError):
        parse_file(b"nope", "song.txt")


def test_arrangement_to_notes_converts_measures_to_absolute_time():
    arrangement = Arrangement(
        title="Blues",
        artist=None,
        tempo=80,
        time_signature="3/4",
        key="G major",
        teacher_notes="",
        measures=[
            ArrangedMeasure(
                number=2,
                right_hand=[ArrangedEvent(beat=0.5, pitches=["G4", "B4"], duration=1, fingers=[1, 3])],
                left_hand=[
                    ArrangedEvent(beat=0, pitches=["G2"], duration=3, fingers=[]),
                    ArrangedEvent(beat=3, pitches=["D3"], duration=1, fingers=[]),  # outside a 3/4 bar
                    ArrangedEvent(beat=1, pitches=["X9"], duration=1, fingers=[]),  # bad pitch
                ],
            )
        ],
    )
    notes, meta, warnings = arrangement_to_notes(arrangement)
    assert meta.time_signature == (3, 4)
    assert [(n.hand, n.pitch, n.start, n.finger) for n in notes] == [("L", "G2", 3.0, None), ("R", "G4", 3.5, 1), ("R", "B4", 3.5, 3)]
    assert len(warnings) == 2


def test_format_measures_for_chat_context():
    notes = [ev("A3", 0, 0.5, "R"), ev("G4", 0.5, 1, "R"), ev("A4", 0.5, 1, "R"), ev("A2", 0, 4, "L"), ev("C4", 4, 4, "R")]
    expected = "m1: R A3(1/2)@0 G4+A4(1)@1/2 | L A2(4)@0\nm2: R C4(4)@0"
    assert format_measures(notes, [], (4, 4)) == expected
    regular = [Measure(number=1, start=0, length=4), Measure(number=2, start=4, length=4)]
    assert format_measures(notes, regular, (4, 4)) == expected


def test_describe_duration():
    assert [describe_duration(x) for x in (0.25, 1, 1.5, 1 / 3)] == ["1/4", "1", "1 1/2", "1/3"]
