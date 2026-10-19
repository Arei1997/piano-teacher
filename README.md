# Piano Teacher

Learn songs key by key. The app shows the sheet music, an 88-key piano that lights up the keys to press (blue = right hand, orange = left hand, with finger numbers), and the whole song written out as steps like **A3 · ½ beat → G4 + A4 · 1 beat**. A built-in AI teacher answers questions about the song you're on.

## Features

- **Three ways to add a song**
  - **AI arrangement**: type a title and artist (e.g. *Nobody's Fault But Mine*, Nina Simone), pick a level, and the AI writes a playable arrangement.
  - **Photo / PDF of a sheet**: upload screenshots, phone photos or a PDF of printed music and the AI transcribes it.
  - **MusicXML / MIDI import**: the most accurate option (e.g. downloads from MuseScore.com).
- **Listen mode**: real piano sound, with the sheet cursor, piano keys and step list following along. Adjustable speed (25–150%) and bar looping.
- **Wait-for-me mode**: the app waits on each step until you play the right keys, then marks hits green and wrong keys red.
- **Falling notes**: a Guitar Hero–style view where notes fall down each key's lane and reach the keyboard exactly when you should play them. Works in every mode.
- **Game mode**: play your hand in time while the song (and the other hand) plays on. Notes are graded Perfect / Good / Miss, combos build a ×2–×4 multiplier, and each run ends with a score, accuracy, rank (S–D) and your best score for that song.
- **Train mode (muscle memory)**: loops a short passage starting slow (60%); every clean repetition (90%+, wrong notes count) climbs the speed ladder, a sloppy one drops back. Three clean reps in a row at full speed masters the passage, then move on to the next bars or join them up.
- **Practice section**: generated exercises in any key with standard fingerings — five-finger patterns, major/minor scales (1–2 octaves), arpeggios, Hanon No. 1, I–IV–V–I chord progressions and a 12-bar blues left hand — plus a 10-minute warm-up routine.
- **Particle effects & themes**: hit sparks, lane beams, combo milestones and a countdown, in Neon, Sunset, Ocean, Forest, High-contrast or Classic.
- **Note editor**: fix any misread note (raise/lower, delete, change length, add) straight from the step list; the sheet redraws to match.
- **Practice one hand or both.**
- **Input**: USB MIDI keyboard / digital piano (Web MIDI), tapping the on-screen keys, or the computer keyboard (`A`–`;` white keys, `W E T Y U O P` black keys, `Z`/`X` change octave).
- **AI teacher chat** that knows the song's notes and which bar you're on.

## Stack

| Part | Tech |
| --- | --- |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (SQLite or Postgres), music21 (notation import/export), Pillow (sheet photo preparation), an LLM API for the AI features |
| Frontend | React 19 + TypeScript + Vite, OpenSheetMusicDisplay (sheet rendering), Tone.js (piano audio and timing), Web MIDI, react-markdown (chat replies) |
| Hosting | One Docker container (FastAPI serves the API and the built frontend), Render blueprint, installable as a phone app (PWA) |

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

Without an API key, everything except the AI features works: the demo song, file import, exercises, playback and MIDI practice.

## Hosting it (use it anywhere as a phone app)

The `Dockerfile` builds one container: FastAPI serves the API and the built frontend. Once it runs at an `https://` address, open it in Chrome on Android and tap **Install app** / **Add to Home screen** — it then runs full screen from its own icon, MIDI included.

Settings (environment variables):

| Variable | What it's for |
| --- | --- |
| `AI_API_KEY` | AI teacher, arrangements and scanning |
| `AI_WORKSPACE_ID` | only if your key isn't tied to a workspace |
| `AI_MODEL` | optional: override the model used for all AI features |
| `APP_PASSWORD` | required login, so nobody else can use your key |
| `SESSION_SECRET` | any long random string; keeps you logged in across restarts |
| `DATABASE_URL` | Postgres connection string (e.g. a free [Neon](https://neon.tech) database). Without it, SQLite at `/data` (mount a volume there) |

**Render** (free tier): create a Postgres database on Neon and copy its connection string, then in Render choose **New → Blueprint**, pick this repo (it reads `render.yaml`) and fill in the variables. Every push to `main` redeploys. Free instances sleep when idle, so the first visit after a while takes about a minute.

Run the production build locally with Docker:

```bash
docker build -t piano-teacher .
docker run -p 8000:8000 -e APP_PASSWORD=change-me -e SESSION_SECRET=some-long-random-string -v piano-data:/data piano-teacher
```

## Using it on your phone over home Wi-Fi (no hosting)

1. Run the backend as above, then start the frontend with `pnpm dev:phone`. It prints a `Network: https://192.168.x.x:5173` address.
2. Open that address on your phone (same Wi-Fi). Accept the self-signed certificate warning.
3. Plug the piano into the phone (USB OTG adapter) and press **Connect MIDI keyboard**.

Web MIDI works in Chrome on Android. Safari on iPhone and iPad doesn't support Web MIDI, so on iOS you can watch, listen and tap the screen keys, but the app can't hear your piano.

## How it works

### Architecture

```
 Browser (React app)                          Server (FastAPI)                     External
 ───────────────────                          ────────────────                     ────────
 sheet (OSMD) · piano · steps    ── /api ──▶  routers/  songs · chat · exercises
 falling notes · game HUD · chat              services/ music      (music21)
 Tone.js audio + clock                                  arrangement (AI output → notes)
 Web MIDI / screen / keyboard input                     exercises   (generated drills)
 localStorage (settings, best scores)                   sheet_images (photo prep)
                                                        llm ───────────────────────▶  LLM API
                                              models/   Song ──▶ SQLite / Postgres
 piano samples ◀──────────────────────────────────────────────────────────────────── tonejs.github.io
```

- **Development:** Vite serves the frontend on `:5173` and proxies `/api` to FastAPI on `:8000`, so the browser only ever talks to one origin.
- **Production:** `pnpm build` output is copied into the container and FastAPI serves it (`serve_frontend` in `backend/src/main.py`). Hashed `/assets/*` files are cached for a year; every other path falls back to `index.html` for the single-page app.
- On startup the server creates the database tables (`create_all`, no migrations yet) and seeds a demo song (Beethoven's *Ode to Joy*) if it's missing.

### The song model

Every song, wherever it came from, becomes the same thing: a **flat list of note events**.

```jsonc
{ "pitch": "Bb3", "midi": 58, "start": 4.5, "duration": 0.5, "hand": "L", "finger": 2 }
```

- `start` and `duration` are in **quarter notes from the start of the song**, so tempo changes never touch the data.
- `pitch` keeps the score's spelling (Bb3, not A#3); `midi` is the key number (21 = A0 … 108 = C8).
- Alongside the notes, each song stores its **barlines** (`measures: [{number, start, length}]`) read from the engraved score. Bar and beat labels always come from these, so pickup bars (bar 0) and odd-length bars are labelled correctly.
- It also stores the **MusicXML** used to draw the sheet, plus key, tempo, time signature and optional teacher notes.

Everything the app does (playback, the step list, the falling notes, scoring, the chat context) works off the note list. The sheet music is display only.

### Getting songs in

| Source | Pipeline | Uses AI |
| --- | --- | --- |
| **MusicXML / MXL** | music21 parses the file → note events. The original MusicXML is kept for display. | No |
| **MIDI** | music21 parses the file → note events → re-engraved as a two-staff piano score (MIDI carries no layout). | No |
| **AI arrangement** | The model writes the song measure by measure → validated and flattened into note events → engraved. | Yes |
| **Photo / PDF scan** | Images are prepared (below) → the model transcribes them in the same measure-by-measure format → flattened → engraved. | Yes |
| **Practice exercises** | Built in code from scales and fixed patterns (`services/exercises.py`) → engraved. Saved once per key and type, then reused, so best scores and edits carry over. | No |

**Importing files** (`services/music.py → parse_file`):
- Only piano parts are kept when the file has other instruments. With two or more parts, the one with the lowest average pitch is the left hand. A single staff is split at middle C.
- Tied notes become one long key press (including ties inside chords, which music21's own `stripTies` misses). Grace notes and anything outside the 88 keys are dropped.
- Title, composer, key, time signature and tempo come from the file. Tempo is converted to quarter-note BPM, so dotted-quarter = 60 in 6/8 becomes 90.

**Flattening AI output** (`services/arrangement.py → arrangement_to_notes`):
- Each event's position becomes `(measure − 1) × bar length + beat`, then snaps to a 1/24-beat grid. That turns float noise like `0.333` into exact triplets.
- Bad pitches, events outside their bar or zero-length notes are skipped rather than failing the whole song. The skipped items are appended to the song's teacher notes so you can see what went missing.
- Tempo is clamped to 20–300 BPM. Fingers outside 1–5 are dropped.

**Engraving** (`services/music.py → build_musicxml`): notes are grouped into chords per hand, written to a treble and a bass staff joined by a brace, and music21's `chordify` and `makeNotation` turn overlapping notes into tied, writable rhythms. Some overlapping rhythms can't be written exactly. In that case it retries on coarser grids (exact → 16ths + triplets → 16ths → 8ths). This only affects the picture: the notes used for playback and practice are never rounded.

**Editing notes** (`PUT /api/songs/{id}/notes`): the step list sends back the full corrected note list. The server re-normalises pitches, re-engraves the sheet and recomputes the barlines. An imported MusicXML file is replaced by the re-engraved version once you edit it.

### Practice engine (frontend)

All practice logic runs in the browser (`hooks/usePlayer.ts`, `lib/game.ts`, `lib/music.ts`). Nothing is sent to the server while you play.

- **Steps.** Notes starting at the same moment form one step. That's the unit of the step list, wait mode and the sheet cursor. Each step gets its bar and beat from the stored barlines.
- **Audio and clock.** Tone.js plays the Salamander Grand Piano samples (one sample every minor third, pitch-shifted in between). They load on your first tap, as browsers require. Playback is scheduled on Tone's transport. The song position is read from the audio clock every animation frame, so the keys, cursor and falling notes match what you hear. The transport runs 16 beats ahead of the song so a game can start before beat 0 and give the first notes time to fall.
- **Listen:** the whole song plays. The current step, the keys that should be sounding and the sheet cursor follow along. Looping repeats the chosen bars.
- **Wait for me:** nothing plays. The current step's keys (for the chosen hand) must all be down before it advances. A wrong key flashes red and doesn't advance.
- **Game:** the song plays on. Only the hand you're *not* practising is played for you, as accompaniment. Each of your notes is a target judged by timing in **seconds**, so it feels the same at any speed: within 80 ms = Perfect (100 pts), within 180 ms = Good (50 pts), later = Miss. Every 10 hits in a row raise the multiplier (up to ×4). A wrong key breaks the combo but costs no points. Rank: S (95%+ accuracy, no misses), A 85%, B 70%, C 50%, D below.
- **Train:** game scoring on a looped passage. Each pass is a repetition scored as hits ÷ (hits + misses + wrong notes). A pass of 90% or better is clean and raises the tempo by 10% (starting from 60%, up to 100%). A sloppy pass drops it 10%. Three clean passes in a row at 100% master the passage.
- **Sheet cursor.** OpenSheetMusicDisplay renders the MusicXML as SVG. Its cursor is stepped forward to the current step's timestamp.
- **Falling notes.** A `<canvas>` drawn every frame. Notes take 3 seconds to fall to the keys. Hits, misses and combo milestones go through a small event channel (`lib/effects.ts`) straight to the canvas, bypassing React re-renders.
- **Input.** Web MIDI note-on/note-off messages, on-screen key taps and the computer keyboard all feed the same `registerPress` function, so every mode works with any input. MIDI needs a secure page (`https://` or `localhost`).
- **Screen wake lock** keeps a phone awake during practice, since your hands are on the piano and not the screen.

### Storage

| Where | What |
| --- | --- |
| Server database (`songs` table) | One row per song: title, artist, source (`import` / `ai` / `scan` / `exercise`), tempo, key, time signature, the note list and barlines (JSON), the display MusicXML, teacher notes. |
| Browser `localStorage` | Per-device preferences: last opened song, theme, key size, labels, collapsed panels, options, and **best game scores** (per song and hand). |
| Browser memory only | Chat conversations. They disappear when you reload or press **New conversation**. |

### Login and offline use

- **Login** is off unless `APP_PASSWORD` is set. When it is, every `/api` route except login and health needs a session cookie. The cookie is an HMAC of the password, signed with `SESSION_SECRET`, so changing the password logs every device out.
- **Service worker** (`frontend/public/sw.js`): built assets and piano samples are cached forever (they never change), pages are network-first with an offline fallback, and the API is never cached.

### API

| Method & path | Does |
| --- | --- |
| `GET /api/health` | Status, whether the AI key is set, whether login is needed or done |
| `POST /api/login` · `POST /api/logout` | Password login (only when `APP_PASSWORD` is set) |
| `GET /api/songs` | Song library (exercises excluded) |
| `GET /api/songs/{id}` · `DELETE /api/songs/{id}` | Fetch or delete one song |
| `POST /api/songs/import` | Upload a MusicXML / MXL / MIDI file |
| `POST /api/songs/generate` | AI arrangement from title, artist, level, hands and requests |
| `POST /api/songs/transcribe` | AI transcription of PNG / JPEG / WebP / GIF / PDF pages (max 20 MB each) |
| `PUT /api/songs/{id}/notes` | Save corrected notes and re-engrave the sheet |
| `POST /api/exercises` | Build (or reopen) a generated exercise |
| `POST /api/chat` | AI teacher reply, streamed as server-sent events |

Interactive docs are at `http://localhost:8000/docs` while the backend is running.

## How the AI is used

The AI is used in **exactly three places**, all on the server in `backend/src/services/llm.py`, with the instructions it follows in `backend/src/prompts/teacher.py`. The browser never talks to the AI provider directly, and the API key never leaves the server.

| Feature | When it runs | What is sent | What comes back |
| --- | --- | --- | --- |
| **Arrange a song** | Once, when you create the song | Title, artist, level, which hands, and your extra requests | A structured arrangement (below) |
| **Transcribe a sheet** | Once, when you upload pages | The page images / PDFs and an optional title | The same structured format |
| **Teacher chat** | Each message you send | The conversation so far, the current song's notes and the bar you're on | Text, streamed word by word |

### 1. Arranging a song

- A single request asks the model to arrange the named song for piano at the chosen level. The instructions tell it to stay faithful to the melody, harmony and feel; to put the melody in the right hand and bass/harmony in the left; to add fingerings; and to say in the teacher notes when it isn't sure of the exact notes. Each level has rules: beginner is single notes, nothing faster than eighths, 8–16 bars; intermediate is 16–32 bars with simple left-hand chords; advanced is a full arrangement.
- The reply is forced into a fixed JSON schema (`schemas/arrangement.py`) using structured outputs: title, tempo, time signature, key, teacher notes, and a list of measures. Each measure lists right- and left-hand events as `{beat, pitches, duration, fingers}`. The model writes bar by bar because it is far more accurate that way than with absolute times. The server then converts the measures to note events (see *Flattening AI output*).
- Settings: high reasoning effort, up to 64,000 output tokens, streamed so long songs don't hit HTTP timeouts.

### 2. Transcribing sheet music

- Phone photos and screenshots often have note heads only a few pixels tall, so each image is prepared first (`services/sheet_images.py`). It is rotated upright from its EXIF data, and the whole page is scaled to a 1,568-pixel long edge (the largest size the model uses) for layout and bar order. The page is also cut into about three horizontal slices, through the white space between systems, and each slice is enlarged to the same size so pitches can be read. PDFs are sent as documents, unchanged.
- The instructions read like a copyist's checklist. Transcribe only the piano staves (skip vocal lines and guitar boxes). Place each note head on its line or space before naming it, with the clef lines spelled out and ledger lines checked. Apply key signatures, accidentals, ties and 8va markings. Write repeats once, as printed. List any guesses in the teacher notes.
- The output uses the same schema and settings as arrangements, and goes through the same validation.

### 3. The teacher chat

- The system prompt sets up a warm, practical piano teacher that refers to exact bars and keys ("measure 5: right hand G4+A4 for 1 beat").
- When a song is open, the server adds its **full note list** as compact text, one line per bar, for example `m5: R G4+A4(1)@1/2 | L A2(4)@0`. This part of the prompt is cached by the provider, so follow-up questions about the same song are faster and cheaper. The player's current position (`Measure 12, beat 3`) is prepended to your latest message, so "how do I play this bar?" works.
- The reply streams back as server-sent events and is rendered as Markdown. The conversation history lives only in the browser: it is sent with each message (up to 100 messages) and is never saved on the server.
- Settings: medium reasoning effort, up to 16,000 output tokens.

### What the AI does *not* do

- **Nothing during practice.** Playback, wait mode, game scoring, training, the falling notes, the step list and the sheet cursor are all ordinary code running in your browser. A song costs AI calls only when it's created (arrangement or scan), plus whatever chat messages you send.
- **No AI in imports, exercises or editing.** MusicXML/MIDI import, engraving, the practice exercises and the note editor are deterministic.
- **Once a song is saved, it's plain data.** AI-made songs are stored like any other and are never regenerated. You can correct them by hand with the note editor.
- **Your playing is never sent anywhere.** MIDI input, scores and progress stay on the device.

### Safety nets

- Every AI reply must match the schema, and every note is checked (valid pitch, inside its bar, positive length) before it is saved. Bad items are skipped and listed in the teacher notes instead of breaking the song.
- If the provider's safety check declines a request, the API retries it on a fallback model. If it's still declined, you see a clear message.
- A reply that runs out of space gives "The song was too long to finish in one go. Try a shorter section." instead of a half-finished song.
- A missing or invalid key, a rate limit or a network problem each produce a plain-English error. The rest of the app keeps working without a key, and `GET /api/health` reports `ai_configured` so the UI can show the teacher as off.

## Tests

```bash
cd backend && .venv\Scripts\python -m pytest
cd frontend && pnpm test && pnpm lint && pnpm build
```

Backend tests cover the API, MusicXML/MIDI import and engraving, exercises, sheet-image slicing and hosting/login. AI features are tested with the model call stubbed out (saving an arrangement, error handling, chat streaming), so the tests need no API key and make no paid calls. Frontend tests (Vitest) cover game scoring and the training ladder.

## Notes and limitations

- AI arrangements follow the song as commonly played. They aren't an exact copy of a specific recording.
- Photo transcription is good, not perfect. Check tricky bars against the original.
- Repeats and voltas are played straight through as written, not expanded.
- Tempo is one value per song. Tempo changes in the middle of a piece aren't followed.
- Best scores are stored per device, not on the server.
