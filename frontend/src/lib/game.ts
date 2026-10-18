import type { HandFilter, NoteEvent } from './music'
import { inHands } from './music'

/**
 * Scoring for game mode. Every note of the practised hand(s) is a target that must be
 * pressed close to its start time. Timing windows are in seconds so they feel the same
 * at any tempo; positions are in beats, so each call takes the current seconds-per-beat.
 */

export type Grade = 'perfect' | 'good' | 'miss'

export const WINDOW_SECONDS = { perfect: 0.08, good: 0.18 }
const POINTS: Record<Grade, number> = { perfect: 100, good: 50, miss: 0 }

export interface Target {
  note: NoteEvent
  grade: Grade | null
}

export interface GameStats {
  score: number
  combo: number
  maxCombo: number
  perfect: number
  good: number
  miss: number
  wrong: number
}

export const emptyStats = (): GameStats => ({ score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, wrong: 0 })

/** Score multiplier: x1, rising by one every 10 notes in a row, up to x4. */
export const multiplier = (combo: number) => Math.min(4, 1 + Math.floor(combo / 10))

export function createTargets(notes: NoteEvent[], hands: HandFilter, range: { start: number; end: number }): Target[] {
  return notes
    .filter((n) => inHands(n, hands) && n.start >= range.start - 1e-3 && n.start < range.end - 1e-3)
    .sort((a, b) => a.start - b.start)
    .map((note) => ({ note, grade: null }))
}

/** Judge a key press at `beat`. Grades and returns the closest open target for that key, or null for a wrong note. */
export function judgePress(targets: Target[], midi: number, beat: number, secondsPerBeat: number): Target | null {
  let best: Target | null = null
  let bestError = Infinity
  for (const target of targets) {
    if (target.grade || target.note.midi !== midi) continue
    const error = Math.abs(target.note.start - beat) * secondsPerBeat
    if (error <= WINDOW_SECONDS.good && error < bestError) {
      best = target
      bestError = error
    }
  }
  if (best) best.grade = bestError <= WINDOW_SECONDS.perfect ? 'perfect' : 'good'
  return best
}

/** Mark targets whose window has passed without a press as missed. Returns the newly missed ones. */
export function sweepMisses(targets: Target[], beat: number, secondsPerBeat: number): Target[] {
  const late = WINDOW_SECONDS.good / secondsPerBeat
  const missed: Target[] = []
  for (const target of targets) {
    if (target.note.start > beat) break // targets are sorted by start
    if (!target.grade && beat - target.note.start > late) {
      target.grade = 'miss'
      missed.push(target)
    }
  }
  return missed
}

export function applyGrade(stats: GameStats, grade: Grade): GameStats {
  if (grade === 'miss') return { ...stats, miss: stats.miss + 1, combo: 0 }
  const combo = stats.combo + 1
  return {
    ...stats,
    [grade]: stats[grade] + 1,
    combo,
    maxCombo: Math.max(stats.maxCombo, combo),
    score: stats.score + POINTS[grade] * multiplier(stats.combo),
  }
}

/** A wrong key breaks the combo but costs no points. */
export const applyWrong = (stats: GameStats): GameStats => ({ ...stats, wrong: stats.wrong + 1, combo: 0 })

export function accuracy(stats: GameStats): number {
  const total = stats.perfect + stats.good + stats.miss
  return total ? (stats.perfect + stats.good * 0.5) / total : 0
}

/**
 * How cleanly one training repetition went: notes hit on time out of everything played
 * or due. Unlike `accuracy`, wrong notes count against it, since they build bad habits.
 */
export function repAccuracy(stats: GameStats): number {
  const hits = stats.perfect + stats.good
  const total = hits + stats.miss + stats.wrong
  return total ? hits / total : 0
}

export interface TrainSettings {
  startPct: number
  targetPct: number
  stepPct: number
  /** Minimum repAccuracy for a repetition to count as clean. */
  threshold: number
  /** Clean repetitions in a row at the target tempo to master the passage. */
  repsNeeded: number
}

export const DEFAULT_TRAIN: TrainSettings = { startPct: 60, targetPct: 100, stepPct: 10, threshold: 0.9, repsNeeded: 3 }

export interface TrainProgress {
  rep: number
  tempoPct: number
  cleanAtTarget: number
  lastAccuracy: number | null
  mastered: boolean
}

export const startTraining = (settings: TrainSettings): TrainProgress => ({
  rep: 0,
  tempoPct: settings.startPct,
  cleanAtTarget: 0,
  lastAccuracy: null,
  mastered: false,
})

/**
 * The speed ladder: a clean repetition earns a faster tempo (up to the target), a sloppy one
 * drops back a step. At the target, enough clean repetitions in a row master the passage.
 */
export function finishRep(progress: TrainProgress, rep: GameStats, settings: TrainSettings): TrainProgress {
  const score = repAccuracy(rep)
  const clean = score >= settings.threshold
  const base = { ...progress, rep: progress.rep + 1, lastAccuracy: score }
  if (!clean) {
    return { ...base, tempoPct: Math.max(settings.startPct, progress.tempoPct - settings.stepPct), cleanAtTarget: 0 }
  }
  if (progress.tempoPct < settings.targetPct) {
    return { ...base, tempoPct: Math.min(settings.targetPct, progress.tempoPct + settings.stepPct), cleanAtTarget: 0 }
  }
  const cleanAtTarget = progress.cleanAtTarget + 1
  return { ...base, cleanAtTarget, mastered: cleanAtTarget >= settings.repsNeeded }
}

export function rank(stats: GameStats): 'S' | 'A' | 'B' | 'C' | 'D' {
  const a = accuracy(stats)
  if (a >= 0.95 && stats.miss === 0) return 'S'
  if (a >= 0.85) return 'A'
  if (a >= 0.7) return 'B'
  if (a >= 0.5) return 'C'
  return 'D'
}
