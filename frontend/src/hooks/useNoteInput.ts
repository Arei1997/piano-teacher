import { useCallback, useEffect, useRef, useState } from 'react'

export type InputSource = 'midi' | 'screen' | 'keyboard'

export interface NoteHandlers {
  onNoteOn: (midi: number, velocity: number, source: InputSource) => void
  onNoteOff: (midi: number, source: InputSource) => void
}

// Computer-keyboard piano: home row = white keys, row above = black keys.
const KEY_OFFSETS: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16,
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function useNoteInput(handlers: NoteHandlers) {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  const [held, setHeld] = useState<Set<number>>(new Set())
  const [midiDevices, setMidiDevices] = useState<string[]>([])
  const [midiError, setMidiError] = useState<string | null>(null)
  const [baseOctave, setBaseOctave] = useState(4)
  const midiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator && window.isSecureContext

  const press = useCallback((midi: number, velocity: number, source: InputSource) => {
    setHeld((prev) => new Set(prev).add(midi))
    handlersRef.current.onNoteOn(midi, velocity, source)
  }, [])

  const release = useCallback((midi: number, source: InputSource) => {
    setHeld((prev) => {
      const next = new Set(prev)
      next.delete(midi)
      return next
    })
    handlersRef.current.onNoteOff(midi, source)
  }, [])

  const connectMidi = useCallback(async () => {
    if (!midiSupported) {
      setMidiError(
        window.isSecureContext
          ? 'This browser has no Web MIDI. Use Chrome or Edge (desktop or Android).'
          : 'MIDI needs a secure page. On a phone, open the https:// address from `pnpm dev:phone`.',
      )
      return
    }
    try {
      const access = await navigator.requestMIDIAccess()
      const attach = () => {
        const names: string[] = []
        access.inputs.forEach((input) => {
          names.push(input.name ?? 'MIDI device')
          input.onmidimessage = (event) => {
            const [status, note, velocity] = event.data ?? []
            const command = status & 0xf0
            if (command === 0x90 && velocity > 0) press(note, velocity / 127, 'midi')
            else if (command === 0x80 || (command === 0x90 && velocity === 0)) release(note, 'midi')
          }
        })
        setMidiDevices(names)
        setMidiError(names.length ? null : 'No MIDI keyboard found. Plug it in, then it connects automatically.')
      }
      access.onstatechange = attach
      attach()
    } catch {
      setMidiError('MIDI permission was denied.')
    }
  }, [midiSupported, press, release])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'z') return setBaseOctave((o) => Math.max(1, o - 1))
      if (key === 'x') return setBaseOctave((o) => Math.min(7, o + 1))
      if (key in KEY_OFFSETS) press(12 * (baseOctave + 1) + KEY_OFFSETS[key], 0.75, 'keyboard')
    }
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (key in KEY_OFFSETS && !isTyping(event.target)) release(12 * (baseOctave + 1) + KEY_OFFSETS[key], 'keyboard')
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [baseOctave, press, release])

  return { held, press, release, connectMidi, midiSupported, midiDevices, midiError, baseOctave }
}
