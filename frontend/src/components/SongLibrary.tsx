import type { SongSummary } from '../lib/music'

const SOURCE_LABEL = { import: 'File', ai: 'AI', scan: 'Scan' } as const

interface SongLibraryProps {
  songs: SongSummary[]
  currentId: number | null
  onSelect: (id: number) => void
  onDelete: (id: number) => void
  onAdd: () => void
}

export function SongLibrary({ songs, currentId, onSelect, onDelete, onAdd }: SongLibraryProps) {
  return (
    <div className="library">
      <button className="primary" onClick={onAdd}>
        + Add song
      </button>
      <ul>
        {songs.map((song) => (
          <li key={song.id} className={song.id === currentId ? 'active' : ''}>
            <button className="song" onClick={() => onSelect(song.id)}>
              <span className="title">{song.title}</span>
              <span className="muted">
                {song.artist ?? 'Unknown'} · {SOURCE_LABEL[song.source]}
              </span>
            </button>
            <button
              className="icon"
              aria-label={`Delete ${song.title}`}
              onClick={() => confirm(`Delete “${song.title}”?`) && onDelete(song.id)}
            >
              🗑
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
