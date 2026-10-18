import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'
import { FALL_SECONDS } from '../hooks/usePlayer'
import type { GameEvent, GameEvents } from '../lib/effects'
import type { Grade } from '../lib/game'
import type { HandFilter, Measure, NoteEvent } from '../lib/music'
import { BLACK_KEY_WIDTH, KEY_LEFT, WHITE_KEY_COUNT, inHands, isBlackKey } from '../lib/music'
import type { Theme } from '../lib/themes'

interface WaterfallProps {
  notes: NoteEvent[]
  measures: Measure[]
  hands: HandFilter
  bpm: number
  range: { start: number; end: number }
  getBeat: () => number
  judgments: RefObject<Map<NoteEvent, Grade>>
  events: GameEvents
  theme: Theme
  /** Glide to the position instead of jumping (wait mode moves a step at a time). */
  smooth: boolean
  /** Show 3-2-1-GO before the first note (game mode). */
  countdown: boolean
}

type Palette = NonNullable<Theme['colors']>

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: string
}
interface Ring {
  x: number
  y: number
  age: number
  life: number
  radius: number
  color: string
}
interface Beam {
  x: number
  width: number
  age: number
  life: number
  strength: number
  color: string
}

const MAX_PARTICLES = 700
const GRAVITY = 900 // px/s²

/** The app's own colours, for the Classic theme. */
function cssPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    backgroundTop: v('--bg'),
    backgroundBottom: v('--surface-2'),
    lane: v('--border'),
    right: v('--right'),
    left: v('--left'),
    hitLine: v('--accent'),
    text: v('--muted'),
    perfect: '#22c55e',
    good: '#84cc16',
    miss: '#ef4444',
  }
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)

/**
 * Falling notes: each note drops down its key's lane and reaches the line above the
 * keyboard exactly when it should be played. Hits, misses and key presses spawn particle
 * effects. Everything is drawn on one canvas each frame.
 */
