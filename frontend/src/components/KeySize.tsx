import type { KeySizeSetting } from '../lib/keySize'
import { KEY_SIZE } from '../lib/keySize'

/** − / + to resize the keys (smaller = more keys in view), Fit to show all 88. */
export function KeySize({ setting, onChange }: { setting: KeySizeSetting; onChange: (s: KeySizeSetting) => void }) {
  // Step from whatever width the keys have right now, whichever setting produced it.
  const resize = (direction: 1 | -1) => {
    const current = document.querySelector('.key.white')?.getBoundingClientRect().width ?? 28
    const next = Math.round(current / KEY_SIZE.step) * KEY_SIZE.step + direction * KEY_SIZE.step
    onChange(Math.min(KEY_SIZE.max, Math.max(KEY_SIZE.min, next)))
  }
  return (
    <div className="key-size" role="group" aria-label="Key size">
      <button onClick={() => resize(-1)} aria-label="Smaller keys (see more)">
        −
      </button>
      <button onClick={() => resize(1)} aria-label="Bigger keys">
        +
      </button>
      <button className={setting === 'fit' ? 'active' : ''} onClick={() => onChange(setting === 'fit' ? 'auto' : 'fit')} title="Show all 88 keys">
        Fit
      </button>
    </div>
  )
}
