// V2-as-overlay matching: decide when a clip on V2 is a cropped region that
// belongs composited back ON TOP of V1, rather than a full-frame replacement
// of it.
//
// The workflow this serves: crop a moving region out of V1 (crop box + ANIM
// keyframes) → render it → run it through an external tool (an AI video
// model, a grade, a cleanup pass) → drop the result on V2. The returned file
// is the size of the crop box, not the size of V1, and it should land back
// exactly where the box was — following the same animated path. This module
// is what recognizes that situation; the crop box and its keyframes become
// the overlay's PLACEMENT rectangle, and V1 itself is never cropped in a
// composite (the whole point is to put the processed region back onto the
// full original frame).
//
// The trigger is purely a resolution difference (V2 ≠ V1), by design — no
// flag, no opt-in, nothing to remember to switch on. Same resolution means
// the old full-frame-replacement behavior, untouched.
//
// Sizes must match the crop box, or be an exact-aspect reduction INTO it
// (0.71.0). A 513×512 file next to a 512×512 box is a mistake somewhere
// upstream, and silently stretching it would bake a soft, misaligned region
// into an otherwise lossless render — that still warns and is left alone. But
// a 1440×1440 file over a 640×640 box is not a mistake: it's what an AI model
// hands back, since most of them emit their own native resolution rather than
// the size you fed them. The ratios being exactly equal means it drops into
// the box with a uniform scale, nothing stretched and nothing repositioned,
// so it is accepted and scaled rather than refused.
//
// Pairing across multiple clips is positional — 1st V2 clip onto 1st V1
// clip, 2nd onto 2nd — each inheriting that V1 clip's own crop/keyframes.

import { isExactAspectMatch, isFitCrop } from './cropMath'
import { clipMainSec, clipSpeed, clipTotalSec } from './clipMath'

// Shortest V1/V2 timeline intersection that earns a Compare layer, in seconds.
// Consecutive clips share an edge exactly, and floating-point lane sums land a
// hair either side of it, so this is the "they actually overlap" threshold and
// not a tolerance to tune: half a frame at 60fps, i.e. below anything that could
// present a picture.
export const COMPARE_MIN_OVERLAP_SEC = 0.008

// Can this V2 file be scaled down into the crop box without distorting it?
//
// The box is a {w, h} pair, which is the same shape a crop preset is, so the
// ratio test is literally the one `cropForPreset` uses — "same aspect ratio"
// means the same thing for a returned overlay as it does for a preset: a
// cross-multiplication of integers, no tolerance to tune (see cropMath).
//
// Downscale only, for the same reason the rest of the app never upscales: the
// overlay is meant to be a HIGHER-fidelity version of that region, so a file
// SMALLER than the box is the suspicious case, not the routine one, and
// magnifying it would put a visibly soft patch in the middle of an otherwise
// lossless frame. An equal-size file never reaches here — that's the exact
// match, handled before this is asked.
export function scalesIntoBox(box, srcW, srcH) {
  if (!box || !srcW || !srcH) return false
  return isExactAspectMatch(box, srcW, srcH) && srcW > box.w && srcH > box.h
}

// Reasons a V2 clip is NOT treated as an overlay. Returned rather than
// thrown so the caller can surface all of them at once.
export const SKIP_SAME_SIZE = 'same-size'
export const SKIP_NO_V1 = 'no-v1-clip'
export const SKIP_NO_CROP = 'no-crop'
export const SKIP_SIZE_MISMATCH = 'size-mismatch'
// A/B mode only: V2 matches V1's SOURCE size, but the V1 clip is cropped, so
// its rendered frame is the crop box instead — "cover the frame" has two
// possible meanings and neither is safe to guess.
export const SKIP_AMBIGUOUS_FULL_FRAME = 'ambiguous-full-frame'

