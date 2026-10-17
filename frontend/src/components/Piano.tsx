import { useEffect, useMemo, useRef } from 'react'
import type { Hand } from '../lib/music'
import { FIRST_KEY, LAST_KEY, isBlackKey, midiToName } from '../lib/music'

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
}

const WHITE_LETTERS: Record<number, string> = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' }
const BLACK_NAMES: Record<number, [string, string]> = {
  1: ['C♯', 'D♭'],
  3: ['D♯', 'E♭'],
  6: ['F♯', 'G♭'],
  8: ['G♯', 'A♭'],
  10: ['A♯', 'B♭'],
}

/** Resting label: letter on white keys (octave shown on C), both spellings on black keys. */
function restingLabel(midi: number) {
  const pitchClass = midi % 12
  if (pitchClass in BLACK_NAMES) {
    const [sharp, flat] = BLACK_NAMES[pitchClass]
    return (
      <>
        <span>{sharp}</span>
        <span>{flat}</span>
      </>
    )
  }
  return pitchClass === 0 ? `C${Math.floor(midi / 12) - 1}` : WHITE_LETTERS[pitchClass]
}

const WHITE_KEYS =Array.from({ length: LAST_KEY - FIRST_KEY + 1 }, (_, i) => FIRST_KEY + i).filter((m) => !isBlackKey(m))

export function Piano({ marks, held, onPress, onRelease }: PianoProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Position of every key, in white-key units from the left edge.
  const layout = useMemo(() => {
    const positions = new Map<number, number>()
    let white = 0
    for (let midi = FIRST_KEY; midi <= LAST_KEY; midi++) {
      if (isBlackKey(midi)) positions.set(midi, white - 0.3)
      else positions.set(midi, white++)
    }
    return positions
  }, [])

  // On narrow screens the keyboard scrolls; keep the keys to play in view.
  const target = useMemo(() => {
    const playing = [...marks].filter(([, m]) => m.kind === 'play').map(([midi]) => midi)
    return playing.length ? (Math.min(...playing) + Math.max(...playing)) / 2 : null
  }, [marks])
  useEffect(() => {
    const el = scrollRef.current
    const piano = el?.firstElementChild as HTMLElement | null
    if (!el || !piano || target === null || el.scrollWidth <= el.clientWidth) return
    const x = piano.offsetLeft + ((layout.get(Math.round(target)) ?? 0) / WHITE_KEYS.length) * piano.offsetWidth
    if (x < el.scrollLeft + el.clientWidth * 0.2 || x > el.scrollLeft + el.clientWidth * 0.8) {
      el.scrollTo({ left: x - el.clientWidth / 2, behavior: 'smooth' })
    }
  }, [target, layout])

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
    const left = layout.get(midi)!
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
          {scoreLabel ?? restingLabel(midi)}
        </span>
      </div>
    )
  }

  return (
    <div className="piano-scroll" ref={scrollRef}>
      <div className="piano" role="group" aria-label="88-key piano">
        {WHITE_KEYS.map(renderKey)}
        {[...layout.keys()].filter(isBlackKey).map(renderKey)}
      </div>
    </div>
  )
}
