import type { Grade } from './game'

/** Moments the falling-notes view reacts to with effects. */
export type GameEvent =
  | { type: 'press'; midi: number; ok: boolean }
  | { type: 'hit'; midi: number; grade: Exclude<Grade, 'miss'> }
  | { type: 'miss'; midi: number }
  | { type: 'milestone'; multiplier: number }

/**
 * A tiny event channel from the player to the canvas. Effects fire many times a second,
 * so they bypass React state (and re-renders) entirely.
 */
export class GameEvents {
  private listeners = new Set<(event: GameEvent) => void>()

  on(listener: (event: GameEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: GameEvent) {
    this.listeners.forEach((listener) => listener(event))
  }
}