export function Waterfall(props: WaterfallProps) {
  const { getBeat, judgments, events, theme } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Latest props for the animation loop, which is started once per theme.
  const live = useRef(props)
  useEffect(() => {
    live.current = props
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

    const palette = theme.colors ?? cssPalette()
    const particles: Particle[] = []
    const rings: Ring[] = []
    const beams: Beam[] = []
    let shake = 0 // seconds of screen shake left
    let pulse = 0 // hit-line brightness boost, decays to 0
    let flash = 0 // full-screen flash on milestones

    const lane = (midi: number) => {
      const keyWidth = canvas.clientWidth / WHITE_KEY_COUNT
      const width = (isBlackKey(midi) ? BLACK_KEY_WIDTH : 1) * keyWidth
      return { x: (KEY_LEFT.get(midi) ?? 0) * keyWidth, width }
    }
    const burst = (x: number, y: number, count: number, colors: string[], speed: number, spread = Math.PI / 2.4, up = true) => {
      for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
        const angle = (up ? -Math.PI / 2 : Math.PI / 2) + rand(-spread, spread)
        const v = rand(speed * 0.35, speed)
        particles.push({
          x: x + rand(-4, 4),
          y,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v,
          age: 0,
          life: rand(0.35, 0.8),
          size: rand(1.5, 3.6),
          color: colors[i % colors.length],
        })
      }
    }

    const onEvent = (event: GameEvent) => {
      const hitY = canvas.clientHeight - 3
      if (event.type === 'milestone') {
        const width = canvas.clientWidth
        for (let i = 0; i < 80; i++) burst(rand(0, width), hitY, 1, [palette.right, palette.left, palette.perfect, '#ffffff'], 900)
        shake = 0.35
        flash = 0.35
        return
      }
      const { x, width } = lane(event.midi)
      const centre = x + width / 2
      if (event.type === 'press') {
        beams.push({ x, width, age: 0, life: 0.28, strength: event.ok ? 0.55 : 0.8, color: event.ok ? palette.hitLine : palette.miss })
        if (!event.ok) burst(centre, hitY, 6, [palette.miss], 260)
      } else if (event.type === 'hit') {
        const perfect = event.grade === 'perfect'
        const color = perfect ? palette.perfect : palette.good
        burst(centre, hitY, perfect ? 28 : 14, [color, '#ffffff', color], perfect ? 720 : 480)
        rings.push({ x: centre, y: hitY, age: 0, life: 0.45, radius: perfect ? 48 : 30, color })
        beams.push({ x, width, age: 0, life: 0.4, strength: 1, color })
        pulse = Math.min(1, pulse + (perfect ? 0.6 : 0.35))
      } else if (event.type === 'miss') {
        burst(centre, hitY, 8, [palette.miss], 160, Math.PI / 3, false)
        beams.push({ x, width, age: 0, life: 0.3, strength: 0.45, color: palette.miss })
      }
    }
    const unsubscribe = events.on(onEvent)

    let shown = getBeat()
    let last = performance.now()
    let frame = 0
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { notes, measures, hands, bpm, range, smooth, countdown } = live.current
      const target = getBeat()
      shown = smooth && Math.abs(target - shown) > 1e-3 ? shown + (target - shown) * Math.min(1, dt * 12) : target

      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const keyWidth = width / WHITE_KEY_COUNT
      const visibleBeats = (FALL_SECONDS * bpm) / 60
      const pxPerBeat = height / visibleBeats
      const yOf = (beat: number) => height - (beat - shown) * pxPerBeat

      ctx.save()
      if (shake > 0) {
        shake -= dt
        const amount = 6 * (shake / 0.35)
        ctx.translate(rand(-amount, amount), rand(-amount, amount))
      }

      // Background.
      const gradient = ctx.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, palette.backgroundTop)
      gradient.addColorStop(1, palette.backgroundBottom)
      ctx.fillStyle = gradient
      ctx.fillRect(-10, -10, width + 20, height + 20)

      // Lanes: a faint line between white keys, a stronger one at every C.
      ctx.fillStyle = palette.lane
      for (let i = 0; i <= WHITE_KEY_COUNT; i++) {
        const isC = i >= 2 && (i - 2) % 7 === 0 // white key 2 is C1
        ctx.globalAlpha = isC ? 0.7 : 0.22
        ctx.fillRect(Math.round(i * keyWidth), 0, 1, height)
      }

      // Bar lines with their numbers.
      ctx.font = '600 11px system-ui, sans-serif'
      for (const m of measures) {
        const y = yOf(m.start)
        if (y < 0 || y > height) continue
        ctx.globalAlpha = 0.45
        ctx.fillStyle = palette.lane
        ctx.fillRect(0, Math.round(y), width, 1)
        ctx.globalAlpha = 0.8
        ctx.fillStyle = palette.text
        ctx.fillText(m.number === 0 ? 'pickup' : String(m.number), 4, y - 4)
      }

      // Light beams rising from pressed keys, behind the notes.
      for (let i = beams.length - 1; i >= 0; i--) {
        const beam = beams[i]
        beam.age += dt
        if (beam.age >= beam.life) {
          beams.splice(i, 1)
          continue
        }
        const fade = 1 - beam.age / beam.life
        const light = ctx.createLinearGradient(0, height, 0, height * 0.25)
        light.addColorStop(0, beam.color)
        light.addColorStop(1, 'transparent')
        ctx.globalAlpha = 0.55 * beam.strength * fade
        ctx.fillStyle = light
        ctx.fillRect(beam.x, height * 0.25, beam.width, height * 0.75)
      }

      // Notes: white-key notes first so black-key notes sit on top, like the keys themselves.
      const end = shown + visibleBeats
      for (const black of [false, true]) {
        for (const n of notes) {
          if (isBlackKey(n.midi) !== black || n.start > end || n.start + n.duration < shown - 0.05) continue
          const { x, width: w } = lane(n.midi)
          const bottom = yOf(n.start)
          const top = yOf(n.start + n.duration)
          const grade = judgments.current?.get(n)
          const mine = inHands(n, hands)
          const sounding = n.start <= shown && shown < n.start + n.duration
          const color = grade ? palette[grade] : palette[n.hand === 'R' ? 'right' : 'left']

          ctx.globalAlpha = mine ? (grade === 'miss' ? 0.5 : 1) : 0.28
          ctx.fillStyle = color
          ctx.shadowColor = color
          ctx.shadowBlur = sounding && mine ? 18 : theme.glow && mine ? 6 : 0
          ctx.beginPath()
          ctx.roundRect(x + 1.5, top, w - 3, Math.max(bottom - top - 1, 4), Math.min(5, w / 4))
          ctx.fill()
          ctx.shadowBlur = 0

          if (w >= 16 && bottom - top >= 16) {
            ctx.globalAlpha = mine ? 0.95 : 0.6
            ctx.fillStyle = theme.colors ? '#0b0b12' : '#ffffff'
            ctx.font = `700 ${Math.min(11, w * 0.4)}px system-ui, sans-serif`
            ctx.textAlign = 'center'
            ctx.fillText(n.pitch, x + w / 2, Math.min(bottom, height) - 5)
            ctx.textAlign = 'left'
          }
        }
      }

      // The hit line: play each note as it reaches here. It brightens with each hit.
      pulse = Math.max(0, pulse - dt * 2.5)
      ctx.globalAlpha = 1
      ctx.fillStyle = palette.hitLine
      ctx.shadowColor = palette.hitLine
      ctx.shadowBlur = 8 + pulse * 22
      ctx.fillRect(0, height - 3 - pulse * 1.5, width, 3 + pulse * 3)
      ctx.shadowBlur = 0

      // Particles and rings, glowing where colours overlap on dark themes.
      if (theme.glow) ctx.globalCompositeOperation = 'lighter'
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.age += dt
        if (p.age >= p.life || p.y > height + 10) {
          particles.splice(i, 1)
          continue
        }
        p.vy += GRAVITY * dt
        p.vx *= 1 - dt * 1.5
        p.x += p.vx * dt
        p.y += p.vy * dt
        ctx.globalAlpha = 1 - p.age / p.life
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (1 - (p.age / p.life) * 0.5), 0, Math.PI * 2)
        ctx.fill()
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]
        r.age += dt
        if (r.age >= r.life) {
          rings.splice(i, 1)
          continue
        }
        const t = r.age / r.life
        ctx.globalAlpha = (1 - t) * 0.9
        ctx.strokeStyle = r.color
        ctx.lineWidth = 3 * (1 - t) + 1
        ctx.beginPath()
        ctx.ellipse(r.x, r.y, r.radius * (0.3 + t), r.radius * 0.45 * (0.3 + t), 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'

      if (flash > 0) {
        flash -= dt
        ctx.globalAlpha = Math.max(0, flash) * 0.5
        ctx.fillStyle = palette.hitLine
        ctx.fillRect(0, 0, width, height)
      }

      // 3-2-1-GO before the first note.
      if (countdown) {
        const secondsToStart = ((range.start - shown) * 60) / bpm
        let label = ''
        let phase = 0
        if (secondsToStart > 0 && secondsToStart <= 3) {
          label = String(Math.ceil(secondsToStart))
          phase = secondsToStart % 1 || 1
        } else if (secondsToStart <= 0 && secondsToStart > -0.6) {
          label = 'GO!'
          phase = 1 + secondsToStart / 0.6
        }
        if (label) {
          ctx.globalAlpha = Math.min(1, phase * 1.4)
          ctx.fillStyle = palette.hitLine
          ctx.shadowColor = palette.hitLine
          ctx.shadowBlur = 24
          ctx.font = `900 ${Math.round(Math.min(height * 0.28, 120) * (1.25 - phase * 0.25))}px system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(label, width / 2, height * 0.42)
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
          ctx.shadowBlur = 0
        }
      }

      // Song progress along the top.
      const progress = Math.min(1, Math.max(0, (shown - range.start) / Math.max(1e-6, range.end - range.start)))
      ctx.globalAlpha = 0.25
      ctx.fillStyle = palette.text
      ctx.fillRect(0, 0, width, 3)
      ctx.globalAlpha = 1
      ctx.fillStyle = palette.hitLine
      ctx.fillRect(0, 0, width * progress, 3)

      ctx.restore()
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      unsubscribe()
    }
  }, [getBeat, judgments, events, theme])

  return (
    <div className="waterfall">
      <canvas ref={canvasRef} aria-label="Falling notes" />
    </div>
  )
}
