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

// "Batch Analyze" is the plain-cut sibling of Analyze, for a whole sequence
// handled as ONE file: Render V1 (or Render V2 in its `1` mode) joins the cut
// into a single clip, that file goes out to an external tool and comes back
// whole, and all that's wanted from it is V1's cuts — the file split where V1
// splits, nothing else applied.
//
// Analyze can't do that job, and the difference is which time base V2's numbers
// live in. Analyze clones each V1 clip's own inSec/outSec onto V2, which is
// meaningful only when V2 is another version of the SAME source (an alternate
// take, a cleaned-up master) — there, the same timecodes still point at the same
// footage. A joined render is a different animal: it holds V1's clips laid end
// to end, so its second shot does not begin at V1 clip 2's inSec, it begins
// where clip 1 ended. Batch Analyze therefore works in SEQUENCE time —
// cumulative durations from the head of V2's own window — which is also the only
// reading of "the same places as V1" that lands on the frames the user sees
// under V1's own playhead.
//
// Nothing else about V1 is copied. Holds especially are NOT re-applied: the
// round-tripped file already contains those frozen frames as real footage, so
// adding a hold to a segment would duplicate them a second time. Reverse and
// speed are likewise already baked in (same reasoning reconstructFromV1
// documents at length). Each segment keeps V2's own clip's properties and
// differs from its neighbours only in where it starts and ends.

// The PIECES the V1 sequence renders as, in order: every clip's main body, plus
// the frozen holds at the sequence's outer edges — head hold on clip 0, then
// tail and round-up on the last clip, which is exactly where the render puts
// them (app.py's lead_hold/trail_hold rule, mirrored client-side by
// clipMath.sanitizeHoldPlacement).
//
// A hold is a PIECE in its own right here, not padding attached to a clip. In
// the joined file it is a stretch of one frozen frame, visually and editorially
// a different thing from the footage either side of it — and in a file that has
// been out through an external tool it is the part most likely to want handling
// on its own. So Batch Analyze cuts at holds too, and a 4-clip V1 with a head
// hold and a Raise yields 4 shots plus its holds rather than 4 clips with the
// freezes buried inside the first and last.
//
// Tail and round-up freeze the SAME frame but stay separate pieces, because the
// timeline draws them separately (fuchsia TAIL, amber ROUND) and Raise owns the
// second one — merging them would hide a round-up inside a clip the user thinks
// of as the tail hold.
//
// Mid-sequence holds are deliberately absent: a stale one is reachable in the UI
// (see gotchas.md) but the render drops it, so the file being cut does not
// contain it, and cutting there would put every later boundary on the wrong
// frame. A zero-length piece is never emitted, so a zero-length clip simply
// isn't a piece.
export function sequencePieces(v1Clips) {
  const pieces = []
  v1Clips.forEach((c, i) => {
    if (i === 0 && (c.headHoldSec || 0) > 0) pieces.push({ kind: 'head', sec: c.headHoldSec })
    const main = clipMainSec(c)
    if (main > 0) pieces.push({ kind: 'main', sec: main })
    if (i === v1Clips.length - 1) {
      if ((c.tailHoldSec || 0) > 0) pieces.push({ kind: 'tail', sec: c.tailHoldSec })
      if ((c.roundHoldSec || 0) > 0) pieces.push({ kind: 'round', sec: c.roundHoldSec })
    }
  })
  return pieces
}

// Where those pieces meet, in seconds from the start of the rendered sequence:
// P pieces give P-1 internal boundaries. The end of the sequence is not a cut.
export function sequenceCutOffsets(v1Clips) {
  const pieces = sequencePieces(v1Clips)
  const offsets = []
  let elapsed = 0
  for (let i = 0; i < pieces.length - 1; i++) {
    elapsed += pieces[i].sec
    offsets.push(elapsed)
  }
  return offsets
}

const CUT_EPSILON = 0.001

// Which name a segment gets, by the kind of V1 piece that starts it.
const PIECE_NAMES = { main: 'Shot', head: 'Head', tail: 'Tail', round: 'Round' }

