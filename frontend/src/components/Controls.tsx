import type { ReactNode } from 'react'
import type { Player } from '../hooks/usePlayer'
import type { HandFilter } from '../lib/music'
import { THEMES } from '../lib/themes'
import { Icon } from './Icon'
import type { KeyLabels } from './Piano'

export type View = 'sheet' | 'falling'

/** Listen / Wait for me / Game / Train. Game switches to falling notes, where it's played. */
export function ModeSwitch({ player, setView }: { player: Player; setView: (view: View) => void }) {
  const { mode } = player
  return (
    <div className="segmented mode-switch" role="group" aria-label="Practice mode">
      <button className={mode === 'listen' ? 'active' : ''} onClick={() => player.setMode('listen')}>
        Listen
      </button>
      <button className={mode === 'wait' ? 'active' : ''} onClick={() => player.setMode('wait')}>
        Wait<span className="long"> for me</span>
      </button>
      <button
        className={mode === 'game' ? 'active' : ''}
        onClick={() => {
          player.setMode('game')
          setView('falling')
        }}
      >
        Game
      </button>
      <button
        className={mode === 'train' ? 'active' : ''}
        title="Loop a short passage, speeding up with each clean repetition"
        onClick={() => {
          player.setMode('train')
          // Long pieces are learnt in small chunks: start with the first two bars.
          if (!player.loop && player.lastMeasure - player.firstMeasure >= 8) {
            player.setLoop({ from: player.firstMeasure, to: player.firstMeasure + 1 })
          }
        }}
      >
        Train
      </button>
    </div>
  )
}

/** Play / pause and restart. `compact` drops the labels (used in the collapsed bar). */
export function Transport({ player, compact = false }: { player: Player; compact?: boolean }) {
  const { mode, playing, loading } = player
  return (
    <div className="transport">
      {mode !== 'wait' ? (
        <button
          className={`primary play${compact ? ' compact' : ''}`}
          onClick={playing ? player.pause : player.play}
          disabled={loading}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {loading ? (
            compact ? '…' : 'Loading…'
          ) : (
            <>
              <Icon name={playing ? 'pause' : 'play'} />
              {compact ? null : <span>{playing ? 'Pause' : 'Play'}</span>}
            </>
          )}
        </button>
      ) : null}
      <button className="icon-button" onClick={player.restart} title="Back to the start" aria-label="Restart">
        <Icon name="restart" />
      </button>
    </div>
  )
}

interface OptionsProps {
  player: Player
  keyLabels: KeyLabels
  setKeyLabels: (labels: KeyLabels) => void
  view: View
  setView: (view: View) => void
  themeId: string
  setThemeId: (id: string) => void
  baseTempo: number
  midi: { supported: boolean; devices: string[]; error: string | null; connect: () => void }
  soundOnMidi: boolean
  setSoundOnMidi: (value: boolean) => void
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="option-group">
      <span className="option-label">{label}</span>
      <div className="option-body">{children}</div>
    </div>
  )
}

