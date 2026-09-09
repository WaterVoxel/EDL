import { useEffect, useRef, useState, useCallback } from 'react'
import { useMedia } from '../context/MediaContext'
import { sampleCropOrigin } from '../cropAnimation'

// Live preview of a V2 clip composited on top of V1 — the on-screen
// counterpart to the render's `overlay` filter (see build_timeline_filter in
// ffmpeg_utils.py). A SECOND <video> element is layered over the main
// preview, sized to the crop box and moved along the same keyframe curve, so
// what you see while scrubbing is what an A/B "V2 Render" will bake in.
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
//
// `opacity` and `fit` are what V2 Compare (0.72.0) drives: the same layer
// machinery, drawn at half strength so V1 reads through it. They default to a
// fully opaque, box-filling layer, which is the composite this component was
// written for and the only thing a render ever bakes in.
// Where a V2 clip's file is served from. Same shape as useTimelinePlayback's
// `sourceUrl` — bare filename under its bin, encoded, because bin folders are
// virtual and nothing is ever nested (see gotchas.md).
function segUrl(clip) {
  return `/${clip.sourceDir || 'input'}/${encodeURIComponent(clip.sourceName)}`
}

export default function OverlayPreview({ overlay, stageRef, visible = true, opacity = 1, fit = 'fill' }) {
  const { videoRef, activePreview } = useMedia()
  const [box, setBox] = useState(null) // the main video's displayed rect
  const elRef = useRef(null)
  const ownVideoRef = useRef(null)

  const v1Clip = overlay?.v1Clip
  const v2Clip = overlay?.v2Clip
  // Only composite while the main preview is actually showing this overlay's
  // OWN V1 clip. Between clips there's nothing to sit on top of, and a stale
  // PiP hanging over unrelated footage reads as a bug.
  //
  // Matched on the clip id, not the source name, and the difference is the
  // whole correctness of the half-opacity blend. A name matches every V1 clip
  // cut from that file — the ordinary case, one source split into several cuts —
  // so under a filename gate all of those clips' layers went active at the same
  // instant. They are absolutely positioned over the same rect, so their
  // opacities COMPOUND: two 0.5 layers cover 75% of V1, three cover 87.5%, and
  // the visible picture is whichever V2 clip mounted last rather than the one
  // paired with what's playing. Compare then looked like it simply wasn't
  // honouring 50%, and it looked that way specifically while playing or
  // scrubbing, because that is when playback walks across those sibling cuts.
  //
  // The rAF loop's `inRange` check below cannot stand in for this: it derives
  // `bodyT` from each layer's own `v1Clip.inSec` against the shared element's
  // currentTime, which for a sibling cut of the same file is a real number in a
  // plausible range — so it hides some stacked layers and not others, which is
  // worse than either extreme because it varies with the edit.
  //
  // The name fallback is for an activePreview written by something that has no
  // clip to name (a Media Bin pick routes through binSelection today, so nothing
  // does — it is here so a future writer degrades to the old behavior instead of
  // silently blanking every layer).
  const isActive = !!v1Clip && visible && (
    activePreview?.clipId != null
      ? activePreview.clipId === v1Clip.id
      : activePreview?.name === v1Clip.sourceName
  )

  const recompute = useCallback(() => {
    const stage = stageRef.current
    const video = videoRef?.current
    // No element to measure against at all — there is nothing to hold onto, so
    // drop the box and let the layer unmount.
    if (!stage || !video) { setBox(null); return }
    // An element that IS there but momentarily reports no size is a DIFFERENT
    // case, and conflating the two is what made the layer blink. The playback
    // engine assigns `videoRef.current.src` on every clip boundary and on any
    // seek that lands on another clip, and between that assignment and
    // `loadedmetadata` the element's videoWidth is 0 — so nulling here tore the
    // whole layer down and rebuilt it several times a second while playing, and
    // once per scrub. Keep the last good rect instead: `loadedmetadata` and the
    // ResizeObserver both call this again the instant real numbers exist, so the
    // stale rect survives a frame or two at most, and only differs at all if the
    // next clip is displayed at a different size.
    if (!video.videoWidth || !video.videoHeight) return
    const stageRect = stage.getBoundingClientRect()
    const videoRect = video.getBoundingClientRect()
    if (!videoRect.width || !videoRect.height) return
    const next = {
      left: videoRect.left - stageRect.left,
      top: videoRect.top - stageRect.top,
      width: videoRect.width,
      height: videoRect.height,
    }
    // Keep the SAME object when the rect hasn't actually moved. `box` is a
    // dependency of the rAF effect below, so a fresh object with identical
    // numbers restarts that effect — and its cleanup pauses the overlay's own
    // <video>. recompute runs on every `loadedmetadata`, i.e. at every clip
    // boundary and every scrub onto another clip, which is precisely when the
    // layer must NOT stutter: the pause/restart pair is audible as a hitch in
    // the overlay while V1 keeps gliding. Same-size clips (the normal case)
    // measure identically, so this makes those transitions free.
    setBox(prev => (prev
      && prev.left === next.left && prev.top === next.top
      && prev.width === next.width && prev.height === next.height)
      ? prev
      : next)
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
    // `clipId` is in here alongside `name` because it is now the thing that
    // actually flips isActive: two cuts of one file change the id and not the
    // name, and that boundary is exactly where a layer hands over to its
    // sibling and wants a fresh measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recompute, overlay?.v1Id, activePreview?.name, activePreview?.clipId])

  // Per-frame loop: position the PiP and keep its own <video> in step with
  // the main one.
  //
  // Position is written imperatively from rAF reading video.currentTime, for
  // exactly the reason CropOverlay's animated box is: MediaContext's
  // `currentTime` comes from `timeupdate`, which browsers fire ~4x/second —
  // animating from it makes the PiP teleport in visible jumps while the
  // frames underneath glide. See gotchas.md.
  const kfsKey = overlay ? JSON.stringify(overlay.keyframes) : null
  // The segment list by value, for the same reason kfsKey is: it is rebuilt on
  // every render (compareOverlays is derived, not state), so its identity changes
  // constantly while its contents usually don't. Stringifying the four numbers
  // and the id per segment is what makes "the lanes moved" the trigger instead of
  // "React rendered".
  const segsKey = overlay?.segments
    ? overlay.segments.map(s => `${s.v2Id}:${s.srcRate}:${s.srcOffsetSec}:${s.bodyFromSec}:${s.bodyToSec}`).join('|')
    : null
  useEffect(() => {
    if (!isActive || !box) return
    const main = videoRef?.current
    const own = ownVideoRef.current
    if (!main || !own) return
    const v1In = v1Clip.inSec || 0
    const kfs = overlay.keyframes || []
    const scale = box.width / (v1Clip.sourceWidth || 1)
    // The V2 stretches this layer plays, in the order they appear under V1's
    // body. A composite is the one-segment case, spelled out here rather than
    // asked of matchOverlays: its file IS V1's crop box over V1's body, so frame
    // 0 lines up with V1's inSec at V1's own rate — rate 1, offset v2In, running
    // to v2Out. Compare supplies its own list because its segments are V2 clips
    // that merely share a stretch of TIMELINE with this V1 clip: different lane
    // positions, different lengths, possibly different speeds, and possibly
    // several of them in a row. All of that arithmetic is in compareOverlays; the
    // loop below only reads it.
    const segs = overlay.segments?.length
      ? overlay.segments
      : [{
          v2Clip,
          srcRate: 1,
          srcOffsetSec: v2Clip.inSec || 0,
          bodyFromSec: 0,
          bodyToSec: (v2Clip.outSec ?? Infinity) - (v2Clip.inSec || 0),
        }]
    let raf = null
    // Which segment's file is loaded, by URL — the same reasoning
    // useTimelinePlayback.loadClipIfNeeded uses on the main element: consecutive
    // segments of a Reconstruct are cuts of ONE file, and reassigning an
    // identical src would restart the decoder at every cut for no reason. Only a
    // genuinely different URL reloads.
    let loadedUrl = null
    // True between assigning a src and that file having a frame to show.
    let pendingSrc = false

    const tick = () => {
      const el = elRef.current
      if (el) {
        // bodyT is where the shared <video> is inside V1's body, in V1 SOURCE
        // seconds — the one quantity every segment is expressed against, and the
        // same alignment the render states as setpts=PTS-STARTPTS+in_sec/TB.
        const bodyT = main.currentTime - v1In
        // The segment under the playhead, or none. Sequential search: these lists
        // are one entry for a composite and as many as V2 has cuts under this V1
        // clip otherwise, and it runs once per frame — a binary search would be
        // faster on paper and slower to read for input this size.
        //
        // Picking exactly ONE is what keeps the 50% blend honest. Every earlier
        // shape of this code could have two V2 pictures on screen at once, and
        // two half-opacity layers over the same rect cover 75% rather than 50%,
        // so Compare stopped meaning what the button says. Here it cannot happen:
        // one element, one segment, one picture.
        //
        // Half-open windows, [from, to) — a boundary instant belongs to the LATER
        // segment, which is the convention clipMath.segmentAt already uses for
        // V1's own clips (`pos < s.timelineEnd`), and consecutive V2 cuts share
        // their edge exactly. Only the final segment includes its end, so the last
        // frame of the comparison still shows instead of blanking.
        let seg = null
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i]
          if (bodyT < s.bodyFromSec - 1e-3) break
          const last = i === segs.length - 1
          if (bodyT < s.bodyToSec || (last && bodyT <= s.bodyToSec + 1e-3)) { seg = s; break }
        }
        const inRange = !!seg
        if (inRange) {
          // Point the element at this segment's file, if it isn't already. Done
          // here and not in JSX because the segment under the playhead is known
          // only to this loop; the <video> carries no src prop, so React never
          // rewrites what is set here (the same division of labour the main
          // playback engine has with its own element).
          const url = segUrl(seg.v2Clip)
          if (url !== loadedUrl) {
            loadedUrl = url
            pendingSrc = true
            own.src = url
          }
          // A freshly assigned src decodes nothing for a beat, and an element
          // with no frame yet paints TRANSPARENT — over V1 that is a hole, not a
          // blend, so it would read as Compare flickering off at the boundary.
          // Stay hidden until there is a real frame; V1 alone underneath is the
          // honest picture in the meantime. Only ever consulted right after a
          // load, never during ordinary seeking (`readyState` dips to 1 mid-seek,
          // and gating on it every frame would strobe the layer while scrubbing).
          if (pendingSrc && own.readyState >= 2) pendingSrc = false
        }
        // Outside every segment there is nothing to draw, so hide rather than
        // freeze on the last frame — for a composite because that is what the
        // render does (eof_action=pass, repeatlast=0), and for Compare because a
        // stretch of V1 with no V2 over it must read as plain V1.
        el.style.visibility = inRange && !pendingSrc ? 'visible' : 'hidden'
        // Reasserted every frame for the same reason left/top below are, and it
        // matters most during exactly what it looks like it wouldn't: playing and
        // scrubbing. Those are when the shared <video> swaps src, when React
        // re-renders at timeupdate's ~4Hz, and when this element's style is
        // rewritten from a props object that a stale render can carry — so the
        // half-opacity has to be restated by the loop rather than set once and
        // trusted. Costs nothing when unchanged (an identical value assigned to
        // style.opacity invalidates no layout) and is a no-op at 1.
        el.style.opacity = String(opacity)
        if (inRange) {
          const ownT = seg.srcOffsetSec + bodyT * seg.srcRate
          // Let the overlay decode-play itself while the main video is
          // playing natively (a per-frame currentTime seek would be as
          // choppy as the engine's scrub path), and only nudge it back when
          // it drifts. During freeze/scrub segments main is paused, so the
          // overlay stays paused and is positioned purely by seeking.
          // Scaled by srcRate, not copied: the layer's file has to advance at
          // ITS clip's rate relative to V1's, or a 0.5× V1 shot compared against
          // a full-rate V2 one would need a corrective seek every frame — which
          // is the choppy path this exists to avoid. At srcRate 1 (every
          // composite, and any Compare segment whose speed matches V1's) it is
          // the plain copy it was before.
          const wantRate = main.playbackRate * seg.srcRate
          if (own.playbackRate !== wantRate) own.playbackRate = wantRate
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
        } else {
          if (!own.paused) own.pause()
          // Nothing to show at this instant, but the element is empty and will
          // be needed shortly — warm it with whichever segment is next, so the
          // moment the playhead reaches one there is a decoded frame instead of a
          // beat of missing picture. Only ever done once (the URL is remembered),
          // and only when the element has no file at all: the layer used to get
          // its src declaratively at mount, and this is what keeps that
          // head start now that the loop owns the assignment.
          if (!loadedUrl) {
            const next = segs.find(s => s.bodyToSec > bodyT) || segs[segs.length - 1]
            loadedUrl = segUrl(next.v2Clip)
            pendingSrc = true
            own.src = loadedUrl
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick() // position before the first paint after mount, don't wait a frame

    return () => {
      if (raf) cancelAnimationFrame(raf)
      own.pause()
    }
    // `segsKey` and the in/out points are dependencies for the same reason x/y
    // are: the loop reads them ONCE when it is built, and the edits that change
    // them change no clip id, so nothing else in this list would fire. A trim
    // moves an in-point; a drag, a hold or a speed change re-lays out a lane and
    // so re-derives every Compare segment. Without them the layer stays on screen
    // and keeps syncing to where the clips used to be — it shows drift that isn't
    // in the edit, which is the one lie a compare view must not tell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, box, overlay?.v2Id, overlay?.x, overlay?.y, kfsKey, segsKey, videoRef, opacity,
      v1Clip?.inSec, v2Clip?.inSec, v2Clip?.outSec])

  if (!overlay || !isActive || !box) return null

  const scale = box.width / (v1Clip.sourceWidth || 1)

  return (
    <div
      ref={elRef}
      className="absolute pointer-events-none overflow-hidden"
      style={{
        left: box.left + overlay.x * scale,
        top: box.top + overlay.y * scale,
        width: overlay.w * scale,
        height: overlay.h * scale,
        opacity,
      }}
    >
      {/* object-fill by default, not contain: a COMPOSITED file either equals
          the crop box or is a larger file of the box's EXACT aspect ratio
          (overlayMatch refuses anything else), so filling this rect is a uniform
          reduction in both cases — the same scale the render's `scale=w:h`
          performs, which is why the preview needs no arithmetic of its own for
          it. `contain` would letterbox on sub-pixel layout rounding and leak the
          V1 frame through the seam instead.

          V2 Compare asks for `contain`, and for the opposite reason: its layers
          are unfiltered, so a V2 clip of a different SHAPE than V1 can land here
          and stretching it would misalign the two pictures — which is the one
          thing a compare view must not do, since misalignment is what it is
          being used to look for. Letterboxing there is harmless: the bars show
          V1, and the layer is a half-opacity blend over V1 anyway. Written as a
          ternary rather than `object-${fit}` because Tailwind only compiles
          class names it can see as literals. */}
      {/* No `src` prop, on purpose (0.74.0): the frame loop assigns it, because
          which V2 file this element should be showing depends on where the
          playhead is inside V1's body — a Compare layer walks a LIST of V2
          segments and one V1 clip can sit under several V2 cuts. Leaving the
          prop off is also what makes that safe: React has no src of its own to
          restore, so a re-render can't yank the element back to the wrong file
          mid-playback. */}
      <video
        ref={ownVideoRef}
        muted
        preload="auto"
        className={`w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-fill'}`}
      />
    </div>
  )
}
