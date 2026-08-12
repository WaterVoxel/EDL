import { useEffect, useRef, useState, useCallback } from 'react'
import { useMedia } from '../context/MediaContext'
import { clampCropOrigin, resizeCropBox } from '../cropMath'
import { sampleCropOrigin, addKeyframe, maxKeyframeOrigin } from '../cropAnimation'

const STAGE_PADDING_PX = 12 // matches the stage's p-3

// Draggable crop-box overlay drawn on top of the preview <video>. The
// video's displayed rect is measured directly off the real <video> element
// via getBoundingClientRect() once the browser has actually decoded it
// (videoWidth > 0) — this is pixel-exact regardless of non-square pixel
// aspect ratios, rotation metadata, or subpixel layout rounding, none of
// which a from-scratch "object-fit: contain" recomputation from ffprobe's
// raw sourceWidth/sourceHeight can account for. A mismatch there is what
// used to make the outline trace a box slightly off from the video's real
// edges (most visible as extra thickness on one side, since only one edge
// is set directly while its opposite is a derived sum). The recomputed
// estimate is kept only as a fallback for the brief window right after
// switching clips, before the new video's metadata has decoded and
// videoWidth is still 0/stale.
export default function CropOverlay({ selectedClip, setClips, stageRef, animateEnabled = false, freeEnabled = false }) {
  const { activePreview, videoRef, currentTime } = useMedia()
  const [box, setBox] = useState(null) // {left, top, width, height}, relative to the stage
  // The keyframed box is positioned imperatively from a rAF loop reading
  // video.currentTime — see the animation effect below.
  const boxElRef = useRef(null)
  // True while a pointer drag owns the box's position, so the rAF loop
  // doesn't fight the cursor for it.
  const draggingRef = useRef(false)

  const isActiveClip = !!selectedClip && activePreview?.name === selectedClip.sourceName

  const recompute = useCallback(() => {
    const stage = stageRef.current
    if (!stage || !selectedClip?.sourceWidth || !selectedClip?.sourceHeight) { setBox(null); return }
    const stageRect = stage.getBoundingClientRect()

    const video = videoRef?.current
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      const videoRect = video.getBoundingClientRect()
      if (videoRect.width > 0 && videoRect.height > 0) {
        setBox({
          left: Math.round(videoRect.left - stageRect.left),
          top: Math.round(videoRect.top - stageRect.top),
          width: Math.round(videoRect.width),
          height: Math.round(videoRect.height),
        })
        return
      }
    }

    // Fallback estimate — see comment above.
    const availW = Math.max(stageRect.width - STAGE_PADDING_PX * 2, 1)
    const availH = Math.max(stageRect.height - STAGE_PADDING_PX * 2, 1)
    const sourceAspect = selectedClip.sourceWidth / selectedClip.sourceHeight
    const availAspect = availW / availH
    const width = sourceAspect > availAspect ? availW : availH * sourceAspect
    const height = sourceAspect > availAspect ? availW / sourceAspect : availH
    setBox({
      left: Math.round((stageRect.width - width) / 2),
      top: Math.round((stageRect.height - height) / 2),
      width: Math.round(width),
      height: Math.round(height),
    })
  }, [stageRef, videoRef, selectedClip?.sourceWidth, selectedClip?.sourceHeight])

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
    // Re-attach whenever the active clip/preview identity changes (not just
    // when recompute's own dimension deps change), so switching to a
    // same-resolution clip still re-measures against its own <video> box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recompute, selectedClip?.id, activePreview?.name])

  // Single source of truth for the on-preview position:
  //  • Animate ON and this clip has ≥1 keyframe → the box follows the
  //    interpolated keyframe curve at the current playhead (t = source
  //    seconds relative to inSec, the SAME unit the + button and the render
  //    expression use — see cropAnimation.js). Dragging writes/overwrites a
  //    keyframe AT the current playhead t, so the box tracks the cursor
  //    exactly (it never snaps to a distant keyframe) and the position is
  //    remembered precisely where you set it.
  //  • otherwise → the static crop.x/y, dragging moves that.
  //
  // `currentTime` (MediaContext) comes from the <video>'s `timeupdate`
  // event, which browsers fire only ~4x/second — far too coarse to animate
  // from, and the reason a keyframed pan used to visibly judder while the
  // playhead itself glided (the playhead is driven imperatively at frame
  // rate; see Timeline.positionPlayhead). It's kept ONLY as the paused /
  // first-paint value; during playback the effect below takes over and
  // repositions the box every animation frame off video.currentTime
  // directly. Hooks must run before the early returns below.
  const crop = selectedClip?.crop
  const kfs = selectedClip?.cropKeyframes || []
  const animating = animateEnabled && kfs.length >= 1 && !!crop
  const stateT = Math.max(0, currentTime - (selectedClip?.inSec || 0))
  const stateSampled = animating ? sampleCropOrigin(kfs, stateT) : null
  const displayX = stateSampled ? stateSampled.x : (crop?.x || 0)
  const displayY = stateSampled ? stateSampled.y : (crop?.y || 0)

  // Per-frame imperative repositioning of the keyframed box. Mirrors the
  // playback engine's own approach (compositor-only style writes, no React
  // re-render per frame), so the box moves in lockstep with the frames the
  // <video> is actually presenting. Only mounts while animating; the static
  // path stays purely declarative. Reading video.currentTime is what keeps
  // this frame-locked to the decoder rather than to wall-clock time.
  const animDeps = animating ? JSON.stringify(kfs) : null
  useEffect(() => {
    if (!animating || !box) return
    const video = videoRef?.current
    if (!video) return
    const kfList = kfs
    const inSec = selectedClip.inSec || 0
    const sx = box.width / (selectedClip.sourceWidth || 1)
    let raf = null
    const tick = () => {
      const el = boxElRef.current
      if (el && !draggingRef.current) {
        const s = sampleCropOrigin(kfList, Math.max(0, video.currentTime - inSec))
        if (s) {
          // Written unconditionally, never memoized against the last
          // sample: React re-renders at timeupdate's ~4Hz and will put the
          // stale `displayX` back into style.left, so the loop has to
          // reassert every frame to stay authoritative — skipping
          // "unchanged" samples would let that stale value sit visible and
          // bring the judder straight back. Assigning an identical string
          // doesn't invalidate layout, so this is cheap.
          el.style.left = `${box.left + s.x * sx}px`
          el.style.top = `${box.top + s.y * sx}px`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick() // position before the first paint after mount, don't wait a frame
    return () => { if (raf) cancelAnimationFrame(raf) }
    // animDeps (a value-snapshot of the keyframes) re-syncs the loop when
    // keyframes are added/removed/dragged; kfs itself is a fresh array
    // identity on every render and would thrash the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating, box, videoRef, selectedClip?.id, selectedClip?.inSec, selectedClip?.sourceWidth, animDeps])

  if (!crop || !isActiveClip || !box) return null

  const { sourceWidth, sourceHeight } = selectedClip
  if (!sourceWidth || !sourceHeight) return null

  const { left: videoLeft, top: videoTop, width: videoW, height: videoH } = box
  const scale = videoW / sourceWidth

  function handlePointerDown(e) {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    // Freeze the keyframe time for the WHOLE drag, read from the live
    // video clock (not the ~4Hz `currentTime` state, which can be a
    // quarter-second stale — that offset used to land the keyframe at a
    // different moment than the frame on screen). Frozen so every move
    // event overwrites ONE keyframe: sampling per-move while the clock
    // advances would smear a trail of keyframes across the timeline.
    const dragT = animating
      ? Math.max(0, (videoRef?.current?.currentTime ?? currentTime) - (selectedClip.inSec || 0))
      : 0
    const base = animating ? sampleCropOrigin(kfs, dragT) : { x: crop.x, y: crop.y }
    const startCropX = base ? base.x : crop.x
    const startCropY = base ? base.y : crop.y
    draggingRef.current = true

    function onMove(ev) {
      const dx = (ev.clientX - startX) / scale
      const dy = (ev.clientY - startY) / scale
      const next = clampCropOrigin(startCropX + dx, startCropY + dy, { w: crop.w, h: crop.h }, sourceWidth, sourceHeight)
      if (animating) {
        // Position the box straight from the pointer rather than waiting to
        // read it back through the keyframe curve — exact cursor tracking
        // even if the clock moves mid-drag (the rAF loop is suspended via
        // draggingRef for the duration).
        const el = boxElRef.current
        if (el) {
          el.style.left = `${videoLeft + next.x * scale}px`
          el.style.top = `${videoTop + next.y * scale}px`
        }
        // Write a keyframe at the frozen drag time (addKeyframe overwrites
        // an existing one within epsilon), so dragging edits exactly the
        // moment that was on screen when the drag began.
        setClips(prev => prev.map(c => c.id === selectedClip.id
          ? { ...c, cropKeyframes: addKeyframe(c.cropKeyframes || [], dragT, next.x, next.y), dirty: true }
          : c
        ))
        return
      }
      setClips(prev => prev.map(c =>
        c.id === selectedClip.id ? { ...c, crop: { ...c.crop, x: next.x, y: next.y }, dirty: true } : c
      ))
    }
    function onUp() {
      draggingRef.current = false
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  // Aspect-locked resize from the bottom-right corner. The box's top-left
  // (displayX/displayY) is the pinned anchor; dragging the handle scales
  // w/h together via resizeCropBox so the preset ratio never drifts. Only
  // the static crop.w/h changes — position is untouched, so this composes
  // with both plain drag and keyframed panning (the box size is shared
  // across all keyframes by design).
  function handleResizeDown(e) {
    e.stopPropagation()
    e.preventDefault()
    const anchorX = displayX
    const anchorY = displayY
    // One box size is shared by every keyframe, so the size the user drags
    // here has to remain legal at the FURTHEST keyframe too, not just at
    // the one under the playhead. Clamping against the max origin is what
    // keeps a resize from silently invalidating a pan that render_timeline
    // then rejects outright (app.py checks every keyframe's x+w / y+h).
    const limit = animating
      ? maxKeyframeOrigin(kfs, { x: crop.x, y: crop.y })
      : { x: anchorX, y: anchorY }
    const clampAnchorX = Math.max(anchorX, limit.x)
    const clampAnchorY = Math.max(anchorY, limit.y)

    function onMove(ev) {
      // Pointer position in source pixels, relative to the video's top-left.
      // clientX/Y and getBoundingClientRect() are both viewport-relative,
      // so the difference divided by scale is the source-pixel coordinate.
      const px = (ev.clientX - videoRectLeft()) / scale
      const py = (ev.clientY - videoRectTop()) / scale
      // Grow toward the pointer measured from the visible anchor, but cap
      // the result against the furthest keyframe's anchor.
      const grown = resizeCropBox(crop.w, crop.h, anchorX, anchorY, px, py, sourceWidth, sourceHeight)
      const capped = resizeCropBox(
        crop.w, crop.h,
        clampAnchorX, clampAnchorY,
        clampAnchorX + grown.w, clampAnchorY + grown.h,
        sourceWidth, sourceHeight,
      )
      const next = { w: Math.min(grown.w, capped.w), h: Math.min(grown.h, capped.h) }
      setClips(prev => prev.map(c =>
        c.id === selectedClip.id ? { ...c, crop: { ...c.crop, w: next.w, h: next.h }, dirty: true } : c
      ))
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  // The video's on-page top-left, so pointer client coords map to source px.
  // Measured live off the real <video> (the same element `box` was measured
  // from) rather than cached, so a mid-drag scroll/resize stays accurate.
  function videoRectLeft() {
    const v = videoRef?.current
    return v ? v.getBoundingClientRect().left : 0
  }
  function videoRectTop() {
    const v = videoRef?.current
    return v ? v.getBoundingClientRect().top : 0
  }

  return (
    <>
      {/* Full source-frame outline, so the draggable range is visible even where it extends past the crop box */}
      <div
        className="absolute border border-dashed border-emerald-400/40 pointer-events-none"
        style={{ left: videoLeft, top: videoTop, width: videoW, height: videoH }}
      />
      <div
        ref={boxElRef}
        className={`absolute border-2 bg-emerald-400/10 cursor-move touch-none ${animating ? 'border-amber-400' : 'border-emerald-400'}`}
        style={{
          left: videoLeft + displayX * scale,
          top: videoTop + displayY * scale,
          width: crop.w * scale,
          height: crop.h * scale,
        }}
        onPointerDown={handlePointerDown}
        title={animating ? 'Keyframed position at playhead — drag to set the keyframe here' : 'Drag to reposition the crop area'}
      >
        <span className={`absolute -top-4 left-0 text-[8px] font-mono whitespace-nowrap ${animating ? 'text-amber-300' : 'text-emerald-300'}`}>
          {crop.w}×{crop.h}{animating ? ` · kf${kfs.length}` : ''}
        </span>
        {/* Bottom-right resize handle — only in Free mode. Scales the box
            while keeping the preset's aspect ratio (see resizeCropBox). */}
        {freeEnabled && (
          <div
            onPointerDown={handleResizeDown}
            title="Drag to scale the crop box (keeps the aspect ratio)"
            className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-sm bg-sky-400 border border-sky-100 cursor-nwse-resize touch-none"
          />
        )}
      </div>
    </>
  )
}
