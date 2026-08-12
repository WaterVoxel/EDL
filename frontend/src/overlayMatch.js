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
// Sizes must match the crop box EXACTLY. Nothing is resampled to fit: a
// 513×512 file next to a 512×512 box is a mistake somewhere upstream, and
// silently scaling it would bake a soft, misaligned region into an otherwise
// lossless render. Those cases warn and are left alone instead.
//
// Pairing across multiple clips is positional — 1st V2 clip onto 1st V1
// clip, 2nd onto 2nd — each inheriting that V1 clip's own crop/keyframes.

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
//   • overlays[] — { index, v1Id, v2Id, v2Clip, v1Clip, x, y, w, h,
//                    keyframes } — one per pair that IS a composite. x/y/w/h
//                    are the placement rect in V1 SOURCE pixels (straight
//                    from the V1 clip's crop box); keyframes are that clip's
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
        if (v1.crop) {
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

    if (crop.w !== v2.sourceWidth || crop.h !== v2.sourceHeight) {
      skipped.push({ index: i, reason: SKIP_SIZE_MISMATCH, v2Clip: v2 })
      warnings.push(
        `V2 clip ${i + 1} ("${v2.displayName || v2.sourceName}") is ${v2.sourceWidth}×${v2.sourceHeight}, ` +
        `but V1 clip ${i + 1}'s crop box is ${crop.w}×${crop.h} — an overlay must match the box exactly, ` +
        `so it was left alone rather than resampled.`
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
      w: crop.w,
      h: crop.h,
      keyframes: v1.cropKeyframes || [],
    })
  }

  return { overlays, skipped, warnings }
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