// Pair V2 clips onto V1 clips by position and classify each pair.
//
// `opts.fullFrameSameSize` (default false) is what the A/B render mode turns
// on. Normally a V2 clip the same size as V1 is NOT an overlay at all — it's
// the ordinary full-frame replacement, and the preview shows it by swapping
// tracks rather than compositing. But when the user explicitly asks to render
// "V2 over V1 as one clip", a same-size V2 does have a meaning: it covers V1
// completely, i.e. an overlay at 0,0 spanning the whole frame. Only allowed
// when the V1 clip has NO crop — a cropped V1 clip's output frame is the crop
// box, so a source-sized V2 over it is ambiguous, and that case keeps falling
// through to the crop-box rules below (which reject it with a warning).
//
// Returns { overlays, skipped, warnings }:
//   • overlays[] — { index, v1Id, v2Id, v2Clip, v1Clip, x, y, w, h, srcW,
//                    srcH, scaled, keyframes } — one per pair that IS a
//                    composite. x/y/w/h
//                    are the placement rect in V1 SOURCE pixels (straight
//                    from the V1 clip's crop box); srcW/srcH are the V2
//                    file's own dimensions and `scaled` is true when they
//                    differ, i.e. the file is a larger same-ratio version
//                    that gets scaled down into the box; keyframes are that clip's
//                    cropKeyframes verbatim, still indexed in source seconds
//                    relative to inSec (the one unit the preview and the
//                    render expression already share — see cropAnimation.js).
//   • skipped[]  — { index, reason, v2Clip } for every pair that isn't.
//   • warnings[] — human-readable strings for the skips that look like
//                  mistakes (a size mismatch, a missing crop box). A
//                  same-resolution pair is NOT a mistake — that's ordinary
//                  V2 usage — so it produces no warning.
export function matchOverlays(v1Clips, v2Clips, opts = {}) {
  const fullFrameSameSize = !!opts.fullFrameSameSize
  const overlays = []
  const skipped = []
  const warnings = []
  if (!v2Clips || v2Clips.length === 0 || !v1Clips || v1Clips.length === 0) {
    return { overlays, skipped, warnings }
  }

  for (let i = 0; i < v2Clips.length; i++) {
    const v2 = v2Clips[i]
    // A clip whose dimensions haven't probed yet can't be classified either
    // way — skip it silently rather than warn about a transient state.
    if (!v2?.sourceWidth || !v2?.sourceHeight) continue

    const v1 = v1Clips[i]
    if (!v1) {
      skipped.push({ index: i, reason: SKIP_NO_V1, v2Clip: v2 })
      warnings.push(
        `V2 clip ${i + 1} ("${v2.displayName || v2.sourceName}") has no V1 clip in position ${i + 1} to composite onto — it stays a plain V2 clip.`
      )
      continue
    }
    if (!v1.sourceWidth || !v1.sourceHeight) continue

    if (v2.sourceWidth === v1.sourceWidth && v2.sourceHeight === v1.sourceHeight) {
      if (fullFrameSameSize) {
        // A FIT crop is the one cropped case that ISN'T ambiguous: its box is
        // the whole source frame, so a full-source-size V2 covers it exactly
        // and lands at 0,0 like any uncropped clip. The scale-down to the
        // preset happens after the composite, so the overlay rides along.
        // Refusing here would block the natural round trip — export the frame,
        // process it, bring it back — on exactly the clips where nothing was
        // cropped away in the first place.
        if (v1.crop && !isFitCrop(v1.crop)) {
          // Ambiguous: V2 is V1's SOURCE size, but a cropped V1 renders at its
          // crop box, so "cover the frame" could mean either. Refuse and say
          // so — in A/B the user explicitly asked for a composite, so a silent
          // skip would look like the toggle did nothing.
          skipped.push({ index: i, reason: SKIP_AMBIGUOUS_FULL_FRAME, v2Clip: v2 })
          warnings.push(
            `V2 clip ${i + 1} ("${v2.displayName || v2.sourceName}") is ${v2.sourceWidth}×${v2.sourceHeight}, ` +
            `the same as V1 clip ${i + 1}'s source — but that V1 clip is cropped to ${v1.crop.w}×${v1.crop.h}, ` +
            `so it renders at the crop size and there's no unambiguous way to lay a full-source-size clip over it. ` +
            `Either remove the crop, or use a V2 clip matching the ${v1.crop.w}×${v1.crop.h} crop box.`
          )
          continue
        }
        // A/B mode: composite it over the whole frame at 0,0. No keyframes —
        // there's nowhere for a full-frame cover to pan to.
        overlays.push({
          index: i,
          v1Id: v1.id,
          v2Id: v2.id,
          v1Clip: v1,
          v2Clip: v2,
          x: 0,
          y: 0,
          w: v2.sourceWidth,
          h: v2.sourceHeight,
          keyframes: [],
          fullFrame: true,
        })
        continue
      }
      // Identical resolution → the existing full-frame replacement, which is
      // a perfectly normal way to use V2 (Analyze/Reconstruct round-trips).
      skipped.push({ index: i, reason: SKIP_SAME_SIZE, v2Clip: v2 })
      continue
    }

    const crop = v1.crop
    if (!crop) {
      skipped.push({ index: i, reason: SKIP_NO_CROP, v2Clip: v2 })
      warnings.push(
        `V2 clip ${i + 1} ("${v2.displayName || v2.sourceName}") is ${v2.sourceWidth}×${v2.sourceHeight}, ` +
        `but V1 clip ${i + 1} has no crop box — there's no position to composite it at. ` +
        `Set a crop on the V1 clip (the box the region came from) first.`
      )
      continue
    }

    const exactSize = crop.w === v2.sourceWidth && crop.h === v2.sourceHeight
    const scaled = !exactSize && scalesIntoBox(crop, v2.sourceWidth, v2.sourceHeight)
    if (!exactSize && !scaled) {
      skipped.push({ index: i, reason: SKIP_SIZE_MISMATCH, v2Clip: v2 })
      // Say which of the two rules it missed, because the fixes are different:
      // a wrong ratio needs a different export or a different box, while a
      // same-ratio file that's merely too small just needs a bigger render.
      const sameRatio = isExactAspectMatch(crop, v2.sourceWidth, v2.sourceHeight)
      warnings.push(
        `V2 clip ${i + 1} ("${v2.displayName || v2.sourceName}") is ${v2.sourceWidth}×${v2.sourceHeight}, ` +
        `but V1 clip ${i + 1}'s crop box is ${crop.w}×${crop.h} — ` +
        (sameRatio
          ? `same aspect ratio, but smaller than the box, and it would have to be enlarged to fill it. ` +
            `Left alone rather than upscaled into a soft patch.`
          : `an overlay must either match the box exactly or be a larger file of the SAME aspect ratio ` +
            `(which is scaled down into it). ${v2.sourceWidth}×${v2.sourceHeight} is a different shape than ` +
            `${crop.w}×${crop.h}, so fitting it would stretch the picture. Left alone rather than resampled.`)
      )
      continue
    }

    overlays.push({
      index: i,
      v1Id: v1.id,
      v2Id: v2.id,
      v1Clip: v1,
      v2Clip: v2,
      x: crop.x,
      y: crop.y,
      // The placement rect is ALWAYS the crop box, never the file's own size:
      // that's what the region has to land back in. srcW/srcH record what the
      // file actually is, so `scaled` cases can say so — the render scales the
      // overlay input to w×h before compositing.
      w: crop.w,
      h: crop.h,
      srcW: v2.sourceWidth,
      srcH: v2.sourceHeight,
      scaled,
      keyframes: v1.cropKeyframes || [],
    })
  }

  return { overlays, skipped, warnings }
}

