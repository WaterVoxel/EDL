import { useEffect, useRef, useState, useCallback } from 'react'
import { useMedia } from '../context/MediaContext'
import { sampleCropOrigin } from '../cropAnimation'

// Live preview of a V2 clip composited on top of V1 — the on-screen
// counterpart to the render's `overlay` filter (see build_timeline_filter in
// ffmpeg_utils.py). A SECOND <video> element is layered over the main
// preview, sized to the crop box and moved along the same keyframe curve, so
// what you see while scrubbing is what an A/B "Render V2" will bake in.
//
// Why a second element rather than reusing the shared one: the main <video>
// belongs to the playback engine (which owns its src, currentTime and play
// state) and can only decode one file at a time. A composite needs two
// pictures at once, so the overlay gets its own element and follows the main
// one's clock.
//
// Geometry is measured off the real <video> element and scaled by
// box.width / sourceWidth — deliberately the SAME arithmetic CropOverlay
// uses for its box. The overlay has to land exactly where that box was drawn,
// so the two must agree by construction rather than by coincidence.
export default function OverlayPreview({ overlay, stageRef, visible = true }) {
  const { videoRef, activePreview } = useMedia()
  const [box, setBox] = useState(null) // the main video's displayed rect
  const elRef = useRef(null)
  const ownVideoRef = useRef(null)

  const v1Clip = overlay?.v1Clip
  const v2Clip = overlay?.v2Clip
  // Only composite while the main preview is actually decoding this
  // overlay's V1 source. Between clips there's nothing to sit on top of, and
  // a stale PiP hanging over unrelated footage reads as a bug.
  const isActive = !!v1Clip && visible && activePreview?.name === v1Clip.sourceName

  const recompute = useCallback(() => {
    const stage = stageRef.current
    const video = videoRef?.current
    if (!stage || !video || !video.videoWidth || !video.videoHeight) { setBox(null); return }
    const stageRect = stage.getBoundingClientRect()
    const videoRect = video.getBoundingClientRect()
    if (!videoRect.width || !videoRect.height) { setBox(null); return }
    setBox({
      left: videoRect.left - stageRect.left,
      top: videoRect.top - stageRect.top,
      width: videoRect.width,
      height: videoRect.height,
    })
  }, [stageRef, videoRef])

  useEffect(() => {
    recompute()
    const stage = stageRef.current
    const video = videoRef?.current
    if (!stage) return
    const ro = new ResizeObserver(recompute)
    ro.observe(stage)
    if (video) ro.observe(video)
    video?.addEventListener('loadedmetadata', recompute)
    return () => {
      ro.disconnect()
      video?.removeEventListener('loadedmetadata', recompute)
    }
    // Re-measure on clip/preview identity changes too, not just when
    // recompute's own deps change — same reason as CropOverlay's effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recompute, overlay?.v1Id, activePreview?.name])

  // Per-frame loop: position the PiP and keep its own <video> in step with
  // the main one.
  //
  // Position is written imperatively from rAF reading video.currentTime, for
  // exactly the reason CropOverlay's animated box is: MediaContext's
  // `currentTime` comes from `timeupdate`, which browsers fire ~4x/second —
  // animating from it makes the PiP teleport in visible jumps while the
  // frames underneath glide. See gotchas.md.
  const kfsKey = overlay ? JSON.stringify(overlay.keyframes) : null
  useEffect(() => {
    if (!isActive || !box) return
    const main = videoRef?.current
    const own = ownVideoRef.current
    if (!main || !own) return
    const v1In = v1Clip.inSec || 0
    const v2In = v2Clip.inSec || 0
    const v2Out = v2Clip.outSec ?? Infinity
    const kfs = overlay.keyframes || []
    const scale = box.width / (v1Clip.sourceWidth || 1)
    let raf = null

    const tick = () => {
      const el = elRef.current
      if (el) {
        // The overlay file IS V1's crop box over V1's body, so its frame 0
        // lines up with V1's inSec — the same alignment the render states as
        // setpts=PTS-STARTPTS+in_sec/TB.
        const bodyT = main.currentTime - v1In
        const ownT = v2In + bodyT
        // Outside the processed region the render composites nothing, so
        // hide rather than freeze on the last frame (eof_action=pass,
        // repeatlast=0).
        const inRange = bodyT >= -1e-3 && ownT <= v2Out + 1e-3
        el.style.visibility = inRange ? 'visible' : 'hidden'
        if (inRange) {
          // Let the overlay decode-play itself while the main video is
          // playing natively (a per-frame currentTime seek would be as
          // choppy as the engine's scrub path), and only nudge it back when
          // it drifts. During freeze/scrub segments main is paused, so the
          // overlay stays paused and is positioned purely by seeking.
          if (own.playbackRate !== main.playbackRate) own.playbackRate = main.playbackRate
          if (main.paused) {
            if (!own.paused) own.pause()
            if (Math.abs(own.currentTime - ownT) > 0.005) own.currentTime = ownT
          } else {
            if (Math.abs(own.currentTime - ownT) > 0.12) own.currentTime = ownT
            if (own.paused && own.readyState >= 2) own.play().catch(() => {})
          }
          const s = kfs.length >= 1
            ? sampleCropOrigin(kfs, Math.max(0, bodyT))
            : { x: overlay.x, y: overlay.y }
          if (s) {
            // Written unconditionally every frame, never memoized against
            // the last sample: React re-renders at timeupdate's ~4Hz and
            // would put the stale declarative position back into style.left,
            // so the loop has to reassert to stay authoritative. Assigning
            // an identical string doesn't invalidate layout, so it's cheap.
            el.style.left = `${box.left + s.x * scale}px`
            el.style.top = `${box.top + s.y * scale}px`
          }
        } else if (!own.paused) {
          own.pause()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick() // position before the first paint after mount, don't wait a frame

    return () => {
      if (raf) cancelAnimationFrame(raf)
      own.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, box, overlay?.v2Id, overlay?.x, overlay?.y, kfsKey, videoRef])

  if (!overlay || !isActive || !box) return null

  const scale = box.width / (v1Clip.sourceWidth || 1)
  const src = `/${v2Clip.sourceDir || 'input'}/${encodeURIComponent(v2Clip.sourceName)}`

  return (
    <div
      ref={elRef}
      className="absolute pointer-events-none overflow-hidden"
      style={{
        left: box.left + overlay.x * scale,
        top: box.top + overlay.y * scale,
        width: overlay.w * scale,
        height: overlay.h * scale,
      }}
    >
      {/* object-fill, not contain: the file's dimensions are required to
          equal the crop box exactly (overlayMatch refuses anything else), so
          the only stretch possible here is sub-pixel layout rounding —
          letterboxing that would leak the V1 frame through instead. */}
      <video
        ref={ownVideoRef}
        src={src}
        muted
        preload="auto"
        className="w-full h-full object-fill"
      />
    </div>
  )
}
