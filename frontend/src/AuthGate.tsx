import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { api, setUnauthorizedHandler } from './lib/api'

/** Shows the login screen when a hosted server asks for a password; otherwise the app. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'login' | 'ready'>('checking')

  useEffect(() => {
    setUnauthorizedHandler(() => setState('login'))
    api.health().then(
      (h) => setState(h.login_required && !h.logged_in ? 'login' : 'ready'),
      // Backend unreachable: let the app load and show its own connection error.
      () => setState('ready'),
    )
  }, [])

  if (state === 'checking') return null
  if (state === 'login') return <LoginScreen onLoggedIn={() => setState('ready')} />
  return children
}
