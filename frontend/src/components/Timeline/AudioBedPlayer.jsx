import { useRef, useEffect, useState } from 'react'

// Matches ffmpeg_utils.BED_GAIN — the render attenuates the bed by this much
// before summing it under V1's audio, so the preview has to as well or the
// balance the user hears isn't the balance they get.
const BED_GAIN = 0.35

/* Best-effort preview of the A1 bed: a bare <audio> element slaved to the
 * timeline transport.
 *
 * The key point is WHAT it follows. It reads transport.getTimelinePos(), not
 * the main video's currentTime, which makes the bed TIMELINE-locked rather
 * than source-locked — so it plays straight through mid-sequence holds,
 * reverse, and slow-mo instead of freezing or running backwards with the
 * picture. That is exactly what the render produces, where the bed is apad-ed
 * flat past its start and never sees a per-clip transform.
 *
 * `startSec` is the one offset it does honor: V1's picture start (the first
 * clip's head hold), matching the render's adelay on the bed. Source time is
 * therefore `timelinePos - startSec` — negative during the hold, which is when
 * the element parks at 0 and stays paused so nothing is heard until the picture
 * begins. Without this the preview would play the bed over the frozen frame
 * while the render didn't.
 *
 * Position is read in a rAF loop rather than from MediaContext's currentTime,
 * which comes from `timeupdate` (~4Hz) — see gotchas.md. The sync tolerances
 * are OverlayPreview's: nudge to within 5ms while paused (a scrub should land
 * exactly), and only correct past 120ms while playing (a per-frame seek would
 * stutter the decode far worse than the drift it fixes).
 */
export default function AudioBedPlayer({ bed, transport, muted = false, startSec = 0 }) {
  const audioRef = useRef(null)
  // Kept in a ref, not a dep: the loop must read the LIVE transport each frame
  // (it's a fresh object every render), and re-subscribing every render would
  // tear down and restart the element's playback constantly.
  const transportRef = useRef(transport)
  transportRef.current = transport
  // Audio-only files are never `browser_playable` (that flag requires a video
  // codec), so the raw file is tried first — every format in AUDIO_EXTENSIONS
  // plays natively in at least one of the browsers this runs in — and only a
  // format this browser actually refuses falls back to the transcode route.
  const [useTranscode, setUseTranscode] = useState(false)
  const dir = bed.dir || 'input'
  const src = useTranscode
    ? `/preview/${dir}/${encodeURIComponent(bed.name)}`
    : `/${dir}/${encodeURIComponent(bed.name)}`

  useEffect(() => { setUseTranscode(false) }, [bed.name, bed.dir])

  // Read through a ref for the same reason the transport is: the loop must see
  // the live value, and re-running the effect on every hold edit would restart
  // playback mid-scrub.
  const startRef = useRef(startSec)
  startRef.current = startSec

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.volume = BED_GAIN
    let raf = null

    const tick = () => {
      const t = transportRef.current
      const pos = t?.getTimelinePos?.() ?? 0
      // Bed source time: the timeline position minus V1's picture start.
      const srcTime = pos - startRef.current
      if (srcTime < 0) {
        // Still inside the head hold — the render has silence here, so hold
        // the element paused at its own 0 and let it start cleanly when the
        // picture does.
        if (!el.paused) el.pause()
        if (el.currentTime !== 0) el.currentTime = 0
      } else if (!t?.playing) {
        if (!el.paused) el.pause()
        if (Math.abs(el.currentTime - srcTime) > 0.005) el.currentTime = srcTime
      } else {
        if (Math.abs(el.currentTime - srcTime) > 0.12) el.currentTime = srcTime
        // readyState >= 2 (HAVE_CURRENT_DATA): play() before the element has
        // data rejects for a reason that isn't interesting, and the catch
        // would swallow it either way.
        if (el.paused && el.readyState >= 2) el.play().catch(() => {})
      }
      raf = requestAnimationFrame(tick)
    }
    tick() // land on the right sample before the first paint

    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.pause()
    }
  }, [src])

  // `muted` silences the element without stopping it following the transport,
  // so unmuting mid-playback picks up in sync instead of from wherever the
  // element happened to be left.
  return (
    <audio
      ref={audioRef}
      src={src}
      preload="auto"
      muted={muted}
      onError={() => setUseTranscode(true)}
      className="hidden"
    />
  )
}
