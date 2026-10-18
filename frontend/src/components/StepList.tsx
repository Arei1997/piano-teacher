import { useEffect, useRef, useState } from 'react'
import type { HandFilter, NoteEvent, Step } from '../lib/music'
import { chordsInStep, describeDuration, formatBeats, midiToName, shiftPitch } from '../lib/music'
import { Icon } from './Icon'

/** A change to the song's notes: replace (or delete, with null) existing notes, and add new ones. */
export interface NoteEdit {
  replace?: [NoteEvent, NoteEvent | null][]
  add?: NoteEvent[]
}

interface StepListProps {
  steps: Step[]
  current: number
  hands: HandFilter
  onSelect: (index: number) => void
  onEdit: (edit: NoteEdit) => void
  saving: boolean
}

const LENGTHS = [0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2, 3, 4]

/** The whole song written out as "what to press, for how long", bar by bar. */
export function StepList({ steps, current, hands, onSelect, onEdit, saving }: StepListProps) {
  const activeRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string | null>(null) // `${stepIndex}:${hand}:${duration}`

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
    const open = chords.find((c) => `${step.index}:${c.hand}:${c.duration}` === selected)
    rows.push(
      <div
        key={step.index}
        ref={active ? activeRef : undefined}
        className={`step-row${active ? ' active' : ''}`}
        onClick={() => onSelect(step.index)}
        role="button"
      >
        <span className="step-beat">beat {formatBeats(step.beatInMeasure + 1)}</span>
        <span className="step-chords">
          {chords.map((chord) => {
            const key = `${step.index}:${chord.hand}:${chord.duration}`
            return (
              <span
                key={key}
                className={`chip hand-${chord.hand}${editing ? ' editable' : ''}${selected === key ? ' selected' : ''}`}
                onClick={editing ? () => setSelected(selected === key ? null : key) : undefined}
              >
                <b>{chord.notes.map((n) => n.pitch).join(' + ')}</b>
                <small>{describeDuration(chord.duration)}</small>
                {chord.notes.some((n) => n.finger) ? (
                  <small className="fingers">finger {chord.notes.map((n) => n.finger ?? '–').join('-')}</small>
                ) : null}
              </span>
            )
          })}
        </span>
      </div>,
    )
    if (editing && open) {
      rows.push(
        <ChordEditor
          key={`edit-${selected}`}
          notes={open.notes}
          duration={open.duration}
          onEdit={onEdit}
          // The open chord is tracked by its length, so follow it when the length changes.
          onLengthChanged={(beats) => setSelected(`${step.index}:${open.hand}:${beats}`)}
          onClose={() => setSelected(null)}
        />,
      )
    }
  }

  return (
    <>
      <div className="step-toolbar">
        <button className={editing ? 'active' : ''} onClick={() => (setEditing(!editing), setSelected(null))}>
          {editing ? 'Done editing' : 'Edit notes'}
        </button>
        <span className="muted">{saving ? 'Saving…' : editing ? 'Tap a note to fix it' : ''}</span>
      </div>
      <div className="step-list">{rows.length ? rows : <p className="muted">No notes for this hand.</p>}</div>
    </>
  )
}

interface ChordEditorProps {
  notes: NoteEvent[]
  duration: number
  onEdit: (edit: NoteEdit) => void
  onLengthChanged: (beats: number) => void
  onClose: () => void
}

function ChordEditor({ notes, duration, onEdit, onLengthChanged, onClose }: ChordEditorProps) {
  const shift = (note: NoteEvent, semitones: number) => {
    const moved = shiftPitch(note, semitones)
    if (moved) onEdit({ replace: [[note, moved]] })
  }
  const remove = (note: NoteEvent) => {
    onEdit({ replace: [[note, null]] })
    if (notes.length === 1) onClose()
  }
  const setLength = (beats: number) => {
    onEdit({ replace: notes.map((n) => [n, { ...n, duration: beats }]) })
    onLengthChanged(beats)
  }
  const addNote = () => {
    const top = notes[notes.length - 1]
    const midi = Math.min(top.midi + 3, 108)
    onEdit({ add: [{ ...top, midi, pitch: midiToName(midi), finger: null }] })
  }
  const lengths = LENGTHS.some((l) => Math.abs(l - duration) < 1e-3) ? LENGTHS : [...LENGTHS, duration].sort((a, b) => a - b)

  return (
    <div className="chord-editor" onClick={(e) => e.stopPropagation()}>
      {[...notes].reverse().map((note) => (
        <div className="edit-note" key={`${note.midi}${note.pitch}`}>
          <b>{note.pitch}</b>
          <button onClick={() => shift(note, -1)} aria-label={`Lower ${note.pitch} a semitone`}>
            <Icon name="down" />
          </button>
          <button onClick={() => shift(note, 1)} aria-label={`Raise ${note.pitch} a semitone`}>
            <Icon name="up" />
          </button>
          <button onClick={() => remove(note)} aria-label={`Delete ${note.pitch}`}>
            <Icon name="close" />
          </button>
        </div>
      ))}
      <div className="edit-actions">
        <label className="inline">
          Length
          <select value={lengths.find((l) => Math.abs(l - duration) < 1e-3)} onChange={(e) => setLength(Number(e.target.value))}>
            {lengths.map((l) => (
              <option key={l} value={l}>
                {describeDuration(l)}
              </option>
            ))}
          </select>
        </label>
        <button onClick={addNote}>+ Add note</button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  )
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
