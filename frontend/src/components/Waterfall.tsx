import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'
import { FALL_SECONDS } from '../hooks/usePlayer'
import type { Grade } from '../lib/game'
import type { HandFilter, Measure, NoteEvent } from '../lib/music'
import { BLACK_KEY_WIDTH, KEY_LEFT, WHITE_KEY_COUNT, inHands, isBlackKey } from '../lib/music'

interface WaterfallProps {
  notes: NoteEvent[]
  measures: Measure[]
  hands: HandFilter
  bpm: number
  getBeat: () => number
  judgments: RefObject<Map<NoteEvent, Grade>>
  /** Glide to the position instead of jumping (wait mode moves a step at a time). */
  smooth: boolean
}

const GRADE_COLORS: Record<Grade, string> = { perfect: '#22c55e', good: '#a3e635', miss: '#ef4444' }

/**
 * Falling notes: each note drops down its key's lane and reaches the line above the
 * keyboard exactly when it should be played. Drawn on a canvas every frame.
 */
export function Waterfall({ notes, measures, hands, bpm, getBeat, judgments, smooth }: WaterfallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Latest props for the animation loop, which is started once.
  const props = useRef({ notes, measures, hands, bpm, smooth })
  useEffect(() => {
    props.current = { notes, measures, hands, bpm, smooth }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(canvas.clientWidth * dpr)
      canvas.height = Math.round(canvas.clientHeight * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const css = getComputedStyle(document.documentElement)
    const color = (name: string) => css.getPropertyValue(name).trim()
    const colors = { R: color('--right'), L: color('--left'), line: color('--accent'), grid: color('--border'), text: color('--muted') }

    let shown = getBeat()
    let frame = 0
    const draw = () => {
      const { notes, measures, hands, bpm, smooth } = props.current
      const target = getBeat()
      shown = smooth && Math.abs(target - shown) > 1e-3 ? shown + (target - shown) * 0.2 : target

      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const keyWidth = width / WHITE_KEY_COUNT
      const visibleBeats = (FALL_SECONDS * bpm) / 60
      const pxPerBeat = height / visibleBeats
      const yOf = (beat: number) => height - (beat - shown) * pxPerBeat
      ctx.clearRect(0, 0, width, height)

      // Lanes: a faint line between white keys, a stronger one at every C.
      for (let i = 0; i <= WHITE_KEY_COUNT; i++) {
        const isC = i >= 2 && (i - 2) % 7 === 0 // white key 2 is C1
        ctx.fillStyle = colors.grid
        ctx.globalAlpha = isC ? 0.9 : 0.35
        ctx.fillRect(Math.round(i * keyWidth), 0, 1, height)
      }

      // Bar lines with their numbers.
      ctx.font = '600 11px system-ui, sans-serif'
      for (const m of measures) {
        const y = yOf(m.start)
        if (y < 0 || y > height) continue
        ctx.globalAlpha = 0.6
        ctx.fillStyle = colors.grid
        ctx.fillRect(0, Math.round(y), width, 1)
        ctx.globalAlpha = 0.8
        ctx.fillStyle = colors.text
        ctx.fillText(m.number === 0 ? 'pickup' : String(m.number), 4, y - 4)
      }

      // Notes: white-key notes first so black-key notes sit on top, like the keys themselves.
      const end = shown + visibleBeats
      for (const pass of [false, true]) {
        for (const n of notes) {
          if (isBlackKey(n.midi) !== pass || n.start > end || n.start + n.duration < shown - 0.05) continue
          const x = (KEY_LEFT.get(n.midi) ?? 0) * keyWidth
          const w = (pass ? BLACK_KEY_WIDTH : 1) * keyWidth
          const bottom = yOf(n.start)
          const top = yOf(n.start + n.duration)
          const grade = judgments.current?.get(n)
          const mine = inHands(n, hands)
          const sounding = n.start <= shown && shown < n.start + n.duration

          ctx.globalAlpha = mine ? (grade === 'miss' ? 0.55 : 1) : 0.3
          ctx.fillStyle = grade ? GRADE_COLORS[grade] : colors[n.hand]
          ctx.shadowColor = ctx.fillStyle
          ctx.shadowBlur = sounding && mine ? 14 : 0
          ctx.beginPath()
          ctx.roundRect(x + 1.5, top, w - 3, Math.max(bottom - top - 1, 4), Math.min(5, w / 4))
          ctx.fill()
          ctx.shadowBlur = 0

          if (w >= 16 && bottom - top >= 16) {
            ctx.globalAlpha = mine ? 1 : 0.6
            ctx.fillStyle = '#ffffff'
            ctx.font = `700 ${Math.min(11, w * 0.4)}px system-ui, sans-serif`
            ctx.textAlign = 'center'
            ctx.fillText(n.pitch, x + w / 2, Math.min(bottom, height) - 5)
            ctx.textAlign = 'left'
          }
        }
      }

      // The hit line: play each note as it reaches here.
      ctx.globalAlpha = 1
      ctx.fillStyle = colors.line
      ctx.shadowColor = colors.line
      ctx.shadowBlur = 8
      ctx.fillRect(0, height - 3, width, 3)
      ctx.shadowBlur = 0

      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [getBeat, judgments])

  return (
    <div className="waterfall">
      <canvas ref={canvasRef} aria-label="Falling notes" />
    </div>
  )
}
