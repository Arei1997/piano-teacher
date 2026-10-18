import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AddSongDialog } from './components/AddSongDialog'
import { ChatPanel } from './components/ChatPanel'
import type { View } from './components/Controls'
import { Controls } from './components/Controls'
import { GameHud, GameResults } from './components/GameHud'
import type { KeyMark } from './components/Piano'
import { Piano } from './components/Piano'
import { SheetMusic } from './components/SheetMusic'
import { SongLibrary } from './components/SongLibrary'
import type { NoteEdit } from './components/StepList'
import { NowNext, StepList } from './components/StepList'
import { Waterfall } from './components/Waterfall'
import type { InputSource } from './hooks/useNoteInput'
import { useNoteInput } from './hooks/useNoteInput'
import { usePlayer } from './hooks/usePlayer'
import { useWakeLock } from './hooks/useWakeLock'
import { api } from './lib/api'
import { loadPiano, noteOff, noteOn } from './lib/audio'
import type { Song, SongSummary } from './lib/music'
import { inHands } from './lib/music'
import { themeById, themeStyle } from './lib/themes'

type Tab = 'sheet' | 'steps' | 'chat' | 'notes'

const LAST_SONG_KEY = 'pianoteacher:lastSong'
const THEME_KEY = 'pianoteacher:theme'

// Per-device preferences; storage can be unavailable (private mode), so failures are ignored.
function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

function readLastSong() {
  return Number(readSetting(LAST_SONG_KEY)) || null
}

