import json

from src.schemas.arrangement import ArrangedEvent, ArrangedMeasure, Arrangement
from src.services import llm


def test_demo_song_is_seeded(client):
    songs = client.get("/api/songs").json()
    demo = next(s for s in songs if s["title"] == "Ode to Joy")
    song = client.get(f"/api/songs/{demo['id']}").json()
    assert len(song["notes"]) == 39
    # One grand-staff piano part: 8 bars, each with two staves.
    assert song["musicxml"].count("<measure") == 8
    assert "<staves>2</staves>" in song["musicxml"]


def test_import_musicxml_then_delete(client):
    demo_id = next(s["id"] for s in client.get("/api/songs").json() if s["title"] == "Ode to Joy")
    xml = client.get(f"/api/songs/{demo_id}").json()["musicxml"]

    response = client.post("/api/songs/import", files={"file": ("ode.musicxml", xml.encode(), "application/xml")})
    assert response.status_code == 201
    imported = response.json()
    assert imported["source"] == "import"
    assert len(imported["notes"]) == 39

    assert client.delete(f"/api/songs/{imported['id']}").status_code == 204
    assert client.get(f"/api/songs/{imported['id']}").status_code == 404


def test_update_notes_fixes_a_misread_chord_and_redraws(client):
    demo_id = next(s["id"] for s in client.get("/api/songs").json() if s["title"] == "Ode to Joy")
    song = client.get(f"/api/songs/{demo_id}").json()
    notes = [{k: n[k] for k in ("pitch", "start", "duration", "hand", "finger")} for n in song["notes"]]
    notes[0]["pitch"] = "bb4"  # correct a note, in loose spelling
    notes.pop()  # delete one

    response = client.put(f"/api/songs/{demo_id}/notes", json={"notes": notes})
    assert response.status_code == 200
    updated = response.json()
    assert len(updated["notes"]) == len(song["notes"]) - 1
    fixed = next(n for n in updated["notes"] if n["start"] == notes[0]["start"] and n["hand"] == notes[0]["hand"])
    assert (fixed["pitch"], fixed["midi"]) == ("Bb4", 70)
    assert "<alter>-1</alter>" in updated["musicxml"]  # the sheet was redrawn with the flat

    bad = client.put(f"/api/songs/{demo_id}/notes", json={"notes": [{**notes[0], "pitch": "H9"}]})
    assert bad.status_code == 422


def test_import_rejects_bad_file(client):
    response = client.post("/api/songs/import", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert response.status_code == 422


def test_generate_saves_ai_arrangement(client, monkeypatch):
    async def fake_generate(request):
        assert request.title == "Nobody's Fault But Mine"
        return Arrangement(
            title=request.title,
            artist=request.artist,
            tempo=70,
            time_signature="4/4",
            key="A minor",
            teacher_notes="Keep the left hand steady.",
            measures=[
                ArrangedMeasure(
                    number=1,
                    right_hand=[
                        ArrangedEvent(beat=0, pitches=["A3"], duration=0.5, fingers=[1]),
                        ArrangedEvent(beat=0.5, pitches=["G4", "A4"], duration=1, fingers=[]),
                    ],
                    left_hand=[ArrangedEvent(beat=0, pitches=["A2"], duration=4, fingers=[5])],
                )
            ],
        )

    monkeypatch.setattr(llm, "generate_arrangement", fake_generate)
    response = client.post("/api/songs/generate", json={"title": "Nobody's Fault But Mine", "artist": "Nina Simone"})
    assert response.status_code == 201
    song = response.json()
    assert song["source"] == "ai"
    assert [(n["pitch"], n["start"], n["duration"]) for n in song["notes"]] == [
        ("A2", 0, 4),
        ("A3", 0, 0.5),
        ("G4", 0.5, 1),
        ("A4", 0.5, 1),
    ]


def test_generate_surfaces_ai_errors(client, monkeypatch):
    async def failing(request):
        raise llm.LlmError("No valid AI API key.", 503)

    monkeypatch.setattr(llm, "generate_arrangement", failing)
    response = client.post("/api/songs/generate", json={"title": "Anything"})
    assert response.status_code == 503
    assert "API key" in response.json()["detail"]


def test_transcribe_rejects_non_sheet_files(client):
    response = client.post("/api/songs/transcribe", files=[("files", ("song.mp3", b"x", "audio/mpeg"))])
    assert response.status_code == 415


def test_chat_streams_server_sent_events(client, monkeypatch):
    seen = {}

    async def fake_stream(messages, song, position):
        seen.update(song=song.title if song else None, position=position)
        yield llm._sse({"type": "text", "text": "Hello "})
        yield llm._sse({"type": "done"})

    monkeypatch.setattr("src.routers.chat.stream_chat", fake_stream)
    demo_id = next(s["id"] for s in client.get("/api/songs").json() if s["title"] == "Ode to Joy")
    body = {"messages": [{"role": "user", "content": "How do I start?"}], "song_id": demo_id, "position": {"measure": 2, "beat": 1}}
    with client.stream("POST", "/api/chat", json=body) as response:
        events = [json.loads(line[6:]) for line in response.iter_lines() if line.startswith("data: ")]
    assert events == [{"type": "text", "text": "Hello "}, {"type": "done"}]
    assert seen["song"] == "Ode to Joy"
    assert seen["position"].measure == 2
