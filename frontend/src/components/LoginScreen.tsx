import { useState } from 'react'
import { api } from '../lib/api'

/** Shown by a hosted copy of the app that has APP_PASSWORD set. One login per device lasts a year. */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      onLoggedIn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="dialog" onSubmit={submit}>
        <img src="/icon-192.png" alt="" width={72} height={72} />
        <h2>Piano Teacher</h2>
        <label>
          Password
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || !password}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </div>
  )
}