// Full-frame V2-over-V1 pairs for the V2 Compare view (0.72.0) — the
// onion-skin preview, where the whole V2 track is laid over the whole V1 track
// at half opacity so you can see straight away whether a reconstruction still
// lines up with the original underneath it.
//
// Deliberately carries NONE of matchOverlays' rules. Same resolution, a size
// mismatch, no crop box — every one of those is a case somebody might want to
// EYEBALL, and refusing to draw the layer would answer the question by hiding
// it. Nothing here reaches a render either: this is a view aid, so being
// permissive costs nothing more than a blend that looks wrong, which is
// information rather than damage.
//
// The placement rect is always V1's WHOLE source frame. The preview's shared
// <video> shows V1 uncropped (a crop is applied at render time, and is drawn
// here only as CropOverlay's outline), so "the whole V2 track over the whole V1
// track" is literally 0,0 → sourceWidth × sourceHeight. V2's own dimensions are
// not consulted at all — the layer fills that rect either way, which also means
// it appears immediately instead of waiting for a probe.
//
// **Pairing is by TIMELINE OVERLAP, not by clip index (0.74.0).** matchOverlays
// pairs 1st-with-1st because a composite is a per-clip decision — that V2 file
// was cut from that V1 clip's crop box. Compare is not: it is a question about
// two TRACKS at the same instant, so the only pairing that answers it is "what
// is on V2 at the moment V1 is showing this". Index pairing answers it only when
// the two lanes happen to be cut the same way, and the case Compare exists for
// is exactly the one where they aren't — a Reconstruct that turns one V1 clip
// into five V2 entries, or five V1 cuts into one long V2 file. Index pairing then
// drew a layer over the first clip and nothing anywhere else, so Compare went
// blank across most of the timeline (the whole point being to watch the two
// tracks stay in step for their whole length).
//
// So: walk both lanes as timelines and intersect them. One layer per V1 CLIP —
// not per pair — carrying the ordered list of V2 SEGMENTS that overlap it. A V1
// clip under five V2 cuts is one layer of five segments, and OverlayPreview
// walks them the way the playback engine walks V1's own clips.
//
// One layer per pair was the obvious shape and it is the wrong one, for a reason
// that only shows up on the intended input: a Reconstruct routinely puts dozens
// of small cuts on V2, every one of them over the same V1 clip, so every one
// would be simultaneously "the active layer" and mount its own <video> of the
// same file. Dozens of decoders and dozens of rAF loops to show one picture, with
// all but one hidden. Segments keep it at one element per V1 clip whatever V2 is
// cut like, and they make the disjointness structural rather than emergent: the
// layer shows the segment containing the playhead, so two 50% pictures cannot
// paint at once and the opacities cannot compound.
//
// Cross-lane seconds are directly comparable, which is what makes this sound
// rather than approximate: both lanes are laid out from the same origin at the
// same pps with GAP_PX at 0, so `clipStartSec` on V2 is a position in V1's
// domain. clipMath.snapTargets already leans on this (see its comment) and the
// same caveat applies — reintroduce a gap between clips and both surfaces have
// to convert through pixels instead.
//
// Each SEGMENT carries the mapping OverlayPreview needs to turn the shared
// <video>'s clock into its own:
//
//   ownT = srcOffsetSec + bodyT * srcRate        (bodyT = mainTime − v1.inSec)
//   shown while bodyFromSec ≤ bodyT ≤ bodyToSec
//
// which is one line in the loop and keeps every lane-arithmetic decision here,
// in a pure module that can be tested without a DOM. When the two lanes ARE cut
// alike each layer has exactly one segment and its numbers collapse to srcRate 1
// / srcOffsetSec v2.inSec — i.e. exactly what the positional version did, so
// nothing that worked before changes.
//
// Holds and speed: a head hold is timeline time in which the shared <video>'s
// clock does NOT advance, so it is subtracted out of the mapping (V1's body
// starts at s1 + head1) rather than treated as playable time. During a V1 hold
// the layer therefore freezes with V1 — the shared element is the only clock
// available here, and a frozen V1 frame with V2 still running would misrepresent
// the alignment far worse than both sitting still. Speed is the ratio of the two
// clips' rates: comparing a 0.5× V1 shot against a full-rate V2 one still lines
// the pictures up frame for frame.
export function compareOverlays(v1Clips, v2Clips) {
  const layers = []
  if (!v1Clips || !v2Clips) return layers

  // Both lanes' spans up front: one pass each, so the pairing below is a plain
  // interval intersection rather than a repeated cumulative sum.
  const spans = (clips) => {
    const out = []
    let pos = 0
    for (const c of clips) {
      const total = clipTotalSec(c)
      out.push({
        clip: c,
        start: pos,
        end: pos + total,
        // Where this clip's BODY sits on the lane — the only part of it the
        // source clock moves through.
        bodyStart: pos + (c.headHoldSec || 0),
        bodyEnd: pos + (c.headHoldSec || 0) + clipMainSec(c),
      })
      pos += total
    }
    return out
  }
  const v1Spans = spans(v1Clips)
  const v2Spans = spans(v2Clips)

  let index = 0
  for (const a of v1Spans) {
    // V1's size IS the rect, so without it there's nothing to place.
    if (!a.clip.sourceWidth || !a.clip.sourceHeight) continue
    const rate1 = clipSpeed(a.clip)
    const segments = []
    for (const b of v2Spans) {
      // Intersect the BODIES, not the whole spans. A hold contributes no
      // moving picture on either side, and a pair that meets only inside one
      // is a segment that could never show anything but a frozen frame.
      const from = Math.max(a.bodyStart, b.bodyStart)
      const to = Math.min(a.bodyEnd, b.bodyEnd)
      // Touching at a single instant is not an overlap: consecutive clips share
      // an edge, so `>=` would emit a zero-length segment at every boundary.
      if (to - from <= COMPARE_MIN_OVERLAP_SEC) continue
      const rate2 = clipSpeed(b.clip)
      const v2In = b.clip.inSec || 0
      segments.push({
        v2Id: b.clip.id,
        v2Clip: b.clip,
        // bodyT is V1 SOURCE seconds since v1.inSec, so lane seconds convert
        // through rate1 in and rate2 out.
        srcRate: rate2 / rate1,
        srcOffsetSec: v2In + (a.bodyStart - b.bodyStart) * rate2,
        bodyFromSec: (from - a.bodyStart) * rate1,
        bodyToSec: (to - a.bodyStart) * rate1,
      })
    }
    // A V1 clip with nothing over it gets no layer at all rather than an empty
    // one: `compareLayers.length` is what tells the log line whether Compare has
    // anything to show, and an empty layer would mount a component that can only
    // ever return null.
    if (segments.length === 0) continue
    layers.push({
      index: index++,
      v1Id: a.clip.id,
      v1Clip: a.clip,
      segments,
      // The first segment's clip, promoted so the shared fields every consumer
      // reads (`v2Id` for logs, `v2Clip` for the fallback src) are present on a
      // Compare layer as well as a composite one. The loop uses `segments`.
      v2Id: segments[0].v2Id,
      v2Clip: segments[0].v2Clip,
      x: 0,
      y: 0,
      w: a.clip.sourceWidth,
      h: a.clip.sourceHeight,
      // Nowhere for a full-frame layer to pan to, so no animation — the same
      // reason A/B's full-frame covers carry an empty list.
      keyframes: [],
      fullFrame: true,
    })
  }
  return layers
}

