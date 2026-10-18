import { useState } from 'react'
import type { ExerciseKind, ExerciseOptions, ScaleType } from '../lib/api'

const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']
const MINOR_KEYS = ['A', 'E', 'B', 'F#', 'C#', 'D', 'G', 'C', 'F']
const BLUES_KEYS = ['A', 'C', 'D', 'E', 'G']

const KINDS: { id: ExerciseKind; name: string }[] = [
  { id: 'five_finger', name: 'Five-finger pattern' },
  { id: 'scale', name: 'Scale' },
  { id: 'arpeggio', name: 'Arpeggio' },
  { id: 'hanon', name: 'Hanon No. 1' },
  { id: 'chords', name: 'Chord progression (I–IV–V–I)' },
  { id: 'blues', name: '12-bar blues left hand' },
]

const base: ExerciseOptions = { kind: 'scale', key: 'C', scale: 'major', hands: 'right', octaves: 1 }

/** A ten-minute warm-up, easiest first. Hands separately before hands together. */
const ROUTINE: { title: string; detail: string; options: ExerciseOptions[] }[] = [
  {
    title: 'Five-finger pattern',
    detail: 'Wakes the fingers up and checks they move evenly.',
    options: [
      { ...base, kind: 'five_finger', hands: 'right' },
      { ...base, kind: 'five_finger', hands: 'left' },
    ],
  },
  {
    title: 'C major scale',
    detail: 'Thumb-under crossings, hands separately, then together.',
    options: [
      { ...base, hands: 'right' },
      { ...base, hands: 'left' },
      { ...base, hands: 'both' },
    ],
  },
  { title: 'C major arpeggio', detail: 'Stretch and move the hand with the arm.', options: [{ ...base, kind: 'arpeggio', hands: 'right' }, { ...base, kind: 'arpeggio', hands: 'left' }] },
  { title: 'Hanon No. 1', detail: 'Finger strength and independence, especially fingers 4 and 5.', options: [{ ...base, kind: 'hanon', hands: 'right' }, { ...base, kind: 'hanon', hands: 'both' }] },
  { title: 'Chords I–IV–V–I', detail: 'Moving between chords by the shortest path.', options: [{ ...base, kind: 'chords', hands: 'both' }] },
]

const HAND_LABEL = { right: 'Right', left: 'Left', both: 'Both' } as const

interface PracticePanelProps {
  busy: boolean
  error: string | null
  onOpen: (options: ExerciseOptions) => void
}

export function PracticePanel({ busy, error, onOpen }: PracticePanelProps) {
  const [options, setOptions] = useState<ExerciseOptions>(base)
  const set = (patch: Partial<ExerciseOptions>) => setOptions((o) => ({ ...o, ...patch }))

  const hasScale = !['hanon', 'blues'].includes(options.kind)
  const minor = options.scale !== 'major'
  const keys = options.kind === 'blues' ? BLUES_KEYS : options.kind === 'hanon' ? ['C'] : minor ? MINOR_KEYS : MAJOR_KEYS
  const key = keys.includes(options.key) ? options.key : keys[0]
  const scaleTypes: ScaleType[] = options.kind === 'chords' ? ['major', 'harmonic minor'] : ['major', 'natural minor', 'harmonic minor']

  return (
    <div className="practice">
      <h2>Practice</h2>
      <section className="practice-card">
        <h3>How Train mode builds muscle memory</h3>
        <ol>
          <li>It loops a short passage, starting slowly (60% speed).</li>
          <li>Each clean repetition (90%+ right, wrong notes count) speeds it up; a sloppy one slows it down.</li>
          <li>At full speed, 3 clean reps in a row masters it. Then move on to the next bars, or join them up.</li>
        </ol>
        <p className="muted">Short, slow, correct repetitions build memory far faster than playing fast with mistakes.</p>
      </section>

      <h3>Warm-up routine · about 10 minutes</h3>
      <ol className="routine">
        {ROUTINE.map((step) => (
          <li key={step.title}>
            <div>
              <b>{step.title}</b>
              <span className="muted">{step.detail}</span>
            </div>
            <div className="routine-buttons">
              {step.options.map((o) => (
                <button key={o.hands} disabled={busy} onClick={() => onOpen(o)}>
                  {HAND_LABEL[o.hands]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <h3>Build an exercise</h3>
      <form
        className="exercise-form"
        onSubmit={(e) => {
          e.preventDefault()
          onOpen({ ...options, key, scale: hasScale ? options.scale : 'major' })
        }}
      >
        <label>
          Exercise
          <select value={options.kind} onChange={(e) => set({ kind: e.target.value as ExerciseKind, scale: 'major' })}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            Key
            <select value={key} onChange={(e) => set({ key: e.target.value })} disabled={keys.length === 1}>
              {keys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          {hasScale ? (
            <label>
              Type
              <select value={options.scale} onChange={(e) => set({ scale: e.target.value as ScaleType })}>
                {scaleTypes.map((s) => (
                  <option key={s} value={s}>
                    {s === 'harmonic minor' && options.kind === 'chords' ? 'minor' : s}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="row">
          {options.kind !== 'blues' ? (
            <label>
              Hands
              <select value={options.hands} onChange={(e) => set({ hands: e.target.value as ExerciseOptions['hands'] })}>
                <option value="right">Right hand</option>
                <option value="left">Left hand</option>
                <option value="both">Hands together</option>
              </select>
            </label>
          ) : null}
          {options.kind === 'scale' || options.kind === 'arpeggio' ? (
            <label>
              Range
              <select value={options.octaves} onChange={(e) => set({ octaves: Number(e.target.value) as 1 | 2 })}>
                <option value={1}>1 octave</option>
                <option value={2}>2 octaves</option>
              </select>
            </label>
          ) : null}
        </div>
        <button className="primary" disabled={busy}>
          {busy ? 'Opening…' : 'Open in Train mode'}
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}
