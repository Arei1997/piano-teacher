# Piano Teacher

Learn songs key by key. The app shows the sheet music, an 88-key piano that lights up the keys to press (blue = right hand, orange = left hand, with finger numbers), and the whole song written out as steps like **A3 · ½ beat → G4 + A4 · 1 beat**. A built-in AI teacher answers questions about the song you're on.

## Features

- **Three ways to add a song**
  - **AI arrangement**: type a title and artist (e.g. *Nobody's Fault But Mine*, Nina Simone), pick a level, and the AI writes a playable arrangement.
  - **Photo / PDF of a sheet**: upload screenshots, phone photos or a PDF of printed music and the AI transcribes it.
  - **MusicXML / MIDI import**: the most accurate option (e.g. downloads from MuseScore.com).
- **Listen mode**: real piano sound, with the sheet cursor, piano keys and step list following along. Adjustable speed (25–150%) and bar looping.
- **Wait-for-me mode**: the app waits on each step until you play the right keys, then marks hits green and wrong keys red.
- **Practice one hand or both.**
- **Input**: USB MIDI keyboard / digital piano (Web MIDI), tapping the on-screen keys, or the computer keyboard (`A`–`;` white keys, `W E T Y U O P` black keys, `Z`/`X` change octave).
- **AI teacher chat** that knows the song's notes and which bar you're on.

## Stack

| Part | Tech |
| --- | --- |
| Backend | FastAPI, SQLAlchemy (SQLite), music21 for notation import/export, LLM API for the AI teacher, arrangements and transcription |
| Frontend | React + TypeScript + Vite, OpenSheetMusicDisplay (sheet rendering), Tone.js (piano audio), Web MIDI |

## Setup

Requires Python 3.12+ and Node 20+ with pnpm.

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env            # then put your key in AI_API_KEY
uvicorn src.main:app --reload --port 8000

# Frontend (second terminal)
cd frontend
pnpm install
pnpm dev                          # http://localhost:5173
```

Without an API key, everything except the AI features works: the demo song, file import, playback and MIDI practice.

## Using it on your phone with your piano

1. Run the backend as above, then start the frontend with `pnpm dev:phone`. It prints a `Network: https://192.168.x.x:5173` address.
2. Open that address on your phone (same Wi-Fi). Accept the self-signed certificate warning.
3. Plug the piano into the phone (USB OTG adapter) and press **Connect MIDI keyboard**.

Web MIDI works in Chrome on Android. Safari on iPhone and iPad doesn't support Web MIDI, so on iOS you can watch, listen and tap the screen keys, but the app can't hear your piano.

## Tests

```bash
cd backend && .venv\Scripts\python -m pytest
cd frontend && pnpm lint && pnpm build
```

## Notes and limitations

- AI arrangements follow the song as commonly played. They aren't an exact copy of a specific recording.
- Photo transcription is good, not perfect. Check tricky bars against the original.
- Repeats and voltas are played straight through as written, not expanded.
