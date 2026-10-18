import { useEffect, useState } from 'react'
import type { GameState } from '../hooks/usePlayer'
import { accuracy, multiplier, rank } from '../lib/game'

const GRADE_TEXT = { perfect: 'Perfect!', good: 'Good', miss: 'Miss', wrong: 'Wrong note' } as const

/** Score, combo and a flash of the last judgement, shown over the falling notes. */
export function GameHud({ game, playing }: { game: GameState; playing: boolean }) {
  const { stats, last } = game
  return (
    <div className="game-hud" aria-live="polite">
      <div className="hud-score">
        <b>{stats.score.toLocaleString()}</b>
        <span>
          {stats.combo} combo · ×{multiplier(stats.combo)}
        </span>
      </div>
      {last ? (
        <div key={last.at} className={`hud-grade grade-${last.grade}`}>
          {GRADE_TEXT[last.grade]}
        </div>
      ) : null}
      {!game.started && !playing ? <div className="hud-hint">Press Play, then play the notes as they reach the line</div> : null}
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
