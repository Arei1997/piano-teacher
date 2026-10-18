import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRAIN,
  accuracy,
  applyGrade,
  applyWrong,
  createTargets,
  emptyStats,
  finishRep,
  judgePress,
  multiplier,
  rank,
  repAccuracy,
  startTraining,
  sweepMisses,
} from './game'
import type { NoteEvent } from './music'

const note = (midi: number, start: number, hand: 'R' | 'L' = 'R'): NoteEvent => ({
  pitch: `n${midi}`,
  midi,
  start,
  duration: 1,
  hand,
  finger: null,
})

// 120 bpm: half a second per beat, so the good window (0.18 s) is 0.36 beats.
const SPB = 0.5

describe('targets', () => {
  it('keeps only the practised hand inside the range, sorted by time', () => {
    const notes = [note(64, 2), note(60, 0), note(48, 0, 'L'), note(67, 9)]
    const targets = createTargets(notes, 'R', { start: 0, end: 8 })
    expect(targets.map((t) => t.note.midi)).toEqual([60, 64])
  })
})

describe('judgePress', () => {
  it('grades on timing: perfect, good, or too far away', () => {
    const targets = createTargets([note(60, 0), note(62, 1), note(64, 2)], 'both', { start: 0, end: 4 })
    expect(judgePress(targets, 60, 0.1, SPB)?.grade).toBe('perfect') // 0.05 s early
    expect(judgePress(targets, 62, 1.3, SPB)?.grade).toBe('good') // 0.15 s late
    expect(judgePress(targets, 64, 2.5, SPB)).toBeNull() // 0.25 s: outside the window
  })

  it('treats a key with no target as a wrong note and never grades a target twice', () => {
    const targets = createTargets([note(60, 0)], 'both', { start: 0, end: 4 })
    expect(judgePress(targets, 61, 0, SPB)).toBeNull()
    expect(judgePress(targets, 60, 0, SPB)?.grade).toBe('perfect')
    expect(judgePress(targets, 60, 0.05, SPB)).toBeNull()
  })

  it('picks the closest of two repeated notes', () => {
    const targets = createTargets([note(60, 0), note(60, 0.5)], 'both', { start: 0, end: 4 })
    expect(judgePress(targets, 60, 0.45, SPB)?.note.start).toBe(0.5)
  })
})

describe('sweepMisses', () => {
  it('misses notes once their window has passed', () => {
    const targets = createTargets([note(60, 0), note(62, 1)], 'both', { start: 0, end: 4 })
    expect(sweepMisses(targets, 0.3, SPB)).toHaveLength(0) // still inside the window
    expect(sweepMisses(targets, 0.4, SPB).map((t) => t.note.midi)).toEqual([60])
    expect(sweepMisses(targets, 0.4, SPB)).toHaveLength(0) // not counted twice
  })
})

describe('training', () => {
  const clean = { ...emptyStats(), perfect: 9, good: 1 } // 100%
  const sloppy = { ...emptyStats(), perfect: 8, wrong: 2 } // 80%: wrong notes count against a rep

  it('scores a repetition with wrong notes counted against it', () => {
    expect(repAccuracy(clean)).toBe(1)
    expect(repAccuracy(sloppy)).toBe(0.8)
  })

  it('climbs the speed ladder on clean reps and drops back on sloppy ones', () => {
    let p = startTraining(DEFAULT_TRAIN) // 60%
    p = finishRep(p, clean, DEFAULT_TRAIN)
    expect(p.tempoPct).toBe(70)
    p = finishRep(p, sloppy, DEFAULT_TRAIN)
    expect(p.tempoPct).toBe(60)
    p = finishRep(p, sloppy, DEFAULT_TRAIN)
    expect(p.tempoPct).toBe(60) // never below the start tempo
    expect(p.rep).toBe(3)
  })

  it('masters the passage after enough clean reps in a row at the target tempo', () => {
    let p = { ...startTraining(DEFAULT_TRAIN), tempoPct: 100 }
    p = finishRep(p, clean, DEFAULT_TRAIN)
    p = finishRep(p, clean, DEFAULT_TRAIN)
    expect(p.mastered).toBe(false)
    p = finishRep(p, sloppy, DEFAULT_TRAIN) // a slip resets the streak
    expect([p.cleanAtTarget, p.tempoPct]).toEqual([0, 90])
    p = { ...p, tempoPct: 100 }
    for (let i = 0; i < 3; i++) p = finishRep(p, clean, DEFAULT_TRAIN)
    expect(p.mastered).toBe(true)
  })
})

describe('scoring', () => {
  it('builds a combo multiplier and resets it on a miss or wrong note', () => {
    let stats = emptyStats()
    for (let i = 0; i < 12; i++) stats = applyGrade(stats, 'perfect')
    // 10 notes at x1, then 2 at x2.
    expect(stats.score).toBe(10 * 100 + 2 * 200)
    expect(multiplier(stats.combo)).toBe(2)
    stats = applyGrade(stats, 'miss')
    expect(stats.combo).toBe(0)
    expect(stats.maxCombo).toBe(12)
    stats = applyGrade(applyWrong(applyGrade(stats, 'good')), 'good')
    expect([stats.combo, stats.wrong, stats.good]).toEqual([1, 1, 2])
  })

  it('caps the multiplier at x4', () => {
    expect(multiplier(100)).toBe(4)
  })

  it('ranks by accuracy', () => {
    const perfectRun = { ...emptyStats(), perfect: 20 }
    expect(rank(perfectRun)).toBe('S')
    expect(rank({ ...perfectRun, miss: 1 })).toBe('A')
    expect(accuracy({ ...emptyStats(), perfect: 1, good: 2, miss: 1 })).toBe(0.5)
    expect(rank({ ...emptyStats(), miss: 5 })).toBe('D')
  })
})
