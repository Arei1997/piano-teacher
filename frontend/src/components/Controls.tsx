import type { Player } from '../hooks/usePlayer'
import type { HandFilter } from '../lib/music'

interface ControlsProps {
  player: Player
  baseTempo: number
  midi: { supported: boolean; devices: string[]; error: string | null; connect: () => void }
  soundOnMidi: boolean
  setSoundOnMidi: (value: boolean) => void
}

export function Controls({ player, baseTempo, midi, soundOnMidi, setSoundOnMidi }: ControlsProps) {
  const { mode, playing, loading, loop, firstMeasure, lastMeasure } = player
  const setLoopEdge = (edge: 'from' | 'to', value: number) => {
    const current = loop ?? { from: firstMeasure, to: lastMeasure }
    const next = { ...current, [edge]: Math.min(lastMeasure, Math.max(firstMeasure, Number.isFinite(value) ? value : firstMeasure)) }
    if (next.from > next.to) next[edge === 'from' ? 'to' : 'from'] = next[edge]
    player.setLoop(next)
  }

  return (
    <div className="controls">
      <div className="segmented" role="group" aria-label="Practice mode">
        <button className={mode === 'listen' ? 'active' : ''} onClick={() => player.setMode('listen')}>
          ▶ Listen
        </button>
        <button className={mode === 'wait' ? 'active' : ''} onClick={() => player.setMode('wait')}>
          ⏸ Wait for me
        </button>
      </div>

      {mode === 'listen' ? (
        <button className="primary play" onClick={playing ? player.pause : player.play} disabled={loading}>
          {loading ? 'Loading piano…' : playing ? '❚❚ Pause' : '▶ Play'}
        </button>
      ) : null}
      <button onClick={player.restart} title="Back to the start">
        ⟲ Restart
      </button>

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

      <label className="inline" title="Practice slowly, then speed up">
        Speed
        <input
          type="range"
          min={25}
          max={150}
          step={5}
          value={player.tempoPct}
          onChange={(e) => player.setTempoPct(Number(e.target.value))}
        />
        <span className="value">
          {player.tempoPct}% · {Math.round((baseTempo * player.tempoPct) / 100)} bpm
        </span>
      </label>

      <label className="inline">
        <input
          type="checkbox"
          checked={Boolean(loop)}
          onChange={(e) => player.setLoop(e.target.checked ? { from: firstMeasure, to: Math.min(firstMeasure + 3, lastMeasure) } : null)}
        />
        Loop bars
        {loop ? (
          <>
            <input type="number" min={firstMeasure} max={lastMeasure} value={loop.from} onChange={(e) => setLoopEdge('from', Number(e.target.value))} />
            –
            <input type="number" min={firstMeasure} max={lastMeasure} value={loop.to} onChange={(e) => setLoopEdge('to', Number(e.target.value))} />
          </>
        ) : null}
      </label>

      <div className="midi">
        {midi.devices.length ? (
          <>
            <span className="ok">🎹 {midi.devices.join(', ')}</span>
            <label className="inline">
              <input type="checkbox" checked={soundOnMidi} onChange={(e) => setSoundOnMidi(e.target.checked)} />
              App sound for MIDI
            </label>
          </>
        ) : (
          <button onClick={midi.connect}>Connect MIDI keyboard</button>
        )}
        {midi.error ? <span className="warning">{midi.error}</span> : null}
      </div>
    </div>
  )
}
