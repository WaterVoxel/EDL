import { useState, useRef, useMemo, useEffect } from 'react'
import { clipTotalSec, buildSegments, segmentAt } from '../clipMath'

function sourceUrl(clip) {
  return `/${clip.sourceDir || 'input'}/${encodeURIComponent(clip.sourceName)}`
}

// How often the React `timelinePos` state is updated during playback. The
// playhead itself is driven imperatively every frame (see updatePos), so
// this only feeds the transport timecode readout / ANIM enable state, where
// ~15Hz is visually indistinguishable from 60Hz but avoids re-rendering the
// whole Timeline tree on every animation frame.
const STATE_THROTTLE_MS = 66
// Tolerance (source seconds, ~1 frame @30fps) for treating a native body as
// "reached its out point" so we hand off before decoding past the trim.
const EPS_SRC = 0.04
// If the next same-file segment's start is within this of where the video
// already is, treat playback as continuous and DON'T seek — split clips cut
// contiguously out of one file then play seamlessly through the boundary.
const CONTIGUOUS_SRC = 0.12

// Hybrid timeline playback engine.
//
// The active clip list is decomposed into playback SEGMENTS (see
// clipMath.buildSegments): head-hold (freeze), main body (native when
// forward + normal-speed, else scrub), tail/round-hold (freeze). Playback
// is a state machine over those segments:
//   • native  — let the <video> decode-play itself (video.play()) and derive
//               the timeline position from the video's OWN clock via
//               requestVideoFrameCallback. The smooth path.
//   • freeze  — pause on the frozen frame and advance position by wall-clock
//               time WITHOUT re-seeking (the frame is static).
//   • scrub   — the legacy per-frame currentTime seek; the only way to play
//               reversed / slow-mo bodies. The transport clock keeps running
//               so playback never stops, though backward seeking is choppy.
//
// Crucially, source LOADING is keyed on the source URL, not the clip id, so
// clips that share one file (a SPLIT into adjacent ranges, or a DUPLICATE)
// never trigger a src reload at their boundary. A single native loop flows
// across those boundaries: contiguous cuts play straight through with no
// seek; a duplicate/jump does one in-place seek; only a genuinely different
// file reloads. Holds and reversed clips hand off to freeze/scrub without
// ever stopping the transport — so playback is continuous start to end.
//
// The <video> stays muted, so preview audio behaves as before (silent).
//
// `clips` (V1) is authoritative for total duration / timing. `displayClips`
// optionally overrides which clip list is decoded (a composited track), read
// through a ref so mid-playback changes apply at the next boundary.
// `onFrame(pos)` (optional) is called imperatively every frame so the
// Timeline can move the playhead without a React re-render.
export function useTimelinePlayback(clips, videoRef, onSelectClip, displayClips, onFrame) {
  const [playing, setPlaying] = useState(false)
  const [looping, setLooping] = useState(false)
  const [timelinePos, setTimelinePos] = useState(0)

  const rafRef = useRef(null)
  const rvfcRef = useRef(null)
  const listenerCleanupRef = useRef(null)
  const genRef = useRef(0)
  const lastTimeRef = useRef(null)
  const lastStateAtRef = useRef(0)
  const activeSegIdxRef = useRef(0)
  const currentClipIdRef = useRef(null)
  const loadedUrlRef = useRef(null)
  const timelinePosRef = useRef(0)
  useEffect(() => { timelinePosRef.current = timelinePos }, [timelinePos])

  const source = displayClips !== undefined ? displayClips : clips
  const segments = useMemo(() => buildSegments(source), [source])
  const segmentsRef = useRef(segments)
  useEffect(() => { segmentsRef.current = segments }, [segments])

  const totalDuration = clips.reduce((sum, c) => sum + clipTotalSec(c), 0)
  const totalDurationRef = useRef(totalDuration)
  useEffect(() => { totalDurationRef.current = totalDuration }, [totalDuration])

  const loopingRef = useRef(looping)
  useEffect(() => { loopingRef.current = looping }, [looping])
  const playingRef = useRef(false)
  const onFrameRef = useRef(onFrame)
  useEffect(() => { onFrameRef.current = onFrame }, [onFrame])

  // Hidden, off-DOM element that warms the browser cache for the NEXT
  // different-file source before playback crosses the boundary, so the
  // on-screen <video>'s src swap doesn't stall on the network.
  const preloadRef = useRef(null)
  const lastPreloadRef = useRef(null)
  useEffect(() => {
    const el = document.createElement('video')
    el.preload = 'auto'
    el.muted = true
    preloadRef.current = el
    return () => { el.removeAttribute('src'); preloadRef.current = null }
  }, [])

  function updatePos(pos, force) {
    timelinePosRef.current = pos
    onFrameRef.current?.(pos)
    const now = performance.now()
    if (force || now - lastStateAtRef.current >= STATE_THROTTLE_MS) {
      lastStateAtRef.current = now
      setTimelinePos(pos)
    }
  }

  // Point the <video> at a clip's source, reloading ONLY when the underlying
  // file actually differs (so split/duplicate clips sharing a file never
  // reload). Selection sync still fires per clip id. Returns true if the src
  // was reloaded (caller must wait for it to become ready before seek/play).
  function loadClipIfNeeded(clip) {
    const url = sourceUrl(clip)
    let reloaded = false
    if (loadedUrlRef.current !== url) {
      loadedUrlRef.current = url
      if (videoRef.current) videoRef.current.src = url
      reloaded = true
    }
    if (clip.id !== currentClipIdRef.current) {
      currentClipIdRef.current = clip.id
      onSelectClip(clip)
    }
    return reloaded
  }

  // Warm the cache for the first upcoming segment on a DIFFERENT file.
  function maybePreloadNext(index) {
    const segs = segmentsRef.current
    const curUrl = segs[index] ? sourceUrl(segs[index].clip) : null
    for (let i = index + 1; i < segs.length; i++) {
      const url = sourceUrl(segs[i].clip)
      if (url !== curUrl) {
        if (preloadRef.current && lastPreloadRef.current !== url) {
          lastPreloadRef.current = url
          preloadRef.current.src = url
        }
        return
      }
    }
  }

  function segSourceTime(seg, pos) {
    if (seg.mode === 'freeze') return seg.frozenSourceTime
    const off = (pos - seg.timelineStart) * seg.rate
    return seg.clip.reversed ? seg.sourceStart - off : seg.sourceStart + off
  }

  // Paint the single frame at `pos` without starting any driver — for
  // seeks/steps while paused.
  function showFrameAt(pos) {
    const found = segmentAt(segmentsRef.current, pos)
    if (!found) {
      if (videoRef.current && loadedUrlRef.current != null) {
        videoRef.current.removeAttribute('src')
      }
      loadedUrlRef.current = null
      currentClipIdRef.current = null
      return
    }
    activeSegIdxRef.current = found.index
    loadClipIfNeeded(found.segment.clip)
    if (videoRef.current) videoRef.current.currentTime = segSourceTime(found.segment, pos)
  }

  function clearListener() {
    if (listenerCleanupRef.current) { listenerCleanupRef.current(); listenerCleanupRef.current = null }
  }

  function cancelLoops() {
    // Bumping the generation invalidates any in-flight rAF / rVFC / one-shot
    // media-event callback so a late fire can't drive the playhead after
    // we've transitioned.
    genRef.current++
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (rvfcRef.current != null && videoRef.current?.cancelVideoFrameCallback) {
      videoRef.current.cancelVideoFrameCallback(rvfcRef.current)
    }
    rvfcRef.current = null
    clearListener()
    lastTimeRef.current = null
  }

  function scheduleRvfc(cb) {
    const v = videoRef.current
    if (v && v.requestVideoFrameCallback) {
      rvfcRef.current = v.requestVideoFrameCallback(() => cb())
    } else {
      // Fallback still reads video.currentTime, so it stays frame-locked to
      // the playing video rather than to wall-clock time.
      rafRef.current = requestAnimationFrame(() => cb())
    }
  }

  // Once a hold / scrub body finishes: loop, stop at the end, or continue
  // into whatever segment now contains `pos` (goes through driveFrom, which
  // tears down the finished driver).
  function handleAfter(pos) {
    if (pos >= totalDurationRef.current - 1e-6) {
      if (loopingRef.current) { driveFrom(0); return }
      updatePos(totalDurationRef.current, true)
      stop()
      return
    }
    driveFrom(pos)
  }

  // The continuous native loop. Reads the video's own clock each frame and
  // flows across segment boundaries in-place (no teardown) whenever the next
  // segment is native on the SAME file; hands off otherwise.
  function runNative(gen) {
    const v = videoRef.current
    if (!v) return

    function step() {
      if (gen !== genRef.current || !playingRef.current) return
      const segs = segmentsRef.current
      const seg = segs[activeSegIdxRef.current]
      if (!seg || seg.mode !== 'native') { v.pause(); driveFrom(timelinePosRef.current); return }

      const st = v.currentTime
      const pos = seg.timelineStart + (st - seg.sourceStart)

      // Still inside this body → advance and continue.
      if (st < seg.clip.outSec - EPS_SRC && pos < seg.timelineEnd - 1e-6) {
        updatePos(Math.max(pos, seg.timelineStart))
        maybePreloadNext(activeSegIdxRef.current)
        scheduleRvfc(step)
        return
      }

      // Reached the body's out point — decide the boundary.
      const boundaryPos = seg.timelineEnd
      if (boundaryPos >= totalDurationRef.current - 1e-6) {
        if (loopingRef.current) { v.pause(); driveFrom(0); return }
        v.pause()
        updatePos(totalDurationRef.current, true)
        stop()
        return
      }

      const nf = segmentAt(segs, boundaryPos)
      const next = nf.segment
      const sameFile = sourceUrl(next.clip) === loadedUrlRef.current

      if (next.mode === 'native' && sameFile) {
        // Flow across the boundary in the same element. Fire selection sync
        // for the new clip, then either continue straight through (contiguous
        // cut) or do one in-place seek (duplicate / non-adjacent split).
        if (next.clip.id !== currentClipIdRef.current) {
          currentClipIdRef.current = next.clip.id
          onSelectClip(next.clip)
        }
        activeSegIdxRef.current = nf.index
        maybePreloadNext(nf.index)
        if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}) }

        if (Math.abs(v.currentTime - next.sourceStart) <= CONTIGUOUS_SRC) {
          // Seamless: video already at (or naturally flowing into) the next
          // range — keep going, no seek.
          scheduleRvfc(step)
        } else {
          // Jump: seek in place and resume once the frame lands (so pos isn't
          // computed from a stale currentTime).
          const onSeeked = () => {
            clearListener()
            if (gen !== genRef.current) return
            if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}) }
            scheduleRvfc(step)
          }
          listenerCleanupRef.current = () => v.removeEventListener('seeked', onSeeked)
          v.addEventListener('seeked', onSeeked)
          v.currentTime = next.sourceStart
        }
        return
      }

      // Different file, or a freeze/scrub segment → full hand-off (pauses the
      // element; driveFrom starts the right driver, reloading src only if the
      // file actually differs).
      v.pause()
      updatePos(boundaryPos)
      driveFrom(boundaryPos)
    }

    scheduleRvfc(step)
  }

  function startNativeAt(index, pos, gen) {
    const v = videoRef.current
    if (!v) return
    const seg = segmentsRef.current[index]
    activeSegIdxRef.current = index
    const reloaded = loadClipIfNeeded(seg.clip)
    const target = seg.sourceStart + (pos - seg.timelineStart) // rate === 1

    const begin = () => {
      if (gen !== genRef.current) return
      if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target
      v.playbackRate = 1
      const p = v.play()
      if (p && p.catch) p.catch(() => {}) // pause/seek before resolve → AbortError
      runNative(gen)
    }

    if (reloaded) {
      // A fresh src must load before a seek/play will land.
      const onReady = () => { clearListener(); begin() }
      listenerCleanupRef.current = () => v.removeEventListener('loadeddata', onReady)
      v.addEventListener('loadeddata', onReady)
    } else {
      begin()
    }
  }

  function freezeStart(index, gen) {
    const v = videoRef.current
    const seg = segmentsRef.current[index]
    activeSegIdxRef.current = index
    const reloaded = loadClipIfNeeded(seg.clip)
    const park = () => { if (v) { v.pause(); v.currentTime = seg.frozenSourceTime } }
    if (reloaded && v) {
      const onReady = () => { clearListener(); park() }
      listenerCleanupRef.current = () => v.removeEventListener('loadeddata', onReady)
      v.addEventListener('loadeddata', onReady)
    } else {
      park()
    }
    lastTimeRef.current = performance.now()
    const tick = (now) => {
      if (gen !== genRef.current || !playingRef.current) return
      const dt = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now
      const nextPos = timelinePosRef.current + dt
      if (nextPos >= seg.timelineEnd) { handleAfter(seg.timelineEnd); return }
      updatePos(nextPos) // frame is static — no re-seek
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function scrubStart(index, gen) {
    const v = videoRef.current
    const seg = segmentsRef.current[index]
    activeSegIdxRef.current = index
    loadClipIfNeeded(seg.clip)
    if (v) v.pause()
    lastTimeRef.current = performance.now()
    const tick = (now) => {
      if (gen !== genRef.current || !playingRef.current) return
      const dt = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now
      const nextPos = timelinePosRef.current + dt
      if (nextPos >= seg.timelineEnd) { handleAfter(seg.timelineEnd); return }
      if (videoRef.current) videoRef.current.currentTime = segSourceTime(seg, nextPos)
      updatePos(nextPos)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // Start (or resume) playback from `pos` in whatever mode its segment calls
  // for — the single entry point for every hand-off. Always tears down the
  // prior driver first.
  function driveFrom(pos) {
    cancelLoops()
    const gen = genRef.current
    const found = segmentAt(segmentsRef.current, pos)
    if (!found) { updatePos(pos, true); stop(); return }
    updatePos(pos)
    maybePreloadNext(found.index)
    const seg = found.segment
    if (seg.mode === 'native') startNativeAt(found.index, pos, gen)
    else if (seg.mode === 'freeze') freezeStart(found.index, gen)
    else scrubStart(found.index, gen)
  }

  function stop() {
    setPlaying(false)
    playingRef.current = false
    cancelLoops()
    if (videoRef.current) videoRef.current.pause()
    setTimelinePos(timelinePosRef.current)
  }

  function seekTimeline(pos) {
    const clamped = Math.max(0, Math.min(pos, totalDurationRef.current))
    if (playingRef.current) {
      driveFrom(clamped)
    } else {
      cancelLoops()
      showFrameAt(clamped)
      updatePos(clamped, true)
    }
  }

  function play() {
    if (clips.length === 0) return
    let start = timelinePosRef.current
    if (start >= totalDurationRef.current - 0.01) start = 0
    setPlaying(true)
    playingRef.current = true
    driveFrom(start)
  }

  // Repaint the displayed frame when the display source changes (e.g. a mute
  // toggle) while paused — a running loop already re-resolves at the next
  // boundary via segmentsRef, but nothing repaints between when stopped.
  useEffect(() => {
    if (!playingRef.current) seekTimeline(timelinePosRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments])

  // Clean up on unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelLoops(), [])

  // Stop playback when V1's own clip list changes — editing V1 invalidates
  // the timeline's authoritative timing, regardless of what's displayed.
  useEffect(() => {
    stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips])

  function goToStart() { stop(); seekTimeline(0) }
  function goToEnd() { stop(); seekTimeline(totalDurationRef.current) }

  function stepFrames(direction) {
    const found = segmentAt(segmentsRef.current, timelinePosRef.current)
    const fps = found?.segment?.clip?.fps || 24
    const frameDur = 1.0 / fps
    seekTimeline(timelinePosRef.current + direction * frameDur)
  }

  function toggleLoop() { setLooping(l => !l) }

  return {
    playing,
    looping,
    timelinePos,
    totalDuration,
    play,
    stop,
    goToStart,
    goToEnd,
    seekTimeline,
    stepFrames,
    toggleLoop,
    getTimelinePos: () => timelinePosRef.current,
  }
}