// How much of V1's timeline a set of Compare layers actually covers, in lane
// seconds. Reported in the log line beside V1's own length, because "does this
// hold for the WHOLE timeline" is the question the view is there to answer and
// the layers themselves are the only thing that knows: a V2 track shorter than
// V1, cut differently, or retimed all leave stretches with nothing over them,
// and a blank stretch otherwise looks identical to Compare being off.
//
// Each segment's window is in V1 SOURCE seconds (that being what the shared
// <video>'s clock is), so it divides back out by that clip's speed to land in
// lane seconds. Windows are disjoint by construction — that is the same property
// that keeps two 50% pictures from painting at once — so a plain sum is right and
// no interval merging is needed.
export function compareCoverageSec(layers) {
  let sec = 0
  for (const l of layers || []) {
    const rate1 = clipSpeed(l.v1Clip || {})
    for (const s of l.segments || []) {
      if (s.bodyFromSec == null || s.bodyToSec == null) continue
      sec += (s.bodyToSec - s.bodyFromSec) / rate1
    }
  }
  return sec
}

// The overlay (if any) whose V1 clip is `v1Id`. The preview looks itself up
// this way: it knows which source the shared <video> is currently decoding,
// not which array index it came from.
export function overlayForV1Clip(overlays, v1Id) {
  if (!overlays || !v1Id) return null
  return overlays.find(o => o.v1Id === v1Id) || null
}

// Does this V1 clip list + V2 clip list produce at least one composite?
// Drives whether V2 keeps REPLACING V1 in the preview (its old behavior) or
// composites over it.
export function hasOverlays(v1Clips, v2Clips) {
  return matchOverlays(v1Clips, v2Clips).overlays.length > 0
}
