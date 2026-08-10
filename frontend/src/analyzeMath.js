import { clipMainSec } from './clipMath.js'

// "Analyze" applies the V1 timeline's cut structure directly onto a
// different file dropped on V2: each V2 segment uses the SAME inSec/outSec
// and the SAME head/tail/round hold durations as the corresponding V1
// clip — i.e. V1's clips are cloned onto the V2 file at identical time
// locations, not repacked. This is the standard "conform to matching
// timecodes" operation: useful when V2 holds an alternate take, a
// higher-quality version, or the pre-edit original of the same footage,
// where the same trim points still make sense.
//
// Reversed is deliberately NOT copied — the V2 segment always plays
// forward, since bringing in fresh footage to re-cut is not the same
// operation as replaying it backwards.
//
// Returns { segments, overflow }:
//   segments — clip objects sourced from the V2 file, one per V1 clip,
//              at V1's exact inSec/outSec and hold durations.
//   overflow — total seconds by which any V1 clip's outSec (or, for the
//              last clip, outSec + hold durations) exceeded the V2 file's
//              duration — 0 if every cut point fit. When >0 the affected
//              segment(s) are clamped to the V2 file's end.

// "Reconstruct" is the counterpart to Analyze in a round-trip workflow: the
// timeline's two numbered buttons encode it directly —
//   1. Analyze conforms V2's clip(s) to V1's exact cut structure.
//   2. The user takes that V2 footage OUT of the app entirely (renders it
//      via Render V2 — which always merges every V2 clip into ONE
//      continuous file — runs it through an external tool, e.g. a
//      style-transfer model, and drops the result back onto V2 via
//      handleAddToV2, which always replaces V2 with a single fresh clip).
//   3. Reconstruct strips the V1-derived edit artifacts that got baked
//      into that round-tripped footage back out, so V2 plays as if V1's
//      decisions had never been applied — ready for Render V2 again.
//
// Because step 2 ALWAYS collapses V1's clips down to one V2 clip, holds
// and round-up must be treated as SEQUENCE-level facts about V1, not
// per-clip ones — exactly like sanitizeHoldPlacement/RaiseButton already
// treat them (headHold only ever lives on V1's first clip; tail/round
// only ever on V1's last). Pairing V2 clip i against V1 clip i by index
// (as an earlier version of this function did) silently ignored anything
// on V1 clip 0 that wasn't first among V1's holds/reverses, so this
// works off the WHOLE V1 sequence instead — no assumption that V2's clip
// count matches V1's.
//
// This MODIFIES the clip(s) already on V2 in place; it never pulls in or
// replaces anything with V1's own sourceName (that would defeat the
// point — the whole reason V2 has its own file is that it's a different,
// restyled version of the footage). If V2 somehow holds more than one
// clip (e.g. Reconstruct was run before ever rendering V2), only the
// first is treated as the round-tripped result and the rest are left
// untouched — Render V2 is what's meant to collapse V2 to one clip
// first.
//
// What "reverse the decision" means differs per field, because holds,
// speed, and crop are BAKED IN as real pixels/frames by the time footage
// comes back from outside the app — there's no way to recover data that
// was literally cropped away or interpolated out, only to stop
// compounding it further:
//   reversed — copied directly (NOT toggled), and only when every V1 clip
//     agrees on it (mixed forward/reversed clips can't be represented by
//     one flat V2 clip — same unrecoverable situation as crop, see
//     below). If V1 played backward, the round-tripped file is ALSO in
//     that reversed frame order, so setting V2's own reversed flag to
//     the SAME value plays it a second time in reverse — landing back in
//     true chronological order. (Two reversals cancel: v2.reversed =
//     v1.reversed, not !v1.reversed.)
//   holds — V1's SEQUENCE-level head/tail/round hold (headHoldSec on
//     V1's first clip; tailHoldSec+roundHoldSec on V1's last) are
//     duplicated frames physically rendered at the very start/end of the
//     merged output, regardless of any individual clip's own reversed
//     state (clipTotalSec always adds head before the main body and
//     tail+round after it, for every clip in the sequence). Trimmed off
//     V2's own inSec/outSec so that padding isn't carried forward again.
//   speed — V1's slow-down is already realized as repeated frames at the
//     stretched duration in the rendered file; V2's own speed is reset to
//     1 so it isn't slowed a second time on top of already-slow footage.
//   crop — UNRECOVERABLE: pixels outside V1's crop box don't exist in the
//     round-tripped footage. Reset to null (no further crop stacked on
//     top) rather than pretending to restore them.
// Trim (inSec/outSec) has no separate inversion beyond the hold removal
// above: the round-tripped file already contains exactly V1's trimmed
// window's content end to end, so the remaining span (after stripping
// hold padding) IS the reconstructed range — there's no more-original
// footage to trim back out to.
//
// Duplicate handling: DuplicateButton clones a clip's sourceName/inSec/
// outSec verbatim (reversed/speed/crop/holds can differ — see
// DuplicateButton.jsx), and always inserts the copy right after the
// original — so the FIRST V1 clip to use a given sourceName+inSec+outSec
// combination (by EDL event order, i.e. array index — "EVT001") is the
// original, and any later clip repeating that same window is a duplicate
// that has no business surviving into a reconstructed V2, exactly like
// holds/speed/crop don't.
//
// Because Reconstruct still collapses to ONE flat V2 clip (never splits
// into per-clip segments), only a duplicate run that's contiguous with the
// very end of V1's sequence can be handled by shrinking that one clip's
// outSec further (the same "trim off known baked-in footage" move already
// used for tailHold/roundHold above). A duplicate stranded in the true
// middle of the sequence can't be cut out of a single flat time range
// without also cutting the real, non-duplicate footage between it and the
// end — so that case is left alone and reported as a warning instead of
// guessed at, matching the existing mixed-reversed warning's philosophy.
function keyForClip(c) {
  return `${c.sourceName}|${c.inSec.toFixed(3)}|${c.outSec.toFixed(3)}`
}

