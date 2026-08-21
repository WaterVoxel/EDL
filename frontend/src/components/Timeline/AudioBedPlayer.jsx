import { useRef, useEffect, useState } from 'react'
import { bedPlayedSec, bedInSec } from '../../clipMath'

// Matches ffmpeg_utils.BED_GAIN — the render attenuates A1 by this much
// before summing it under V1's audio, so the preview has to as well or the
// balance the user hears isn't the balance they get.
const BED_GAIN = 0.35

/* Best-effort preview of the A1 lane: one bare <audio> element per clip on it,
 * each slaved to the timeline transport over its own stretch of the lane.
 *
 * The key point is WHAT they follow. Each reads transport.getTimelinePos(), not
 * the main video's currentTime, which makes A1 TIMELINE-locked rather than
 * source-locked — so it plays straight through mid-sequence holds, reverse, and
 * slow-mo instead of freezing or running backwards with the picture. That is
 * exactly what the render produces, where A1 is apad-ed flat past its start and
 * never sees a per-clip transform.
 *
 * Clip N's stretch of the timeline begins at `startSec` plus that clip's own
 * `bed.startSec` — the position the render places it at, and the one AudioBedBar
 * draws. An element whose stretch isn't under the playhead parks at 0 and stays
 * paused, so only ever one is heard: the elements are the mix, and the position
 * decides which. That is also why a HOLE left by a removed clip needs no code of
 * its own here — inside a hole no element's stretch is under the playhead, so
 * every one of them is paused and the preview goes silent, which is what the
 * render does with the toggle off. With A1 Room Tone ON the render fills the hole
 * and the preview still doesn't: room tone is applied at render time and has
 * never been previewed.
 *
 * One element per clip rather than one element re-pointed at each source: a src
 * swap drops the decoder and re-buffers, which would put a hole in playback at
 * every A1 boundary — the one place the mix has to be seamless.
 *
 * `startSec` is V1's picture start (the first clip's head hold), matching the
 * render's adelay on the lane. A clip's position on the lane is therefore
 * `timelinePos - startSec - offsetN` — negative before the clip's turn, past
 * its own played length after it, and silent in both, which is what the render
 * has there (leading silence from adelay, apad silence past the lane's end).
 *
 * SOURCE time is that lane position plus the clip's own `inSec`, and its span is
 * its played length rather than its file's duration: a clip that has been split
 * plays only part of its file, and the render's atrim cuts it at exactly these
 * two numbers. An element that isn't the one under the playhead parks at its own
 * `inSec` — the first sample it is allowed to play — so it starts clean on its
 * turn instead of playing the part of the file that was cut away.
 *
 * Position is read in a rAF loop rather than from MediaContext's currentTime,
 * which comes from `timeupdate` (~4Hz) — see gotchas.md. The sync tolerances
 * are OverlayPreview's: nudge to within 5ms while paused (a scrub should land
 * exactly), and only correct past 120ms while playing (a per-frame seek would
 * stutter the decode far worse than the drift it fixes).
 */
export default function AudioBedPlayer({ beds, transport, muted = false, startSec = 0 }) {
  return (
    <>
      {beds.map((bed, index) => (
        <A1ClipAudio
          key={`${index}-${bed.name}`}
          bed={bed}
          transport={transport}
          muted={muted}
          startSec={startSec + (bed.startSec || 0)}
        />
      ))}
    </>
  )
}

function A1ClipAudio({ bed, transport, muted, startSec }) {
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

  // Read through refs for the same reason the transport is: the loop must see
  // the live values, and re-running the effect on every hold edit (or on a clip
  // ahead of this one being removed) would restart playback mid-scrub.
  const startRef = useRef(startSec)
  startRef.current = startSec
  const spanRef = useRef(0)
  spanRef.current = bedPlayedSec(bed)
  const inRef = useRef(0)
  inRef.current = bedInSec(bed)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.volume = BED_GAIN
    let raf = null

    const tick = () => {
      const t = transportRef.current
      const pos = t?.getTimelinePos?.() ?? 0
      // Where the playhead is inside this clip's own stretch of the lane, and
      // the point in the FILE that plays there.
      const lanePos = pos - startRef.current
      const srcTime = inRef.current + lanePos
      if (lanePos < 0 || lanePos >= spanRef.current) {
        // Not this clip's turn — either still ahead of it (the head hold, or an
        // earlier clip playing) or already past its end. The render has other
        // audio or silence here, so hold the element paused at its own first
        // sample and let it start cleanly when its turn comes. Parking there
        // rather than leaving it wherever it ended also keeps it out of the
        // `ended` state, where a play() would restart the file from the top and
        // loop it under the rest of the sequence.
        if (!el.paused) el.pause()
        if (Math.abs(el.currentTime - inRef.current) > 0.005) el.currentTime = inRef.current
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
