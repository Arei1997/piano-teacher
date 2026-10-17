import { useEffect } from 'react'

/**
 * Keep the screen on while `active`. On a phone the student is playing the piano, not
 * touching the screen, so it would otherwise lock mid-song. The browser drops the lock
 * whenever the tab is hidden, so it is re-requested when the page becomes visible again.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const request = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) lock.release()
        else sentinel = lock
      } catch {
        // Denied (e.g. battery saver) — the app still works, the screen may just sleep.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') request()
    }

    request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      sentinel?.release()
    }
  }, [active])
}
