import { useState } from 'react'
import type { GenerateOptions } from '../lib/api'
import { api } from '../lib/api'
import type { Song } from '../lib/music'

type Tab = 'generate' | 'scan' | 'import'

interface AddSongDialogProps {
  aiReady: boolean
  onClose: () => void
  onAdded: (song: Song) => void
}

export function AddSongDialog({ aiReady, onClose, onAdded }: AddSongDialogProps) {
  const [tab, setTab] = useState<Tab>('generate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [gen, setGen] = useState<GenerateOptions>({ title: '', artist: '', difficulty: 'beginner', hands: 'both' })
  const [scanFiles, setScanFiles] = useState<File[]>([])
  const [scanTitle, setScanTitle] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)

  async function run(action: () => Promise<Song>) {
    setBusy(true)
    setError(null)
    try {
      onAdded(await action())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const needsAi = tab !== 'import' && !aiReady

  return (
    <div className="dialog-backdrop" onClick={busy ? undefined : onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Add a song</h2>
          <button className="icon" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </header>
        <nav className="tabs">
          {(
            [
              ['generate', 'AI arrangement'],
              ['scan', 'Photo / PDF of sheet'],
              ['import', 'MusicXML / MIDI file'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} disabled={busy}>
              {label}
            </button>
          ))}
        </nav>

        {tab === 'generate' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              run(() => api.generateSong({ ...gen, artist: gen.artist || undefined, instructions: gen.instructions || undefined }))
            }}
          >
            <p className="muted">
              The AI writes a playable arrangement. It follows the song as commonly played, so it may differ from a
              specific recording. For an exact version, scan or import real sheet music.
            </p>
            <label>
              Song title
              <input required value={gen.title} onChange={(e) => setGen({ ...gen, title: e.target.value })} placeholder="Nobody's Fault But Mine" />
            </label>
            <label>
              Artist / version
              <input value={gen.artist} onChange={(e) => setGen({ ...gen, artist: e.target.value })} placeholder="Nina Simone" />
            </label>
            <div className="row">
              <label>
                Level
                <select value={gen.difficulty} onChange={(e) => setGen({ ...gen, difficulty: e.target.value as GenerateOptions['difficulty'] })}>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </label>
              <label>
                Hands
                <select value={gen.hands} onChange={(e) => setGen({ ...gen, hands: e.target.value as GenerateOptions['hands'] })}>
                  <option value="both">Both hands</option>
                  <option value="right">Right hand only</option>
                  <option value="left">Left hand only</option>
                </select>
              </label>
            </div>
            <label>
              Anything else? (optional)
              <textarea
                rows={2}
                value={gen.instructions ?? ''}
                onChange={(e) => setGen({ ...gen, instructions: e.target.value })}
                placeholder="Just the intro and first verse, keep the gospel feel in the left hand…"
              />
            </label>
            <button className="primary" disabled={busy || needsAi}>
              {busy ? 'Arranging… (up to a minute or two)' : 'Create arrangement'}
            </button>
          </form>
        ) : null}

        {tab === 'scan' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              run(() => api.transcribeSong(scanFiles, scanTitle || undefined))
            }}
          >
            <p className="muted">
              Upload photos, screenshots or a PDF of printed sheet music. The AI reads it note by note. Flat, well-lit,
              straight-on photos work best; check the result against the original.
            </p>
            <label>
              Pages (in order)
              <input
                type="file"
                multiple
                required
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                onChange={(e) => setScanFiles([...(e.target.files ?? [])])}
              />
            </label>
            <label>
              Title (optional)
              <input value={scanTitle} onChange={(e) => setScanTitle(e.target.value)} />
            </label>
            <button className="primary" disabled={busy || needsAi || !scanFiles.length}>
              {busy ? 'Reading the sheet… (up to a few minutes)' : 'Transcribe sheet'}
            </button>
          </form>
        ) : null}

        {tab === 'import' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (importFile) run(() => api.importSong(importFile))
            }}
          >
            <p className="muted">
              The most accurate option. Download MusicXML (.mxl / .musicxml) or MIDI from MuseScore.com or any notation
              app, then import it here.
            </p>
            <label>
              File
              <input
                type="file"
                required
                accept=".musicxml,.xml,.mxl,.mid,.midi"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button className="primary" disabled={busy || !importFile}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </form>
        ) : null}

        {needsAi ? <p className="warning">Add AI_API_KEY to backend/.env and restart the backend to use this.</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  )
}