function findTrailingDuplicateRun(v1Clips) {
  const seen = new Set()
  const isDuplicate = v1Clips.map(c => {
    const key = keyForClip(c)
    if (seen.has(key)) return true
    seen.add(key)
    return false
  })

  let trailingSec = 0
  let trailingCount = 0
  for (let i = v1Clips.length - 1; i >= 0 && isDuplicate[i]; i--) {
    trailingSec += clipMainSec(v1Clips[i])
    trailingCount++
  }

  const strandedCount = isDuplicate.slice(0, v1Clips.length - trailingCount).filter(Boolean).length

  return { trailingSec, trailingCount, strandedCount }
}

// Returns { segments, warnings }: warnings cover the hold-padding-too-large
// case (skips the hold trim for that clip), the mixed-reversed case (leaves
// V2's own reversed flag alone rather than guessing), and duplicate V1
// clips stranded mid-sequence (left in V2 untouched — see above).
export function reconstructFromV1(v1Clips, v2Clips) {
  const warnings = []
  if (v1Clips.length === 0 || v2Clips.length === 0) return { segments: v2Clips, warnings }

  const v2c = v2Clips[0]
  const headHold = v1Clips[0].headHoldSec || 0
  const lastV1 = v1Clips[v1Clips.length - 1]
  const tailHold = (lastV1.tailHoldSec || 0) + (lastV1.roundHoldSec || 0)
  const { trailingSec: dupTrailSec, trailingCount: dupTrailCount, strandedCount } = findTrailingDuplicateRun(v1Clips)

  if (strandedCount > 0) {
    warnings.push(
      `"${v2c.displayName || v2c.sourceName}": ${strandedCount} duplicate ` +
      `V1 clip(s) sit in the middle of the sequence, not at its end — ` +
      `they could not be cut out of V2's single reconstructed clip and ` +
      `were left in place`
    )
  }

  let inSec = Math.min(v2c.inSec + headHold, v2c.outSec)
  let outSec = Math.max(v2c.outSec - tailHold - dupTrailSec, v2c.inSec)
  if (outSec <= inSec) {
    warnings.push(
      `"${v2c.displayName || v2c.sourceName}": V1's hold durations plus ` +
      `${dupTrailCount} trailing duplicate clip(s) ` +
      `(${(headHold + tailHold + dupTrailSec).toFixed(2)}s total) meet or ` +
      `exceed the clip's own trimmed length — could not be removed`
    )
    inSec = v2c.inSec
    outSec = v2c.outSec
  } else if (dupTrailCount > 0) {
    warnings.push(
      `"${v2c.displayName || v2c.sourceName}": removed ${dupTrailCount} ` +
      `trailing duplicate V1 clip(s) worth of footage ` +
      `(${dupTrailSec.toFixed(2)}s) from the end of V2's reconstructed range`
    )
  }

  // Trailing duplicates were just trimmed out of V2 entirely — they no
  // longer contribute footage, so they shouldn't count toward whether the
  // SURVIVING clips agree on reversed.
  const survivingV1Clips = dupTrailCount > 0 ? v1Clips.slice(0, v1Clips.length - dupTrailCount) : v1Clips
  const allReversed = survivingV1Clips.every(c => !!c.reversed)
  const noneReversed = survivingV1Clips.every(c => !c.reversed)
  let reversed = v2c.reversed
  if (allReversed) {
    reversed = true
  } else if (noneReversed) {
    reversed = false
  } else {
    warnings.push(
      `"${v2c.displayName || v2c.sourceName}": V1's clips don't agree on ` +
      `reversed (some forward, some reversed) — a single V2 clip can't ` +
      `represent that, so its own reversed flag was left unchanged`
    )
  }

  const reconstructed = {
    ...v2c,
    inSec,
    outSec,
    reversed,
    speed: 1,
    crop: null,
    cropKeyframes: [],
    headHoldSec: 0,
    tailHoldSec: 0,
    roundHoldSec: 0,
    dirty: true,
    displayName: 'Reconstructed01',
  }

  return { segments: [reconstructed, ...v2Clips.slice(1)], warnings }
}

export function analyzeAgainstV1(v1Clips, v2File) {
  let overflow = 0
  const v2DurationSec = v2File.sourceDurationSec

  const segments = v1Clips.map((c, i) => {
    const inSec = Math.min(c.inSec, v2DurationSec)
    let outSec = c.outSec
    if (outSec > v2DurationSec) {
      overflow += outSec - v2DurationSec
      outSec = v2DurationSec
    }
    return {
      id: crypto.randomUUID(),
      sourceName: v2File.sourceName,
      sourceDir: v2File.sourceDir,
      sourceDurationSec: v2DurationSec,
      fps: v2File.fps,
      inSec,
      outSec,
      headHoldSec: c.headHoldSec || 0,
      tailHoldSec: c.tailHoldSec || 0,
      roundHoldSec: c.roundHoldSec || 0,
      reversed: false,
      dirty: true,
      displayName: `Analyzed${String(i + 1).padStart(2, '0')}`,
    }
  }).filter(seg => seg.outSec > seg.inSec) // V1's clip lies entirely beyond V2's footage — nothing to cut

  return { segments, overflow }
}
