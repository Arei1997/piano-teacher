import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useEffect, useRef, useState } from 'react'

interface SheetMusicProps {
  musicxml: string
  /** Start (in quarter notes) of the step the cursor should sit on, or null to hide it. */
  cursorBeat: number | null
}

export function SheetMusic({ musicxml, cursorBeat }: SheetMusicProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(window.innerWidth < 700 ? 0.7 : 1)

  useEffect(() => {
    if (!containerRef.current) return
    // Created lazily (not in a mount-only effect) so StrictMode's double mount can't make two renderers.
    osmdRef.current ??= new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      backend: 'svg',
      // The app header already shows title and artist; keep the page for the music.
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawPartNames: false,
      followCursor: true,
      cursorsOptions: [{ type: 0, color: '#3b82f6', alpha: 0.45, follow: true }],
    })
    const osmd = osmdRef.current
    let cancelled = false
    setLoaded(false)
    setError(null)
    osmd
      .load(musicxml)
      .then(() => {
        if (cancelled) return
        osmd.zoom = zoom
        osmd.render()
        osmd.cursor.show()
        setLoaded(true)
      })
      .catch((e: unknown) => !cancelled && setError(`Could not draw this sheet: ${e}`))
    return () => {
      cancelled = true
    }
    // Zoom is applied separately below; reloading on zoom would reset the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicxml])

  useEffect(() => {
    const osmd = osmdRef.current
    if (!osmd || !loaded) return
    osmd.zoom = zoom
    osmd.render()
  }, [zoom, loaded])

  // Walk the OSMD cursor to the current step. Its timestamps are in whole notes.
  useEffect(() => {
    const osmd = osmdRef.current
    if (!osmd || !loaded) return
    const cursor = osmd.cursor
    if (cursorBeat === null) {
      cursor.hide()
      return
    }
    cursor.show()
    const target = cursorBeat / 4
    const now = () => cursor.Iterator.currentTimeStamp.RealValue
    if (now() > target + 1e-4) cursor.reset()
    while (!cursor.Iterator.EndReached && now() < target - 1e-4) cursor.next()
  }, [cursorBeat, loaded])

  return (
    <div className="sheet">
      <div className="sheet-zoom">
        <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))} aria-label="Zoom out">−</button>
        <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} aria-label="Zoom in">+</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="sheet-paper" ref={containerRef} />
    </div>
  )
}
