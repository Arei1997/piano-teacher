import { useEffect, useRef } from 'react'
import type { HandFilter, Step } from '../lib/music'
import { chordsInStep, describeDuration, formatBeats } from '../lib/music'

interface StepListProps {
  steps: Step[]
  current: number
  hands: HandFilter
  onSelect: (index: number) => void
}

/** The whole song written out as "what to press, for how long", bar by bar. */
export function StepList({ steps, current, hands, onSelect }: StepListProps) {
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current])

  const rows: React.ReactNode[] = []
  let measure = -1 // bar 0 is a pickup, so start below it
  for (const step of steps) {
    const chords = chordsInStep(step, hands)
    if (!chords.length) continue
    if (step.measure !== measure) {
      measure = step.measure
      rows.push(
        <div className="step-measure" key={`m${measure}`}>
          {measure === 0 ? 'Pickup' : `Bar ${measure}`}
        </div>,
      )
    }
    const active = step.index === current
    rows.push(
      <button
        key={step.index}
        ref={active ? activeRef : undefined}
        className={`step-row${active ? ' active' : ''}`}
        onClick={() => onSelect(step.index)}
      >
        <span className="step-beat">beat {formatBeats(step.beatInMeasure + 1)}</span>
        <span className="step-chords">
          {chords.map((chord) => (
            <span key={`${chord.hand}${chord.duration}`} className={`chip hand-${chord.hand}`}>
              <b>{chord.notes.map((n) => n.pitch).join(' + ')}</b>
              <small>{describeDuration(chord.duration)}</small>
              {chord.notes.some((n) => n.finger) ? (
                <small className="fingers">finger {chord.notes.map((n) => n.finger ?? '–').join('-')}</small>
              ) : null}
            </span>
          ))}
        </span>
      </button>,
    )
  }

  return <div className="step-list">{rows.length ? rows : <p className="muted">No notes for this hand.</p>}</div>
}

/** One-line "Now / Next" summary shown above the piano. */
export function NowNext({ now, next, hands }: { now?: Step; next?: Step; hands: HandFilter }) {
  const describe = (step?: Step) =>
    step
      ? chordsInStep(step, hands).map((c) => (
          <span key={`${c.hand}${c.duration}`} className={`chip hand-${c.hand}`}>
            <b>{c.notes.map((n) => n.pitch).join('+')}</b> <small>{formatBeats(c.duration)}</small>
          </span>
        ))
      : '—'
  return (
    <div className="now-next">
      <div>
        <span className="label">Now</span>
        {describe(now)}
      </div>
      <div className="next">
        <span className="label">Next</span>
        {describe(next)}
      </div>
    </div>
  )
}