export default function App() {
  const [songs, setSongs] = useState<SongSummary[]>([])
  const [song, setSong] = useState<Song | null>(null)
  const [aiReady, setAiReady] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [tab, setTab] = useState<Tab>('sheet')
  const [soundOnMidi, setSoundOnMidi] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const player = usePlayer(song)
  useWakeLock(Boolean(song))
  const [view, setView] = useState<View>('sheet')
  const [themeId, setThemeIdState] = useState(() => readSetting(THEME_KEY) ?? 'neon')
  const setThemeId = (id: string) => {
    setThemeIdState(id)
    writeSetting(THEME_KEY, id)
  }
  const theme = themeById(themeId)
  const themed = Boolean(song) && view === 'falling'

  // Note corrections show instantly and save (and redraw the sheet) shortly after the last change.
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef(0)
  const editVersion = useRef(0)
  function editNotes(edit: NoteEdit) {
    if (!song) return
    let notes = song.notes
    for (const [from, to] of edit.replace ?? []) {
      notes = to ? notes.map((n) => (n === from ? to : n)) : notes.filter((n) => n !== from)
    }
    notes = [...notes, ...(edit.add ?? [])]
    if (!notes.length) return
    setSong({ ...song, notes })
    const version = ++editVersion.current
    setSaving(true)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      try {
        const saved = await api.updateNotes(song.id, notes)
        // Ignore a reply that a newer edit has already superseded.
        if (version === editVersion.current) setSong((current) => (current?.id === saved.id ? saved : current))
      } catch (e) {
        setError(`Could not save your change: ${(e as Error).message}`)
      } finally {
        if (version === editVersion.current) setSaving(false)
      }
    }, 700)
  }
  const { steps, stepIndex, mode, hands, wait } = player

  const openSong = useCallback(async (id: number) => {
    try {
      setSong(await api.getSong(id))
      setLibraryOpen(false)
      try {
        localStorage.setItem(LAST_SONG_KEY, String(id))
      } catch {
        /* storage unavailable */
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    api.health().then((h) => setAiReady(h.ai_configured), () => setError('Cannot reach the backend. Is it running on port 8000?'))
    api.listSongs().then((list) => {
      setSongs(list)
      const last = readLastSong()
      const pick = list.find((s) => s.id === last) ?? list[0]
      if (pick) openSong(pick.id)
    }, () => undefined)
  }, [openSong])

  const input = useNoteInput({
    onNoteOn: (midi: number, velocity: number, source: InputSource) => {
      if (source !== 'midi' || soundOnMidi) {
        loadPiano().then(() => noteOn(midi, velocity))
      }
      player.registerPress(midi)
    },
    onNoteOff: (midi: number) => noteOff(midi),
  })

  // Space toggles playback in listen and game modes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName)
      if (e.code !== 'Space' || typing || mode === 'wait') return
      e.preventDefault()
      if (player.playing) player.pause()
      else player.play()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, player])

  const current = steps[stepIndex]
  const nextIndex = mode === 'wait' ? wait.nextIndex : steps.findIndex((s, i) => i > stepIndex && s.notes.some((n) => inHands(n, hands)))
  const next = steps[nextIndex]

  // What the piano shows: keys to press now (by hand, with fingers), the next keys, and hits/misses.
  const marks = useMemo(() => {
    const result = new Map<number, KeyMark>()
    for (const n of next?.notes ?? []) {
      if (inHands(n, hands)) result.set(n.midi, { kind: 'next', hand: n.hand, label: n.pitch })
    }
    if (mode === 'wait') {
      for (const n of current?.notes ?? []) {
        if (!inHands(n, hands)) continue
        result.set(n.midi, wait.hits.has(n.midi) ? { kind: 'correct' } : { kind: 'play', hand: n.hand, finger: n.finger, label: n.pitch })
      }
      if (wait.wrong !== null) result.set(wait.wrong, { kind: 'wrong' })
    } else {
      const now = player.playing ? player.sounding : (current?.notes ?? [])
      for (const n of now) result.set(n.midi, { kind: 'play', hand: n.hand, finger: n.finger, label: n.pitch, dim: !inHands(n, hands) })
    }
    return result
  }, [mode, current, next, hands, wait.hits, wait.wrong, player.playing, player.sounding])

  async function deleteSong(id: number) {
    await api.deleteSong(id)
    const list = await api.listSongs()
    setSongs(list)
    if (song?.id === id) {
      setSong(null)
      if (list[0]) openSong(list[0].id)
    }
  }

  const position = current ? { measure: current.measure, beat: current.beatInMeasure + 1 } : null

  return (
    <div className="app" data-view={song ? view : 'sheet'}>
      <header className="topbar">
        <button onClick={() => setLibraryOpen(true)}>☰ Songs</button>
        <div className="song-title">
          {song ? (
            <>
              <strong>{song.title}</strong>
              <span className="muted">
                {[song.artist, song.key, `${song.time_signature[0]}/${song.time_signature[1]}`].filter(Boolean).join(' · ')}
              </span>
            </>
          ) : (
            <strong>Piano Teacher</strong>
          )}
        </div>
        <button className="primary" onClick={() => setAdding(true)}>
          + Add song
        </button>
      </header>

      {error ? (
        <p className="error banner" onClick={() => setError(null)}>
          {error}
        </p>
      ) : null}

      {song ? (
        <Controls
          player={player}
          view={view}
          setView={setView}
          themeId={themeId}
          setThemeId={setThemeId}
          baseTempo={song.tempo}
          midi={{ supported: input.midiSupported, devices: input.midiDevices, error: input.midiError, connect: input.connectMidi }}
          soundOnMidi={soundOnMidi}
          setSoundOnMidi={setSoundOnMidi}
        />
      ) : null}

      <nav className="tabs main-tabs">
        {(
          [
            ['sheet', 'Sheet'],
            ['steps', 'Notes to play'],
            ['chat', 'Teacher'],
            ['notes', 'Tips'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          // On desktop the sheet is always shown, so "Notes to play" is the panel next to it.
          <button
            key={id}
            data-tab={id}
            className={tab === id ? 'active' : tab === 'sheet' && id === 'steps' ? 'desktop-active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="workspace" data-tab={tab}>
        <section className="pane sheet-pane">
          {song ? (
            <SheetMusic musicxml={song.musicxml} cursorBeat={current ? current.start : null} />
          ) : (
            <div className="empty">
              <h2>Learn any song, key by key</h2>
              <p>Add a song: let the AI arrange it, snap a photo of sheet music, or import a MusicXML / MIDI file.</p>
              <button className="primary" onClick={() => setAdding(true)}>
                + Add your first song
              </button>
            </div>
          )}
        </section>
        <aside className="pane side-pane">
          <div className="side steps-side">
            {mode === 'wait' && wait.finished ? (
              <div className="finished">
                🎉 Nice! You played it all. <button onClick={player.restart}>Again</button>
              </div>
            ) : null}
            <StepList steps={steps} current={stepIndex} hands={hands} onSelect={player.seekToStep} onEdit={editNotes} saving={saving} />
          </div>
          <div className="side chat-side">
            <ChatPanel song={song} position={position} aiReady={aiReady} />
          </div>
          <div className="side notes-side">
            <h3>Teacher’s tips</h3>
            <p className="pre">{song?.teacher_notes || 'No tips for this song yet. Ask the Teacher tab for some!'}</p>
            <h3>Playing with your keyboard</h3>
            <ul>
              <li>Plug your digital piano in over USB and press “Connect MIDI keyboard”.</li>
              <li>
                No piano handy? Use your computer keyboard: <kbd>A</kbd>–<kbd>;</kbd> are white keys, <kbd>W E T Y U O P</kbd> black
                keys, <kbd>Z</kbd>/<kbd>X</kbd> change octave (now C{input.baseOctave}). You can also tap the keys on screen.
              </li>
              <li>
                <b>Wait for me</b> mode pauses on each note until you play it. Blue = right hand, orange = left hand, the
                number is the finger.
              </li>
            </ul>
          </div>
        </aside>
      </main>

      <footer className="keyboard" data-theme={themed ? theme.id : undefined} style={themed ? themeStyle(theme) : undefined}>
        {song ? <NowNext now={current} next={next} hands={hands} /> : null}
        {song && mode === 'game' ? <GameHud game={player.game} playing={player.playing} /> : null}
        <Piano
          marks={marks}
          held={input.held}
          onPress={(m) => input.press(m, 0.75, 'screen')}
          onRelease={(m) => input.release(m, 'screen')}
          above={
            song && view === 'falling' ? (
              <Waterfall
                notes={song.notes}
                measures={player.measures}
                hands={hands}
                bpm={player.bpm}
                range={player.range}
                getBeat={player.getBeat}
                judgments={player.judgments}
                events={player.events}
                theme={theme}
                smooth={mode === 'wait'}
                countdown={mode === 'game'}
              />
            ) : undefined
          }
        />
      </footer>

      {song && mode === 'game' && player.game.finished ? (
        <GameResults
          key={`${song.id}-${hands}`}
          game={player.game}
          songId={song.id}
          hands={hands}
          onAgain={() => {
            player.restart()
            player.play()
          }}
          onClose={player.restart}
        />
      ) : null}

      {libraryOpen ? (
        <div className="drawer-backdrop" onClick={() => setLibraryOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <SongLibrary
              songs={songs}
              currentId={song?.id ?? null}
              onSelect={openSong}
              onDelete={deleteSong}
              onAdd={() => {
                setLibraryOpen(false)
                setAdding(true)
              }}
            />
          </div>
        </div>
      ) : null}

      {adding ? (
        <AddSongDialog
          aiReady={aiReady}
          onClose={() => setAdding(false)}
          onAdded={(added) => {
            setAdding(false)
            setSong(added)
            api.listSongs().then(setSongs)
          }}
        />
      ) : null}
    </div>
  )
}
