import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import type { ChatMessage } from '../lib/api'
import { api } from '../lib/api'
import type { Song } from '../lib/music'

interface ChatPanelProps {
  song: Song | null
  position: { measure: number; beat: number } | null
  aiReady: boolean
}

const SUGGESTIONS = [
  'How do I play the bar I am on?',
  'Give me a 15-minute practice plan for this song',
  'Explain the rhythm of this passage',
  'Which fingering should I use here?',
]

export function ChatPanel({ song, position, aiReady }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy) return
    const history: ChatMessage[] = [...messages, { role: 'user', content }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setInput('')
    setError(null)
    setBusy(true)
    abortRef.current = new AbortController()
    try {
      await api.chat(
        { messages: history, song_id: song?.id, position: position ?? undefined },
        (chunk) =>
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            return [...prev.slice(0, -1), { ...last, content: last.content + chunk }]
          }),
        abortRef.current.signal,
      )
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      // Drop an empty assistant bubble so the history stays valid for the next send.
      setMessages((prev) => (prev[prev.length - 1]?.content ? prev : prev.slice(0, -1)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>
              Ask your piano teacher anything{song ? ` about “${song.title}”` : ''}: fingering, rhythm, theory or how to
              practise.
            </p>
            {!aiReady ? (
              <p className="warning">Add AI_API_KEY to backend/.env to turn the teacher on.</p>
            ) : null}
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.role === 'assistant' ? <Markdown>{m.content || '…'}</Markdown> : m.content}
            </div>
          ))
        )}
        {error ? <p className="error">{error}</p> : null}
        <div ref={endRef} />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
          placeholder="Ask the teacher…"
          rows={2}
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
      {messages.length ? (
        <button className="link" onClick={() => setMessages([])} disabled={busy}>
          New conversation
        </button>
      ) : null}
    </div>
  )
}