// Returns { segments, kinds, overflow, leftoverSec }:
//   segments    — V2's FIRST clip replaced by one clip per V1 PIECE, in track
//                 order; any further V2 clips are left exactly as they were
//                 (same convention as reconstructFromV1 — Render V2 in `1` mode
//                 is what's meant to collapse V2 to one clip first).
//   kinds       — the piece kind each of those segments starts with
//                 ('main'|'head'|'tail'|'round'), parallel to the segments, so a
//                 caller can report "4 shots + 2 holds" without re-deriving it
//                 or reading names back off the clips.
//   overflow    — seconds by which V1's sequence ran past the end of V2's own
//                 window, 0 when it fit. Cut points past that end produce no
//                 segment at all rather than an empty one, so a V2 file shorter
//                 than V1 yields fewer segments than V1 has pieces.
//   leftoverSec — seconds by which V2's window outlasts V1's sequence, 0 when it
//                 doesn't. Not trimmed off: see below.
//
// These are CUT POINTS, not durations. P pieces give P-1 boundaries and the last
// segment runs to the END of V2's window rather than stopping at V1's total,
// because that is what cutting a file means — no footage is discarded. It also
// keeps whatever an external tool added (a padded frame, a slightly longer
// generation) instead of silently dropping it; `leftoverSec` reports it so the
// extra length is visible rather than a surprise.
export function batchCutAgainstV1(v1Clips, v2Clips) {
  const pieces = sequencePieces(v1Clips)
  if (pieces.length === 0 || v2Clips.length === 0) {
    return { segments: v2Clips, kinds: [], overflow: 0, leftoverSec: 0 }
  }

  const v2c = v2Clips[0]
  const span = v2c.outSec - v2c.inSec
  const v1Sec = pieces.reduce((sum, p) => sum + p.sec, 0)
  const overflow = Math.max(0, v1Sec - span)
  const leftoverSec = Math.max(0, span - v1Sec)

  // Snapped to V2's own frame grid: a cut point is a frame boundary, and
  // rounding to the nearest frame here means the segments tile V2's window
  // exactly instead of leaving sub-frame slivers for ffmpeg's `trim` to resolve
  // one way at the end of one shot and the other way at the start of the next.
  // V2's fps, not V1's — these are source times on V2's file.
  const fps = v2c.fps > 0 ? v2c.fps : 0
  const snap = s => (fps ? Math.round(s * fps) / fps : s)

  // Segment starts, each labelled with the kind of V1 piece that begins there.
  // Only cuts strictly inside V2's window and strictly after the previous
  // surviving one are kept, and both halves of that exist to drop an EMPTY
  // segment rather than a real one: a cut past the end has no footage to cut (it
  // is counted in `overflow` instead), and a cut landing on the previous
  // boundary — two pieces whose boundary snaps to the same frame of V2 — has no
  // footage between them. A dropped cut merges its piece into the one before it.
  const edges = [{ at: 0, kind: pieces[0].kind }]
  let elapsed = 0
  for (let i = 0; i < pieces.length - 1; i++) {
    elapsed += pieces[i].sec
    const at = snap(elapsed)
    if (at > edges[edges.length - 1].at + CUT_EPSILON && at < span - CUT_EPSILON) {
      edges.push({ at, kind: pieces[i + 1].kind })
    }
  }

  // Numbered PER KIND rather than by one running count, so the shots stay
  // Shot01…ShotN for V1's N clips however many holds sit among them, and a hold
  // segment says which hold it is instead of being an unexplained gap in the
  // shot numbering.
  const counts = {}
  const cut = edges.map((edge, i) => {
    counts[edge.kind] = (counts[edge.kind] || 0) + 1
    return {
      ...v2c,
      id: crypto.randomUUID(),
      inSec: v2c.inSec + edge.at,
      outSec: v2c.inSec + (i + 1 < edges.length ? edges[i + 1].at : span),
      headHoldSec: 0,
      tailHoldSec: 0,
      roundHoldSec: 0,
      dirty: true,
      displayName: `${PIECE_NAMES[edge.kind]}${String(counts[edge.kind]).padStart(2, '0')}`,
    }
  })

  return {
    segments: [...cut, ...v2Clips.slice(1)],
    kinds: edges.map(e => e.kind),
    overflow,
    leftoverSec,
  }
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
