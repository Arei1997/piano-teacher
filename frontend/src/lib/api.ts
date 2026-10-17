import type { NoteEvent, Song, SongSummary } from './music'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerateOptions {
  title: string
  artist?: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  hands: 'both' | 'right' | 'left'
  instructions?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status})`)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  health: () => request<{ status: string; ai_configured: boolean }>('/api/health'),
  listSongs: () => request<SongSummary[]>('/api/songs'),
  getSong: (id: number) => request<Song>(`/api/songs/${id}`),
  deleteSong: (id: number) => request<void>(`/api/songs/${id}`, { method: 'DELETE' }),

  importSong(file: File) {
    const form = new FormData()
    form.append('file', file)
    return request<Song>('/api/songs/import', { method: 'POST', body: form })
  },

  generateSong: (options: GenerateOptions) => request<Song>('/api/songs/generate', json(options)),

  updateNotes: (id: number, notes: NoteEvent[]) =>
    request<Song>(`/api/songs/${id}/notes`, {
      ...json({ notes: notes.map(({ pitch, start, duration, hand, finger }) => ({ pitch, start, duration, hand, finger })) }),
      method: 'PUT',
    }),

  transcribeSong(files: File[], title?: string) {
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    if (title) form.append('title', title)
    return request<Song>('/api/songs/transcribe', { method: 'POST', body: form })
  },

  /** Streams the reply; calls onText for each chunk. Resolves when the reply is complete. */
  async chat(
    body: { messages: ChatMessage[]; song_id?: number; position?: { measure: number; beat: number } },
    onText: (text: string) => void,
    signal?: AbortSignal,
  ) {
    const response = await fetch('/api/chat', { ...json(body), signal })
    if (!response.ok || !response.body) {
      const detail = (await response.json().catch(() => null))?.detail
      throw new Error(typeof detail === 'string' ? detail : `Chat failed (${response.status})`)
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const event of events) {
        if (!event.startsWith('data: ')) continue
        const payload = JSON.parse(event.slice(6))
        if (payload.type === 'text') onText(payload.text)
        else if (payload.type === 'error') throw new Error(payload.message)
      }
    }
  },
}
