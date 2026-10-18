import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import type { Hand } from '../lib/music'
import { FIRST_KEY, KEY_LEFT, LAST_KEY, WHITE_KEY_COUNT, isBlackKey, midiToName } from '../lib/music'

/** `label` is the note as spelled in the score (Ab4 rather than G#4). */
export type KeyMark =
  | { kind: 'play'; hand: Hand; finger: number | null; label: string; dim?: boolean }
  | { kind: 'next'; hand: Hand; label: string }
  | { kind: 'correct' }
  | { kind: 'wrong' }

interface PianoProps {
  marks: Map<number, KeyMark>
  held: Set<number>
  onPress: (midi: number) => void
  onRelease: (midi: number) => void
  /** Drawn above the keys inside the same scroller, so it stays lined up with them (falling notes). */
  above?: ReactNode
  labels?: KeyLabels
}

/** How resting keys are named: 'full' = D4 / C♯4 D♭4, 'letters' = D (octave only on C), 'none'. */
export type KeyLabels = 'full' | 'letters' | 'none'

const WHITE_LETTERS: Record<number, string> = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' }
const BLACK_NAMES: Record<number, [string, string]> = {
  1: ['C♯', 'D♭'],
  3: ['D♯', 'E♭'],
  6: ['F♯', 'G♭'],
  8: ['G♯', 'A♭'],
  10: ['A♯', 'B♭'],
}

/** Name for a key nobody needs to play right now. Black keys show both spellings. */
function restingLabel(midi: number, labels: KeyLabels) {
  if (labels === 'none') return null
  const pitchClass = midi % 12
  const octave = Math.floor(midi / 12) - 1
  const withOctave = labels === 'full' ? String(octave) : ''
  if (pitchClass in BLACK_NAMES) {
    const [sharp, flat] = BLACK_NAMES[pitchClass]
    // Separate pieces so narrow keys can drop the octave and the flat spelling (see index.css).
    return (
      <>
        <span>
          {sharp}
          <i className="oct">{withOctave}</i>
        </span>
        <span className="alt">
          {flat}
          <i className="oct">{withOctave}</i>
        </span>
      </>
    )
  }
  return pitchClass === 0 || labels === 'full' ? `${WHITE_LETTERS[pitchClass]}${octave}` : WHITE_LETTERS[pitchClass]
}

const ALL_KEYS = Array.from({ length: LAST_KEY - FIRST_KEY + 1 }, (_, i) => FIRST_KEY + i)
const WHITE_KEYS = ALL_KEYS.filter((m) => !isBlackKey(m))
const BLACK_KEYS = ALL_KEYS.filter(isBlackKey)

export function Piano({ marks, held, onPress, onRelease, above, labels = 'full' }: PianoProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pianoRef = useRef<HTMLDivElement>(null)

  // On narrow screens the keyboard scrolls; keep every key to play in view.
  const span = useMemo(() => {
    const playing = [...marks].filter(([, m]) => m.kind === 'play').map(([midi]) => midi)
    return playing.length ? { low: Math.min(...playing), high: Math.max(...playing) } : null
  }, [marks])
  useEffect(() => {
    const el = scrollRef.current
    const piano = pianoRef.current
    if (!el || !piano || !span || el.scrollWidth <= el.clientWidth) return
    const keyWidth = piano.offsetWidth / WHITE_KEY_COUNT
    const left = piano.offsetLeft + (KEY_LEFT.get(span.low) ?? 0) * keyWidth
    const right = piano.offsetLeft + ((KEY_LEFT.get(span.high) ?? 0) + 1) * keyWidth
    const margin = keyWidth * 1.5
    if (left < el.scrollLeft + margin || right > el.scrollLeft + el.clientWidth - margin) {
      el.scrollTo({ left: (left + right) / 2 - el.clientWidth / 2, behavior: 'smooth' })
    }
  }, [span])

  const pointer = (midi: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
      onPress(midi)
    },
    onPointerUp: () => onRelease(midi),
    onPointerLeave: (e: React.PointerEvent) => e.buttons && onRelease(midi),
  })

  const renderKey = (midi: number) => {
    const black = isBlackKey(midi)
    const mark = marks.get(midi)
    const classes = ['key', black ? 'black' : 'white']
    if (mark) {
      classes.push(`mark-${mark.kind}`)
      if ('hand' in mark) classes.push(`hand-${mark.hand}`)
      if (mark.kind === 'play' && mark.dim) classes.push('dim')
    }
    if (held.has(midi)) classes.push('held')
    const left = KEY_LEFT.get(midi)!
    // Keys to play show the full name as spelled in the score (e.g. Ab4).
    const scoreLabel = mark && 'label' in mark ? mark.label : null
    const name = scoreLabel ?? midiToName(midi)
    const isC = midi % 12 === 0
    return (
      <div
        key={midi}
        className={classes.join(' ')}
        style={{ left: `calc(${left} * var(--white-key))` }}
        title={name}
        {...pointer(midi)}
      >
        {mark?.kind === 'play' && mark.finger ? <span className="finger">{mark.finger}</span> : null}
        <span className={`key-name${scoreLabel ? ' score' : ''}${isC && !scoreLabel ? ' octave' : ''}`}>
          {scoreLabel ?? restingLabel(midi, labels)}
        </span>
      </div>
    )
  }

  return (
    <div className="piano-scroll" ref={scrollRef}>
      {above}
      <div className="piano" role="group" aria-label="88-key piano" ref={pianoRef}>
        {WHITE_KEYS.map(renderKey)}
        {BLACK_KEYS.map(renderKey)}
      </div>
    </div>
  )
}
