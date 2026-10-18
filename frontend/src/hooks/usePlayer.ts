import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { loadPiano, playNote, silence } from '../lib/audio'
import type { GameStats, Grade, Target, TrainProgress, TrainSettings } from '../lib/game'
import {
  DEFAULT_TRAIN,
  WINDOW_SECONDS,
  applyGrade,
  applyWrong,
  createTargets,
  emptyStats,
  finishRep,
  judgePress,
  multiplier,
  repAccuracy,
  startTraining,
  sweepMisses,
} from '../lib/game'
import { GameEvents } from '../lib/effects'
import type { HandFilter, NoteEvent, Song, Step } from '../lib/music'
import { barlines, buildSteps, inHands, stepAt } from '../lib/music'

export type Mode = 'listen' | 'wait' | 'game' | 'train'
/** Modes where the song plays on and the student's notes are scored. */
const isScored = (mode: Mode) => mode === 'game' || mode === 'train'
export interface LoopRange {
  from: number // first measure, inclusive
  to: number // last measure, inclusive
}

interface WaitState {
  index: number // into steps
  hits: Set<number>
  wrong: number | null
  wrongAt: number
  finished: boolean
}

export interface GameState {
  stats: GameStats
  last: { grade: Grade | 'wrong'; at: number } | null
  started: boolean
  finished: boolean
}

const EMPTY_WAIT: WaitState = { index: -1, hits: new Set(), wrong: null, wrongAt: 0, finished: false }
const NEW_GAME: GameState = { stats: emptyStats(), last: null, started: false, finished: false }

/** How long a falling note takes to reach the keys; also the game's count-in. */
export const FALL_SECONDS = 3
// The audio clock runs this many beats ahead of the song, so a game can start before
// beat 0 and give the first notes time to fall into view.
const LEAD_BEATS = 16

const leadInBeats = (bpm: number) => Math.min(LEAD_BEATS, (FALL_SECONDS * bpm) / 60)

/** Song position now, from the audio clock (not Tone's look-ahead clock) so it matches what is heard. */
function transportBeat() {
  const transport = Tone.getTransport()
  return transport.getTicksAtTime(Tone.immediate()) / transport.PPQ - LEAD_BEATS
}

/** A step the student has to play: inside the practice range and containing their hand's notes. */
function isPracticeStep(step: Step, hands: HandFilter, range: { start: number; end: number }) {
  return step.start >= range.start - 1e-3 && step.start < range.end - 1e-3 && step.notes.some((n) => inHands(n, hands))
}

/**
 * Practice engine.
 * - listen: Tone.js plays the song; the current step and sounding notes follow the audio.
 * - wait: nothing plays; the student presses the current step's keys to move on.
 * - game: the song plays on, the student plays their hand in time and is scored;
 *   the other hand (if only one is practised) plays as accompaniment.
 * - train: game scoring on a looped passage; each repetition moves the tempo up the
 *   speed ladder (or back down) until the passage is mastered at full speed.
 */
