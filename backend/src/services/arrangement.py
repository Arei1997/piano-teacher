from bisect import bisect_right
from fractions import Fraction

from src.schemas.arrangement import Arrangement
from src.schemas.song import Measure, NoteEvent, SongMeta
from src.services.music import MusicError, normalize_pitch, sort_notes


def measure_length(time_signature: tuple[int, int]) -> float:
    numerator, denominator = time_signature
    return numerator * 4 / denominator


def arrangement_to_notes(arrangement: Arrangement) -> tuple[list[NoteEvent], SongMeta, list[str]]:
    """Flatten the AI's measure-by-measure arrangement into absolute-time note events.

    Bad pitches or out-of-bar timings are skipped and reported as warnings rather
    than failing the whole song.
    """
    numerator, denominator = (int(x) for x in arrangement.time_signature.split("/"))
    meta = SongMeta(
        title=arrangement.title,
        artist=arrangement.artist,
        tempo=max(20, min(300, arrangement.tempo)),
        time_signature=(numerator, denominator),
        key=arrangement.key,
    )
    bar = measure_length(meta.time_signature)

    notes: list[NoteEvent] = []
    warnings: list[str] = []
    for measure in arrangement.measures:
        bar_start = (measure.number - 1) * bar
        for hand, events in (("R", measure.right_hand), ("L", measure.left_hand)):
            for event in events:
                if event.duration <= 0 or event.beat < 0 or event.beat >= bar:
                    warnings.append(f"m{measure.number}: skipped event at beat {event.beat}")
                    continue
                for i, raw in enumerate(event.pitches):
                    try:
                        name, midi = normalize_pitch(raw)
                    except MusicError as exc:
                        warnings.append(f"m{measure.number}: {exc}")
                        continue
                    finger = event.fingers[i] if i < len(event.fingers) else None
                    notes.append(
                        NoteEvent(
                            pitch=name,
                            midi=midi,
                            start=bar_start + event.beat,
                            duration=event.duration,
                            hand=hand,
                            finger=finger if finger in (1, 2, 3, 4, 5) else None,
                        )
                    )
    if not notes:
        raise MusicError("The arrangement came back without any playable notes.")
    return sort_notes(notes), meta, warnings


def describe_duration(beats: float) -> str:
    frac = Fraction(beats).limit_denominator(12)
    if frac.denominator == 1:
        return str(frac.numerator)
    whole, rest = divmod(frac.numerator, frac.denominator)
    return f"{whole} {rest}/{frac.denominator}" if whole else f"{rest}/{frac.denominator}"


def locate(start: float, measures: list[Measure], time_signature: tuple[int, int]) -> tuple[int, float]:
    """(bar number, offset into the bar) for a time, using the score's real barlines when known."""
    if measures:
        index = max(0, bisect_right([m.start for m in measures], start + 1e-6) - 1)
        return measures[index].number, start - measures[index].start
    bar = measure_length(time_signature)
    return int(start // bar) + 1, start % bar


def format_measures(notes: list[NoteEvent], measures: list[Measure], time_signature: tuple[int, int]) -> str:
    """Compact per-measure text for the chat model, e.g. 'm1: R A3(1/2)@0 G4+A4(1)@1/2 | L A2(4)@0'."""
    bars: dict[int, dict[str, dict[tuple[float, float, float], list[str]]]] = {}
    for n in notes:
        number, offset = locate(n.start, measures, time_signature)
        hands = bars.setdefault(number, {"R": {}, "L": {}})
        hands[n.hand].setdefault((n.start, n.duration, offset), []).append(n.pitch)

    lines = []
    for number in sorted(bars):
        parts = []
        for hand in ("R", "L"):
            groups = bars[number][hand]
            if groups:
                steps = " ".join(
                    f"{'+'.join(pitches)}({describe_duration(length)})@{describe_duration(offset)}"
                    for (_, length, offset), pitches in sorted(groups.items())
                )
                parts.append(f"{hand} {steps}")
        lines.append(f"m{number}: " + " | ".join(parts))
    return "\n".join(lines)