/** Everything that isn't needed every few seconds, grouped and labelled. */
export function OptionsPanel({
  player,
  keyLabels,
  setKeyLabels,
  view,
  setView,
  themeId,
  setThemeId,
  baseTempo,
  midi,
  soundOnMidi,
  setSoundOnMidi,
}: OptionsProps) {
  const { mode, loop, firstMeasure, lastMeasure } = player
  const setLoopEdge = (edge: 'from' | 'to', value: number) => {
    const current = loop ?? { from: firstMeasure, to: lastMeasure }
    const next = { ...current, [edge]: Math.min(lastMeasure, Math.max(firstMeasure, Number.isFinite(value) ? value : firstMeasure)) }
    if (next.from > next.to) next[edge === 'from' ? 'to' : 'from'] = next[edge]
    player.setLoop(next)
  }

  return (
    <div className="options">
      <Group label="Hands">
        <div className="segmented" role="group" aria-label="Hands">
          {(
            [
              ['both', 'Both'],
              ['L', 'Left'],
              ['R', 'Right'],
            ] as [HandFilter, string][]
          ).map(([value, label]) => (
            <button key={value} className={player.hands === value ? 'active' : ''} onClick={() => player.setHands(value)}>
              {label}
            </button>
          ))}
        </div>
      </Group>

      <Group label={`Speed · ${player.tempoPct}% (${Math.round((baseTempo * player.tempoPct) / 100)} bpm)`}>
        <input
          type="range"
          className="speed"
          min={25}
          max={150}
          step={5}
          value={player.tempoPct}
          onChange={(e) => player.setTempoPct(Number(e.target.value))}
          aria-label="Speed"
        />
      </Group>

      <Group label="Loop">
        <label className="inline">
          <input
            type="checkbox"
            checked={Boolean(loop)}
            onChange={(e) => player.setLoop(e.target.checked ? { from: firstMeasure, to: Math.min(firstMeasure + 3, lastMeasure) } : null)}
          />
          {loop ? 'Bars' : 'Off'}
          {loop ? (
            <>
              <input type="number" min={firstMeasure} max={lastMeasure} value={loop.from} onChange={(e) => setLoopEdge('from', Number(e.target.value))} aria-label="First bar" />
              –
              <input type="number" min={firstMeasure} max={lastMeasure} value={loop.to} onChange={(e) => setLoopEdge('to', Number(e.target.value))} aria-label="Last bar" />
            </>
          ) : null}
        </label>
      </Group>

      <Group label="View">
        <div className="option-row">
          <div className="segmented" role="group" aria-label="View">
            <button className={view === 'sheet' ? 'active' : ''} onClick={() => setView('sheet')}>
              Sheet
            </button>
            <button className={view === 'falling' ? 'active' : ''} onClick={() => setView('falling')}>
              Falling notes
            </button>
          </div>
          {view === 'falling' ? (
            <select value={themeId} onChange={(e) => setThemeId(e.target.value)} aria-label="Theme" className="theme-select">
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </Group>

      <Group label="Key labels">
        <div className="segmented" role="group" aria-label="Key labels">
          {(
            [
              ['full', 'Note + octave'],
              ['letters', 'Letters'],
              ['none', 'Off'],
            ] as [KeyLabels, string][]
          ).map(([value, label]) => (
            <button key={value} className={keyLabels === value ? 'active' : ''} onClick={() => setKeyLabels(value)}>
              {label}
            </button>
          ))}
        </div>
      </Group>

      {mode === 'train' ? (
        <Group label="Training speed">
          <label className="inline ladder-inputs" title="Where each run starts, and the speed to master it at">
            <input
              type="number"
              min={20}
              max={player.trainSettings.targetPct}
              step={5}
              value={player.trainSettings.startPct}
              onChange={(e) => player.setTrainSettings({ ...player.trainSettings, startPct: Number(e.target.value) || 20 })}
              aria-label="Start speed"
            />
            % to
            <input
              type="number"
              min={player.trainSettings.startPct}
              max={150}
              step={5}
              value={player.trainSettings.targetPct}
              onChange={(e) => player.setTrainSettings({ ...player.trainSettings, targetPct: Number(e.target.value) || 100 })}
              aria-label="Target speed"
            />
            %
          </label>
        </Group>
      ) : null}

      <Group label="MIDI keyboard">
        {midi.devices.length ? (
          <div className="option-row">
            <span className="ok connected">{midi.devices.join(', ')}</span>
            <label className="inline">
              <input type="checkbox" checked={soundOnMidi} onChange={(e) => setSoundOnMidi(e.target.checked)} />
              App sound
            </label>
          </div>
        ) : (
          <button onClick={midi.connect}>Connect</button>
        )}
        {midi.error ? <span className="warning">{midi.error}</span> : null}
      </Group>
    </div>
  )
}
