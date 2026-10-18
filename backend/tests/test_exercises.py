import pytest

from src.schemas.exercise import ExerciseRequest
from src.services.exercises import build_exercise
from src.services.music import MusicError, build_musicxml


def run(**kwargs):
    notes, meta, title, tips = build_exercise(ExerciseRequest(**kwargs))
    return notes, meta, title


def right(notes):
    return [n for n in notes if n.hand == "R"]


def test_major_scale_is_spelled_for_its_key_with_fingering():
    notes, meta, title = run(kind="scale", key="Bb", scale="major", hands="right")
    assert [n.pitch for n in notes][:8] == ["Bb3", "C4", "D4", "Eb4", "F4", "G4", "A4", "Bb4"]
    assert [n.pitch for n in notes][8:] == ["A4", "G4", "F4", "Eb4", "D4", "C4", "Bb3"]  # and back down
    assert title == "Bb major scale · 1 octave · right hand"
    assert meta.key == "Bb major"


def test_c_scale_two_octaves_hands_together_has_standard_fingering():
    notes, _, _ = run(kind="scale", key="C", hands="both", octaves=2)
    rh = [n.finger for n in notes if n.hand == "R"]
    lh = [n.finger for n in notes if n.hand == "L"]
    assert rh[:15] == [1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5]
    assert lh[:15] == [5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1]
    # Left hand plays an octave below, in step with the right.
    pairs = {n.start: n.midi for n in notes if n.hand == "R"}
    assert all(pairs[n.start] - n.midi == 12 for n in notes if n.hand == "L")
    # Ends on a full 4/4 bar.
    assert max(n.start + n.duration for n in notes) % 4 == 0


def test_harmonic_minor_raises_the_seventh():
    notes, _, _ = run(kind="scale", key="A", scale="harmonic minor")
    assert [n.pitch for n in notes][:8] == ["A3", "B3", "C4", "D4", "E4", "F4", "G#4", "A4"]


def test_unknown_fingering_is_left_blank_rather_than_guessed():
    notes, _, _ = run(kind="scale", key="Ab", scale="major")
    assert all(n.finger is None for n in notes)


def test_five_finger_pattern():
    notes, _, _ = run(kind="five_finger", key="G", hands="left")
    # Left hand sits an octave below the right hand's G4 position.
    assert [n.pitch for n in notes] == ["G3", "A3", "B3", "C4", "D4", "C4", "B3", "A3", "G3"]
    assert [n.finger for n in notes] == [5, 4, 3, 2, 1, 2, 3, 4, 5]


def test_arpeggio_two_octaves():
    notes, _, _ = run(kind="arpeggio", key="D", scale="major", octaves=2)
    assert [n.pitch for n in right(notes)][:7] == ["D4", "F#4", "A4", "D5", "F#5", "A5", "D6"]


def test_hanon_no_1_pattern():
    notes, _, _ = run(kind="hanon", hands="both")
    rh = right(notes)
    assert [n.pitch for n in rh[:16]] == ["C4", "E4", "F4", "G4", "A4", "G4", "F4", "E4", "D4", "F4", "G4", "A4", "B4", "A4", "G4", "F4"]
    assert len(rh) == 28 * 8 + 1
    assert rh[-1].pitch == "C4"
    lh = [n for n in notes if n.hand == "L"]
    assert lh[0].pitch == "C2" and lh[0].finger == 5


def test_minor_cadence_uses_the_raised_leading_tone():
    notes, _, title = run(kind="chords", key="A", scale="harmonic minor", hands="right")
    v_chord = sorted(n.pitch for n in notes if n.start == 8)
    assert v_chord == ["B3", "E4", "G#3"]
    assert "i–iv–V–i" in title


def test_blues_left_hand_spells_flat_sevenths():
    notes, _, _ = run(kind="blues", key="C")
    pitches = {n.pitch for n in notes}
    assert "Bb3" in pitches and "A#3" not in pitches
    assert max(n.start + n.duration for n in notes) == 48  # 12 bars


def test_unavailable_key_is_rejected():
    with pytest.raises(MusicError):
        run(kind="scale", key="D#", scale="major")


@pytest.mark.parametrize("kind", ["five_finger", "scale", "arpeggio", "hanon", "chords", "blues"])
def test_every_exercise_engraves(kind):
    notes, meta, _ = run(kind=kind, key="A" if kind == "blues" else "C", hands="both", octaves=2)
    xml, measures = build_musicxml(notes, meta)
    assert "<score-partwise" in xml and measures


def test_api_reuses_the_saved_exercise_and_hides_it_from_the_library(client):
    first = client.post("/api/exercises", json={"kind": "scale", "key": "G"}).json()
    again = client.post("/api/exercises", json={"kind": "scale", "key": "G"}).json()
    assert first["id"] == again["id"]
    assert first["source"] == "exercise"
    assert all(s["id"] != first["id"] for s in client.get("/api/songs").json())
    assert client.post("/api/exercises", json={"kind": "blues", "key": "F#"}).status_code == 422
