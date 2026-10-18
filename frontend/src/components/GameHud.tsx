import { useEffect, useState } from 'react'
import type { GameState, LoopRange } from '../hooks/usePlayer'
import type { TrainProgress, TrainSettings } from '../lib/game'
import { accuracy, multiplier, rank } from '../lib/game'

const GRADE_TEXT = { perfect: 'Perfect!', good: 'Good', miss: 'Miss', wrong: 'Wrong note' } as const

/** Score, combo and a flash of the last judgement, shown over the falling notes. */
export function GameHud({ game, playing }: { game: GameState; playing: boolean }) {
  const { stats, last } = game
  const mult = multiplier(stats.combo)
  // A new multiplier is announced for the first couple of notes after reaching it.
  const justLevelled = mult > 1 && stats.combo % 10 < 2
  return (
    <div className="game-hud" aria-live="polite">
      <div className="hud-score">
        <b>{stats.score.toLocaleString()}</b>
        <span className="hud-combo">
          {/* Re-keyed on each hit so the bump animation replays. */}
          <span key={stats.combo} className={stats.combo ? 'bump' : ''}>
            {stats.combo}
          </span>{' '}
          combo
          <span className={`mult mult-${mult}`}>×{mult}</span>
        </span>
      </div>
      {justLevelled ? (
        <div key={`m${mult}`} className="hud-milestone">
          ×{mult} combo!
        </div>
      ) : null}
      {last ? (
        <div key={last.at} className={`hud-grade grade-${last.grade}`}>
          {GRADE_TEXT[last.grade]}
        </div>
      ) : null}
      {!game.started && !playing ? <div className="hud-hint">Press Play, then play the notes as they reach the line</div> : null}
    </div>
  )
}

/** Training progress: repetitions, the speed ladder, and clean reps needed at full speed. */
export function TrainHud({ progress, settings, playing }: { progress: TrainProgress; settings: TrainSettings; playing: boolean }) {
  const { startPct, targetPct } = settings
  const climb = targetPct > startPct ? (progress.tempoPct - startPct) / (targetPct - startPct) : 1
  const atTarget = progress.tempoPct >= targetPct
  const last = progress.lastAccuracy
  return (
    <div className="train-hud" aria-live="polite">
      <div className="train-row">
        <b>Rep {progress.rep + (playing ? 1 : 0)}</b>
        {last !== null ? (
          <span className={last >= settings.threshold ? 'ok' : 'bad'}>
            last {Math.round(last * 100)}% {last >= settings.threshold ? '✓' : '✗'}
          </span>
        ) : (
          <span className="muted">clean = {Math.round(settings.threshold * 100)}%+</span>
        )}
      </div>
      <div className="ladder" title="Speed ladder: clean reps speed you up, sloppy ones slow you down">
        <span>{startPct}%</span>
        <div className="ladder-track">
          <div className="ladder-fill" style={{ width: `${Math.max(4, climb * 100)}%` }} />
        </div>
        <span>{targetPct}%</span>
      </div>
      <div className="train-row">
        <span>Speed {progress.tempoPct}%</span>
        <span className="dots" aria-label={`${progress.cleanAtTarget} of ${settings.repsNeeded} clean at full speed`}>
          {Array.from({ length: settings.repsNeeded }, (_, i) => (
            <i key={i} className={i < progress.cleanAtTarget ? 'on' : atTarget ? 'ready' : ''} />
          ))}
        </span>
      </div>
    </div>
  )
}

interface MasteredProps {
  loop: LoopRange | null
  firstMeasure: number
  lastMeasure: number
  settings: TrainSettings
  onChunk: (loop: LoopRange) => void
  onFaster: () => void
  onAgain: () => void
  onClose: () => void
}

/** Shown when a passage is mastered: suggests the next chunk (the "add-a-bar" method). */
export function MasteredDialog({ loop, firstMeasure, lastMeasure, settings, onChunk, onFaster, onAgain, onClose }: MasteredProps) {
  const from = loop?.from ?? firstMeasure
  const to = loop?.to ?? lastMeasure
  const length = to - from + 1
  const next = to < lastMeasure ? { from: to + 1, to: Math.min(lastMeasure, to + length) } : null
  const joined = from > firstMeasure ? { from: Math.max(firstMeasure, from - length), to } : null
  const label = (r: LoopRange) => (r.from === r.to ? `bar ${r.from}` : `bars ${r.from}–${r.to}`)

  return (
    <div className="dialog-backdrop">
      <div className="dialog results" role="dialog" aria-modal="true">
        <div className="rank rank-S">★</div>
        <h2>Mastered!</h2>
        <p className="muted">
          {loop ? label({ from, to }) : 'The whole piece'}, {settings.repsNeeded} clean reps in a row at {settings.targetPct}% speed.
        </p>
        <div className="mastered-actions">
          {next ? (
            <button className="primary" onClick={() => onChunk(next)}>
              Next: {label(next)} →
            </button>
          ) : null}
          {joined ? <button onClick={() => onChunk(joined)}>Join up: {label(joined)}</button> : null}
          <button onClick={onFaster}>Push the target to {settings.targetPct + 10}%</button>
          <button onClick={onAgain}>Practise again</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function bestKey(songId: number, hands: string) {
  return `pianoteacher:best:${songId}:${hands}`
}

function readBest(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0
  } catch {
    return 0
  }
}

interface ResultsProps {
  game: GameState
  songId: number
  hands: string
  onAgain: () => void
  onClose: () => void
}

/** End-of-song results, with the best score for this song and hand kept on this device. */
export function GameResults({ game, songId, hands, onAgain, onClose }: ResultsProps) {
  const { stats } = game
  const key = bestKey(songId, hands)
  const [previousBest] = useState(() => readBest(key))
  const isBest = stats.score > previousBest

  useEffect(() => {
    if (!isBest) return
    try {
      localStorage.setItem(key, String(stats.score))
    } catch {
      /* storage unavailable: the score just isn't remembered */
    }
  }, [isBest, key, stats.score])

  return (
    <div className="dialog-backdrop">
      <div className="dialog results" role="dialog" aria-modal="true">
        <div className={`rank rank-${rank(stats)}`}>{rank(stats)}</div>
        <h2>{stats.score.toLocaleString()} points</h2>
        <p className="muted">{isBest ? (previousBest ? 'New best score!' : 'First score for this song!') : `Best: ${previousBest.toLocaleString()}`}</p>
        <dl>
          <dt>Accuracy</dt>
          <dd>{Math.round(accuracy(stats) * 100)}%</dd>
          <dt>Perfect</dt>
          <dd>{stats.perfect}</dd>
          <dt>Good</dt>
          <dd>{stats.good}</dd>
          <dt>Missed</dt>
          <dd>{stats.miss}</dd>
          <dt>Wrong notes</dt>
          <dd>{stats.wrong}</dd>
          <dt>Best combo</dt>
          <dd>{stats.maxCombo}</dd>
        </dl>
        <div className="row">
          <button className="primary" onClick={onAgain}>
            Play again
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