export function usePlayer(song: Song | null) {
  const steps = useMemo(() => (song ? buildSteps(song) : []), [song])
  const measures = useMemo(() => (song ? barlines(song) : []), [song])
  const songEnd = useMemo(() => (song ? Math.max(0, ...song.notes.map((n) => n.start + n.duration)) : 0), [song])
  const firstMeasure = measures[0]?.number ?? 1
  const lastMeasure = measures[measures.length - 1]?.number ?? 1

  const [mode, setMode] = useState<Mode>('listen')
  const [hands, setHands] = useState<HandFilter>('both')
  const [tempoPct, setTempoPct] = useState(100)
  const [loop, setLoop] = useState<LoopRange | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [listenStep, setListenStep] = useState(-1)
  const [sounding, setSounding] = useState<NoteEvent[]>([])
  const [wait, setWait] = useState<WaitState>(EMPTY_WAIT)
  const [game, setGame] = useState<GameState>(NEW_GAME)
  const [events] = useState(() => new GameEvents())
  const [trainSettings, setTrainSettings] = useState<TrainSettings>(DEFAULT_TRAIN)
  const [train, setTrain] = useState<TrainProgress>(() => startTraining(DEFAULT_TRAIN))
  const bpm = song ? (song.tempo * tempoPct) / 100 : 120

  const range = useMemo(() => {
    const from = loop && measures.find((m) => m.number === loop.from)
    const to = loop && [...measures].reverse().find((m) => m.number === loop.to)
    return from && to ? { start: from.start, end: to.start + to.length } : { start: 0, end: songEnd }
  }, [loop, measures, songEnd])

  // Refs let input callbacks and the animation loop read the latest values.
  const live = useRef({ steps, hands, range, loop, mode, bpm, waitIndex: wait.index, trainSettings })
  useEffect(() => {
    live.current = { steps, hands, range, loop, mode, bpm, waitIndex: wait.index, trainSettings }
  })
  const partRef = useRef<Tone.Part | null>(null)
  const frameRef = useRef(0)
  const beatRef = useRef(0) // song position for the falling-notes view
  const targetsRef = useRef<Target[]>([])
  const judgments = useRef(new Map<NoteEvent, Grade>()) // read by the falling-notes view each frame
  const gameRef = useRef<GameState>(NEW_GAME)
  const waitRef = useRef<WaitState>(EMPTY_WAIT)
  const trainRef = useRef<TrainProgress>(train)
  const repStats = useRef<GameStats>(emptyStats()) // the current training repetition only

  // Game and wait state live in refs too, so key presses can read and update them
  // synchronously (and fire effects exactly once) without waiting for a re-render.
  const updateGame = useCallback((next: GameState) => {
    gameRef.current = next
    setGame(next)
  }, [])
  const updateWait = useCallback((next: WaitState) => {
    waitRef.current = next
    setWait(next)
  }, [])
  const updateTrain = useCallback((next: TrainProgress) => {
    trainRef.current = next
    setTrain(next)
  }, [])

  /** Score one judgement, and celebrate when the combo multiplier goes up. */
  const scoreGrade = useCallback(
    (grade: Grade) => {
      repStats.current = applyGrade(repStats.current, grade)
      const before = gameRef.current.stats
      const stats = applyGrade(before, grade)
      updateGame({ ...gameRef.current, stats, last: { grade, at: performance.now() } })
      if (multiplier(stats.combo) > multiplier(before.combo)) events.emit({ type: 'milestone', multiplier: multiplier(stats.combo) })
    },
    [events, updateGame],
  )

  const firstPracticeStep = useCallback((fromBeat: number) => {
    const { steps, hands, range } = live.current
    return steps.findIndex((s) => s.start >= fromBeat - 1e-3 && isPracticeStep(s, hands, range))
  }, [])

  // ---- playback (listen + game) -----------------------------------------

  const stopTransport = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel()
    partRef.current?.dispose()
    partRef.current = null
    silence()
    setPlaying(false)
    setSounding([])
  }, [])

  const play = useCallback(async () => {
    const currentMode = live.current.mode
    if (!song || currentMode === 'wait') return
    setLoading(true)
    try {
      await loadPiano()
    } finally {
      setLoading(false)
    }
    stopTransport()

    const isGame = isScored(currentMode)
    const isTrain = currentMode === 'train'
    const { hands, range, loop, trainSettings } = live.current
    const transport = Tone.getTransport()
    const ppq = transport.PPQ
    const at = (beat: number) => `${Math.round((beat + LEAD_BEATS) * ppq)}i`
    const freshRun = !(gameRef.current.started && !gameRef.current.finished)
    // A new training run starts at the bottom of the speed ladder.
    const startPct = isTrain && freshRun ? trainSettings.startPct : tempoPct
    if (startPct !== tempoPct) setTempoPct(startPct)
    transport.bpm.value = (song.tempo * startPct) / 100

    // In a game the student plays their own hand; only the other hand is played for them.
    const audible = isGame ? song.notes.filter((n) => !inHands(n, hands)) : song.notes
    const part = new Tone.Part<{ time: string; midi: number; ticks: number }>(
      (time, event) => playNote(event.midi, Tone.Ticks(event.ticks).toSeconds(), time),
      audible.map((n) => ({ time: at(n.start), midi: n.midi, ticks: Math.round(n.duration * ppq) })),
    )
    part.start(0)
    partRef.current = part

    // Training always repeats its passage.
    const looping = isTrain || Boolean(loop)
    transport.loop = looping
    transport.loopStart = at(range.start)
    transport.loopEnd = at(range.end)

    let startBeat: number
    if (isGame) {
      if (!freshRun) {
        startBeat = beatRef.current
      } else {
        targetsRef.current = createTargets(song.notes, hands, range)
        judgments.current.clear()
        repStats.current = emptyStats()
        updateGame({ ...NEW_GAME, stats: emptyStats(), started: true })
        if (isTrain) updateTrain(startTraining(trainSettings))
        startBeat = range.start - leadInBeats(transport.bpm.value)
      }
    } else {
      const current = live.current.steps[listenStep]?.start ?? range.start
      startBeat = current >= range.start && current < range.end ? current : range.start
    }
    transport.ticks = Math.round((startBeat + LEAD_BEATS) * ppq)
    transport.start()
    setPlaying(true)

    let lastStep = -2
    let lastSounding = ''
    let lastBeat = startBeat
    const tick = () => {
      const beat = transportBeat()
      const { steps, loop, range } = live.current
      const secondsPerBeat = 60 / transport.bpm.value

      if (isGame && beat < lastBeat - 0.5) {
        // Going backwards means either the loop wrapped round, or the clock hasn't caught up
        // yet just after starting (it briefly reports its old position). Skip the latter.
        if (!(looping && lastBeat > range.end - 1)) {
          frameRef.current = requestAnimationFrame(tick)
          return
        }
        // The loop wrapped: score what's left of the pass, then start a fresh one.
        sweepMisses(targetsRef.current, Infinity, secondsPerBeat).forEach(() => scoreGrade('miss'))
        if (isTrain) {
          const settings = live.current.trainSettings
          const progress = finishRep(trainRef.current, repStats.current, settings)
          events.emit({ type: 'rep', clean: repAccuracy(repStats.current) >= settings.threshold })
          updateTrain(progress)
          repStats.current = emptyStats()
          setTempoPct(progress.tempoPct)
          transport.bpm.value = (song.tempo * progress.tempoPct) / 100
          if (progress.mastered) {
            stopTransport()
            updateGame({ ...gameRef.current, finished: true })
            return
          }
        }
        targetsRef.current.forEach((t) => (t.grade = null))
        judgments.current.clear()
      }
      lastBeat = beat
      beatRef.current = beat

      // Keep going a moment past the end so the last notes can still be hit or missed.
      const tail = isGame ? WINDOW_SECONDS.good / secondsPerBeat : 0
      if (!(isTrain || loop) && beat >= range.end + tail) {
        stopTransport()
        if (isGame) {
          for (const t of sweepMisses(targetsRef.current, Infinity, secondsPerBeat)) {
            judgments.current.set(t.note, 'miss')
            scoreGrade('miss')
          }
          updateGame({ ...gameRef.current, finished: true })
        } else {
          setListenStep(firstPracticeStep(range.start))
          beatRef.current = range.start
        }
        return
      }

      if (isGame) {
        for (const t of sweepMisses(targetsRef.current, beat, secondsPerBeat)) {
          judgments.current.set(t.note, 'miss')
          scoreGrade('miss')
          events.emit({ type: 'miss', midi: t.note.midi })
        }
      }

      const index = stepAt(steps, beat)
      if (index !== lastStep) {
        lastStep = index
        setListenStep(index)
      }
      const now = song.notes.filter((n) => n.start <= beat && beat < n.start + n.duration)
      const signature = now.map((n) => `${n.midi}${n.hand}`).join()
      if (signature !== lastSounding) {
        lastSounding = signature
        setSounding(now)
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [song, tempoPct, listenStep, stopTransport, firstPracticeStep, updateGame, updateTrain, scoreGrade, events])

  const pause = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    Tone.getTransport().pause()
    silence()
    setPlaying(false)
    setSounding([])
  }, [])

  // Live tempo changes while playing.
  useEffect(() => {
    if (song) Tone.getTransport().bpm.value = (song.tempo * tempoPct) / 100
  }, [song, tempoPct])

  // ---- wait mode ---------------------------------------------------------

  const resetWait = useCallback(
    (fromBeat: number) => {
      updateWait({ ...EMPTY_WAIT, hits: new Set(), index: firstPracticeStep(fromBeat) })
    },
    [firstPracticeStep, updateWait],
  )

  /** Feed every key press here: wait mode checks it and advances, game mode scores it. */
  const registerPress = useCallback(
    (midi: number) => {
      const currentMode = live.current.mode
      if (currentMode === 'listen') {
        events.emit({ type: 'press', midi, ok: true })
        return
      }

      if (isScored(currentMode)) {
        if (Tone.getTransport().state !== 'started' || !gameRef.current.started) return
        const target = judgePress(targetsRef.current, midi, transportBeat(), 60 / Tone.getTransport().bpm.value)
        if (target?.grade && target.grade !== 'miss') {
          judgments.current.set(target.note, target.grade)
          scoreGrade(target.grade)
          events.emit({ type: 'press', midi, ok: true })
          events.emit({ type: 'hit', midi, grade: target.grade })
        } else {
          const current = gameRef.current
          repStats.current = applyWrong(repStats.current)
          updateGame({ ...current, stats: applyWrong(current.stats), last: { grade: 'wrong', at: performance.now() } })
          events.emit({ type: 'press', midi, ok: false })
        }
        return
      }

      const { steps, hands, loop, range } = live.current
      const prev = waitRef.current
      const step = steps[prev.index]
      if (!step || prev.finished) return
      const required = new Set(step.notes.filter((n) => inHands(n, hands)).map((n) => n.midi))
      if (!required.has(midi)) {
        events.emit({ type: 'press', midi, ok: false })
        updateWait({ ...prev, wrong: midi, wrongAt: Date.now() })
        return
      }
      events.emit({ type: 'press', midi, ok: true })

      const hits = new Set(prev.hits).add(midi)
      if (![...required].every((m) => hits.has(m))) {
        updateWait({ ...prev, hits, wrong: null })
        return
      }
      // The whole chord is down: celebrate it and move to the next step.
      required.forEach((m) => events.emit({ type: 'hit', midi: m, grade: 'perfect' }))
      let next = steps.findIndex((s, i) => i > prev.index && isPracticeStep(s, hands, range))
      if (next === -1 && loop) next = steps.findIndex((s) => isPracticeStep(s, hands, range))
      if (next === -1) updateWait({ ...prev, hits, finished: true })
      else updateWait({ index: next, hits: new Set(), wrong: null, wrongAt: 0, finished: false })
    },
    [events, scoreGrade, updateGame, updateWait],
  )

  // Clear the red "wrong key" flash shortly after it appears.
  useEffect(() => {
    if (wait.wrong === null) return
    const timer = setTimeout(() => updateWait({ ...waitRef.current, wrong: null }), 450)
    return () => clearTimeout(timer)
  }, [wait.wrong, wait.wrongAt, updateWait])

  // ---- shared ------------------------------------------------------------

  const stepIndex = mode === 'wait' ? wait.index : listenStep

  /** Current song position in beats, for drawing. Cheap enough to call every frame. */
  const getBeat = useCallback(() => {
    const { mode, steps, waitIndex, range } = live.current
    if (mode === 'wait') return steps[waitIndex]?.start ?? range.start
    return beatRef.current
  }, [])

  const seekToStep = useCallback(
    (index: number) => {
      const step = live.current.steps[index]
      if (!step || isScored(live.current.mode)) return
      if (live.current.mode === 'wait') {
        resetWait(step.start)
        return
      }
      setListenStep(index)
      beatRef.current = step.start
      const transport = Tone.getTransport()
      if (transport.state === 'started') transport.ticks = Math.round((step.start + LEAD_BEATS) * transport.PPQ)
    },
    [resetWait],
  )

  const restart = useCallback(() => {
    stopTransport()
    const { start } = live.current.range
    setListenStep(firstPracticeStep(start))
    resetWait(start)
    targetsRef.current = []
    judgments.current.clear()
    updateGame(NEW_GAME)
    updateTrain(startTraining(live.current.trainSettings))
    repStats.current = emptyStats()
    // In a game the first notes wait above the keys, ready to fall.
    beatRef.current = isScored(live.current.mode) ? start - leadInBeats(live.current.bpm) : start
  }, [stopTransport, firstPracticeStep, resetWait, updateGame, updateTrain])

  // New song, mode, hands or loop: stop and go back to the start of the practice range.
  // Keyed on the song's id so correcting a note doesn't throw the student back to bar 1.
  const songId = song?.id
  useEffect(() => {
    restart()
  }, [songId, mode, hands, loop, restart])

  useEffect(() => stopTransport, [stopTransport])

  const nextWaitStep =
    mode === 'wait' && wait.index >= 0 ? steps.findIndex((s, i) => i > wait.index && isPracticeStep(s, hands, range)) : -1

  return {
    steps,
    measures,
    range,
    events,
    firstMeasure,
    lastMeasure,
    mode,
    setMode,
    hands,
    setHands,
    tempoPct,
    setTempoPct,
    bpm,
    loop,
    setLoop,
    playing,
    loading,
    play,
    pause,
    restart,
    seekToStep,
    stepIndex,
    sounding,
    wait: { ...wait, nextIndex: nextWaitStep },
    game,
    train,
    trainSettings,
    setTrainSettings,
    judgments,
    getBeat,
    registerPress,
  }
}

export type Player = ReturnType<typeof usePlayer>
