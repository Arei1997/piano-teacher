import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { loadPiano, playNote, silence } from '../lib/audio'
import type { HandFilter, NoteEvent, Song, Step } from '../lib/music'
import { barlines, buildSteps, inHands, stepAt } from '../lib/music'

export type Mode = 'listen' | 'wait'
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

const EMPTY_WAIT: WaitState = { index: -1, hits: new Set(), wrong: null, wrongAt: 0, finished: false }

/** A step the student has to play: inside the practice range and containing their hand's notes. */
function isPracticeStep(step: Step, hands: HandFilter, range: { start: number; end: number }) {
  return step.start >= range.start - 1e-3 && step.start < range.end - 1e-3 && step.notes.some((n) => inHands(n, hands))
}

/**
 * Practice engine.
 * - listen: Tone.js plays the song; the current step and sounding notes follow the audio.
 * - wait: nothing plays; the student presses the current step's keys to move on.
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

  const range = useMemo(() => {
    const from = loop && measures.find((m) => m.number === loop.from)
    const to = loop && [...measures].reverse().find((m) => m.number === loop.to)
    return from && to ? { start: from.start, end: to.start + to.length } : { start: 0, end: songEnd }
  }, [loop, measures, songEnd])

  // Refs let input callbacks and the animation loop read the latest values.
  const live = useRef({ steps, hands, range, loop, mode })
  useEffect(() => {
    live.current = { steps, hands, range, loop, mode }
  })
  const partRef = useRef<Tone.Part | null>(null)
  const frameRef = useRef(0)

  const firstPracticeStep = useCallback((fromBeat: number) => {
    const { steps, hands, range } = live.current
    return steps.findIndex((s) => s.start >= fromBeat - 1e-3 && isPracticeStep(s, hands, range))
  }, [])

  // ---- listen mode -------------------------------------------------------

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
    if (!song || live.current.mode !== 'listen') return
    setLoading(true)
    try {
      await loadPiano()
    } finally {
      setLoading(false)
    }
    stopTransport()

    const transport = Tone.getTransport()
    const ppq = transport.PPQ
    transport.bpm.value = (song.tempo * tempoPct) / 100
    const part = new Tone.Part<{ time: string; midi: number; ticks: number }>(
      (time, event) => playNote(event.midi, Tone.Ticks(event.ticks).toSeconds(), time),
      song.notes.map((n) => ({ time: `${Math.round(n.start * ppq)}i`, midi: n.midi, ticks: Math.round(n.duration * ppq) })),
    )
    part.start(0)
    partRef.current = part

    const { start, end } = live.current.range
    transport.loop = Boolean(live.current.loop)
    transport.loopStart = `${Math.round(start * ppq)}i`
    transport.loopEnd = `${Math.round(end * ppq)}i`
    const current = live.current.steps[listenStep]?.start ?? start
    transport.ticks = Math.round((current >= start && current < end ? current : start) * ppq)
    transport.start()
    setPlaying(true)

    let lastStep = -2
    let lastSounding = ''
    const tick = () => {
      // Ticks at the audio clock (not the look-ahead clock) so visuals match what is heard.
      const beat = transport.getTicksAtTime(Tone.immediate()) / ppq
      const { steps, loop } = live.current
      if (!loop && beat >= live.current.range.end) {
        stopTransport()
        setListenStep(firstPracticeStep(live.current.range.start))
        return
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
  }, [song, tempoPct, listenStep, stopTransport, firstPracticeStep])

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
      setWait({ ...EMPTY_WAIT, hits: new Set(), index: firstPracticeStep(fromBeat) })
    },
    [firstPracticeStep],
  )

  /** Feed every key press here; in wait mode it checks the press and advances. */
  const registerPress = useCallback(
    (midi: number) => {
      if (live.current.mode !== 'wait') return
      setWait((prev) => {
        const { steps, hands, loop, range } = live.current
        const step = steps[prev.index]
        if (!step || prev.finished) return prev
        const required = new Set(step.notes.filter((n) => inHands(n, hands)).map((n) => n.midi))
        if (!required.has(midi)) return { ...prev, wrong: midi, wrongAt: Date.now() }

        const hits = new Set(prev.hits).add(midi)
        if (![...required].every((m) => hits.has(m))) return { ...prev, hits, wrong: null }

        let next = steps.findIndex((s, i) => i > prev.index && isPracticeStep(s, hands, range))
        if (next === -1 && loop) next = steps.findIndex((s) => isPracticeStep(s, hands, range))
        if (next === -1) return { ...prev, hits, finished: true }
        return { index: next, hits: new Set(), wrong: null, wrongAt: 0, finished: false }
      })
    },
    [],
  )

  // Clear the red "wrong key" flash shortly after it appears.
  useEffect(() => {
    if (wait.wrong === null) return
    const timer = setTimeout(() => setWait((w) => ({ ...w, wrong: null })), 450)
    return () => clearTimeout(timer)
  }, [wait.wrong, wait.wrongAt])

  // ---- shared ------------------------------------------------------------

  const stepIndex = mode === 'wait' ? wait.index : listenStep

  const seekToStep = useCallback(
    (index: number) => {
      const step = live.current.steps[index]
      if (!step) return
      if (live.current.mode === 'wait') {
        resetWait(step.start)
        return
      }
      setListenStep(index)
      const transport = Tone.getTransport()
      if (transport.state === 'started') transport.ticks = Math.round(step.start * transport.PPQ)
    },
    [resetWait],
  )

  const restart = useCallback(() => {
    stopTransport()
    const start = live.current.range.start
    setListenStep(firstPracticeStep(start))
    resetWait(start)
  }, [stopTransport, firstPracticeStep, resetWait])

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
    firstMeasure,
    lastMeasure,
    mode,
    setMode,
    hands,
    setHands,
    tempoPct,
    setTempoPct,
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
    registerPress,
  }
}

export type Player = ReturnType<typeof usePlayer>
