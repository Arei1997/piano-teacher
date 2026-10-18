export type Hand = 'R' | 'L'
export type HandFilter = 'both' | Hand

export interface NoteEvent {
  pitch: string
  midi: number
  start: number
  duration: number
  hand: Hand
  finger: number | null
}

export interface SongSummary {
  id: number
  title: string
  artist: string | null
  source: 'import' | 'ai' | 'scan'
  created_at: string
}

export interface Measure {
  number: number
  start: number
  length: number
}

export interface Song extends SongSummary {
  tempo: number
  time_signature: [number, number]
  key: string | null
  notes: NoteEvent[]
  measures: Measure[]
  musicxml: string
  teacher_notes: string | null
}

/** Every distinct moment where at least one key is struck. */
export interface Step {
  index: number
  start: number
  measure: number
  beatInMeasure: number
  notes: NoteEvent[]
}

export const FIRST_KEY = 21 // A0
export const LAST_KEY = 108 // C8
const EPSILON = 1e-3

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK = new Set([1, 3, 6, 8, 10])

const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Move a note by semitones, keeping its spelling style (flats stay flats; naturals go sharp up, flat down). */
export function shiftPitch(note: NoteEvent, semitones: number): NoteEvent | null {
  const midi = note.midi + semitones
  if (midi < FIRST_KEY || midi > LAST_KEY) return null
  const useFlats = note.pitch.includes('b') || (!note.pitch.includes('#') && semitones < 0)
  const names = useFlats ? FLAT_NAMES : NAMES
  return { ...note, midi, pitch: `${names[midi % 12]}${Math.floor(midi / 12) - 1}` }
}

export const isBlackKey = (midi: number) => BLACK.has(midi % 12)

export const WHITE_KEY_COUNT = 52
export const BLACK_KEY_WIDTH = 0.6 // in white-key widths

/** Left edge of every key, in white-key widths from A0. Black keys straddle the gap between whites. */
export const KEY_LEFT: ReadonlyMap<number, number> = (() => {
  const positions = new Map<number, number>()
  let white = 0
  for (let midi = FIRST_KEY; midi <= LAST_KEY; midi++) {
    if (isBlackKey(midi)) positions.set(midi, white - BLACK_KEY_WIDTH / 2)
    else positions.set(midi, white++)
  }
  return positions
})()
export const midiToName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
export const measureLength = ([num, den]: [number, number]) => (num * 4) / den

export function inHands(note: NoteEvent, hands: HandFilter) {
  return hands === 'both' || note.hand === hands
}

/** The song's bars. Older songs without stored barlines get a regular grid. */
export function barlines(song: Song): Measure[] {
  if (song.measures?.length) return song.measures
  const bar = measureLength(song.time_signature)
  const end = Math.max(bar, ...song.notes.map((n) => n.start + n.duration))
  return Array.from({ length: Math.ceil(end / bar - EPSILON) }, (_, i) => ({ number: i + 1, start: i * bar, length: bar }))
}

/** Bar number and beat offset in the bar. A short first bar is a pickup: its notes fall on the last beats. */
export function locate(start: number, measures: Measure[], timeSignature: [number, number]) {
  let index = 0
  while (index + 1 < measures.length && measures[index + 1].start <= start + EPSILON) index++
  const measure = measures[index]
  if (!measure) return { measure: 1, beat: start }
  const nominal = measureLength(timeSignature)
  const pickup = index === 0 && measure.length < nominal - EPSILON ? nominal - measure.length : 0
  return { measure: measure.number, beat: start - measure.start + pickup }
}

export function buildSteps(song: Song): Step[] {
  const measures = barlines(song)
  const steps: Step[] = []
  for (const note of [...song.notes].sort((a, b) => a.start - b.start)) {
    const last = steps[steps.length - 1]
    if (last && Math.abs(last.start - note.start) < EPSILON) {
      last.notes.push(note)
      continue
    }
    const { measure, beat } = locate(note.start, measures, song.time_signature)
    steps.push({ index: steps.length, start: note.start, measure, beatInMeasure: beat, notes: [note] })
  }
  for (const step of steps) {
    step.notes.sort((a, b) => (a.hand === b.hand ? a.midi - b.midi : a.hand === 'R' ? -1 : 1))
  }
  return steps
}

/** Index of the last step starting at or before `beat`, or -1 before the first note. */
export function stepAt(steps: Step[], beat: number): number {
  let lo = 0
  let hi = steps.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (steps[mid].start <= beat + EPSILON) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

const FRACTIONS: Record<string, string> = {
  '0.25': '¼',
  '0.5': '½',
  '0.75': '¾',
  '0.333': '⅓',
  '0.667': '⅔',
}

const NOTE_NAMES: Record<string, string> = {
  '0.25': '16th',
  '0.333': 'triplet 8th',
  '0.5': '8th',
  '0.667': 'triplet quarter',
  '0.75': 'dotted 8th',
  '1': 'quarter',
  '1.5': 'dotted quarter',
  '2': 'half',
  '3': 'dotted half',
  '4': 'whole',
}

/** 1.5 -> "1½" */
export function formatBeats(beats: number): string {
  const whole = Math.floor(beats + EPSILON)
  const rest = (beats - whole).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  const frac = rest === '0' ? '' : (FRACTIONS[rest] ?? (whole ? rest.slice(1) : rest))
  if (!whole) return frac || '0'
  return `${whole}${frac}`
}

/** 0.5 -> "½ beat · 8th" */
export function describeDuration(beats: number): string {
  const key = String(Number(beats.toFixed(3)))
  const unit = beats <= 1 + EPSILON ? 'beat' : 'beats'
  const name = NOTE_NAMES[key]
  return name ? `${formatBeats(beats)} ${unit} · ${name}` : `${formatBeats(beats)} ${unit}`
}

/** Group a step's notes into chords per hand: [{hand, pitches, duration}] */
export function chordsInStep(step: Step, hands: HandFilter = 'both') {
  const groups = new Map<string, { hand: Hand; duration: number; notes: NoteEvent[] }>()
  for (const note of step.notes) {
    if (!inHands(note, hands)) continue
    const key = `${note.hand}:${note.duration}`
    const group = groups.get(key) ?? { hand: note.hand, duration: note.duration, notes: [] }
    group.notes.push(note)
    groups.set(key, group)
  }
  return [...groups.values()]
}
