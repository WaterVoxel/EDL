import { clipSpeed, sequenceTargetFps, clipRenderFrames } from './clipMath.js'
import { isFitCrop } from './cropMath.js'

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

// "Reconstruct" is the counterpart to Analyze in a round-trip workflow:
//   1. Analyze (or Batch Analyze) conforms V2's clip(s) to V1's cut structure.
//   2. The user takes that footage OUT of the app entirely — V2 Render, which
//      always merges every V2 clip into ONE continuous file, then an external
//      tool (e.g. a style-transfer model), then handleAddToV2, which always
//      replaces V2 with a single fresh clip.
//   3. Reconstruct reverses the decisions V1 baked into that file, so V2 holds
//      the footage as it came off the camera — ready to be cut afresh.
//
// Step 3 is a CUT plus a REORDER, and it has to be: the round-tripped file
// holds V1's shots laid end to end IN V1'S ORDER, and no single time range can
// express "put them back where they came from". So Reconstruct cuts V2's clip
// at V1's own piece boundaries — sequencePieces + pieceOffsetsOnV2, the same
// arithmetic Batch Analyze cuts with — and emits the survivors in SOURCE order.
// An earlier version returned one flat clip whose in/out depended only on V1's
// holds; every quantity it read was symmetric over V1's array, so moving clips
// around on V1 could not change its output at all — which is exactly the
// decision most worth reversing.
//
// What "reverse the decision" means, field by field. Holds, speed and crop are
// BAKED IN as real pixels and frames by the time footage comes back from
// outside the app, so for those the only question is whether the reversal can
// stop compounding them:
//   ORDER — reversed by re-sorting the cut pieces into source order: grouped by
//     source file (a file's first appearance on V1 decides where its run goes),
//     ascending by the V1 clip's own source IN inside a group. SOURCE seconds,
//     never the ranges on V2 — a slowed clip occupies more of the file than its
//     source window, so sorting by the range would put it in the wrong place.
//   CUTS — pieces that come back adjacent are WELDED into one clip again (see
//     weldAdjacentRanges), so reversing a reorder costs the fewest clips that
//     can express it, and a sequence nobody reordered collapses to exactly the
//     single clip this function used to return.
//   holds — head/tail/round are duplicate frames the render froze at the
//     sequence's outer edges. They are their own PIECES here, so they get
//     dropped rather than trimmed off V2's in/out — which is what makes the
//     hold removal survive a reorder, and what makes a stale mid-sequence hold
//     a non-event (sequencePieces applies the render's own first/last rule).
//   duplicates — DuplicateButton clones sourceName/inSec/outSec verbatim, so
//     the first clip to use a given window (by EDL event order, i.e. array
//     index — "EVT001") is the original, and any later clip repeating it is a
//     duplicate whose footage has no business surviving into a reconstruction.
//     Cutting per piece means one sitting in the MIDDLE of the sequence can now
//     be dropped as well; the old flat clip could only shrink its own outSec,
//     so it had to warn about that case instead of handling it.
//   reversed — copied per shot, NOT toggled. If V1 played a clip backward, the
//     round-tripped file holds those frames in that same backward order, so
//     setting the V2 clip's own flag to the SAME value plays them backward a
//     second time and lands in true chronological order (two reversals cancel).
//     Per shot, so V1's clips no longer have to agree on it.
//   speed — a V1 slow-down is realized as REPEATED frames at the stretched
//     duration, so the shot comes back long: 24 frames slowed to 0.5x arrive as
//     48. The V2 clip therefore carries the RECIPROCAL speed (2x), which drops
//     exactly those repeats and puts the shot back at its original 24 frames.
//     That is exact rather than approximate — a stretch only ever duplicates
//     frames, so compressing it again only ever drops duplicates; every preset
//     was rendered out and back and came home frame-for-frame byte-identical,
//     including the non-integer reciprocals (0.75x → 1.333x, 0.4x → 2.5x).
//     `restoredSec` says how many seconds that took back off, so the caller
//     reports a measurement instead of a caveat. Two things it does NOT undo:
//     the shot's AUDIO, since a retime in either direction renders silent, so
//     there is no sound in the stretched file to restore; and a reciprocal above
//     the render's MAX_SPEED, which no SpeedForm preset can produce but a
//     hand-edited .nara could — those shots keep speed 1 and are listed in
//     `unrestoredSpeeds` rather than emitted at a speed the render would refuse.
//   TIMING — every piece boundary is measured in whole FRAMES, via
//     clipRenderFrames, because that is how the render lays footage
//     down (ffmpeg_utils.clip_timing). Measuring in raw seconds instead puts each
//     boundary up to a frame off, multiplies that by 1/speed on a slowed shot,
//     and accumulates it down the sequence — which is the one error a
//     reconstruction cannot recover from, since a cut on the wrong frame splices
//     a neighbouring shot's frames onto this one.
//   crop — UNRECOVERABLE when it's a CUT: the pixels outside V1's crop box
//     don't exist in the round-tripped footage. Reset to null instead of faking
//     a restore. (The route that CAN put a processed region back is
//     V2-as-overlay, not this.) A FIT crop loses no picture, but it is still
//     reset, for a different reason: the round-tripped file is already AT the
//     fit size, so re-applying the fit would scale it a second time.
//   trim — no separate inversion. The file contains exactly the windows V1
//     used, so footage V1 never used is simply absent; the caller reports how
//     many seconds of each source that came to.
//
// Two invariants: this only ever MODIFIES the clip(s) already on V2 — it never
// reads or copies V1's own sourceName, since the whole point is that V2 is a
// different, restyled version of the footage — and if V2 holds more than one
// clip, only the first is treated as the round-tripped result and the rest are
// passed through untouched (V2 Render is what collapses V2 to one clip).
//
// PRECONDITION, load-bearing: V2's file must have been rendered from V1 in the
// order V1 is in NOW. Reconstruct reads V1 at click time, so reordering V1
// after that render puts every boundary on the wrong frame — and no length
// check can catch it, because a permutation preserves total duration. See
// gotchas.md; the caller warns off V1's own dirty flags.
function keyForClip(c) {
  return `${c.sourceName}|${c.inSec.toFixed(3)}|${c.outSec.toFixed(3)}`
}

// Which V1 clips repeat a window an earlier clip already used — one boolean per
// clip, parallel to the array. Structural rather than the clip's own
// `isDuplicate` flag, which is a LABEL the UI paints and editing can leave
// behind (gotchas.md): what matters here is whether the footage is already
// somewhere else in the sequence.
function duplicateFlags(v1Clips) {
  const seen = new Set()
  return v1Clips.map(c => {
    const key = keyForClip(c)
    if (seen.has(key)) return true
    seen.add(key)
    return false
  })
}

// One media FILE, for grouping shots by where they came from. The directory is
// part of it: input/take1.mp4 and output/take1.mp4 are different footage.
function sourceKey(c) {
  return `${c.sourceDir || 'input'}|${c.sourceName}`
}

// Seconds covered by a set of [from, to] windows, counting footage two windows
// share only ONCE — so "V1 used 9.00s of the 12.00s file" stays true when two
// V1 clips overlap in the source. The difference from the plain sum is the
// repeated footage, which the caller reports on its own.
function unionSec(windows) {
  const sorted = [...windows].sort((a, b) => a[0] - b[0])
  let total = 0
  let from = null
  let to = null
  for (const w of sorted) {
    if (to === null || w[0] > to) {
      if (to !== null) total += to - from
      from = w[0]
      to = w[1]
    } else if (w[1] > to) {
      to = w[1]
    }
  }
  if (to !== null) total += to - from
  return total
}

// The order the surviving shots came off the camera: grouped by source file,
// each file's run sitting where that file FIRST appears on V1, ascending by the
// V1 clip's own source IN within a run. Ties keep V1's order, so the comparison
// is total and the sort deterministic.
//
// SOURCE seconds, never the ranges these shots occupy on V2: a slowed clip
// takes up more of the rendered file than its source window does, so ordering
// by the range would put it in the wrong place.
function sourceChronologicalOrder(kept, v1Clips) {
  const firstAppearance = new Map()
  v1Clips.forEach((c, i) => {
    const key = sourceKey(c)
    if (!firstAppearance.has(key)) firstAppearance.set(key, i)
  })

  return [...kept].sort((a, b) => {
    const ca = v1Clips[a.v1Index]
    const cb = v1Clips[b.v1Index]
    const groupA = firstAppearance.get(sourceKey(ca))
    const groupB = firstAppearance.get(sourceKey(cb))
    if (groupA !== groupB) return groupA - groupB
    if (ca.inSec !== cb.inSec) return ca.inSec - cb.inSec
    return a.v1Index - b.v1Index
  })
}

// Ranges that came back adjacent become ONE clip again: consecutive in the
// output, contiguous in V2's file, same `reversed`, same `speed`. This is what
// collapses a reconstruct of a sequence nobody reordered down to the single clip
// spanning the file that this module used to return, and what "put the order back
// without any cuts" means when a move IS reversed — un-moving [C][A][B] needs a
// cut between C and A, but none between A and B.
//
// Which SIDE counts as contiguous depends on `reversed`, and getting it
// backwards silently swaps the pair. A forward clip plays its range low → high,
// so the shot that follows it in the output must sit immediately AFTER it in the
// file; a reversed clip plays high → low, so the next shot must sit immediately
// BEFORE it. Welding two reversed shots on the forward rule would emit them in
// the opposite order — the very bug this rewrite exists to fix, one clip
// smaller. A reversed shot never welds to a forward one: a single flag can't
// play both ways.
//
// Speed has to agree for the same reason, and it is the newer of the two rules:
// a clip carries ONE speed, so welding a 0.5x shot to a 1x one would apply that
// range's single reciprocal to both and mistime everything but the first. The
// visible cost is that a mixed-speed reconstruction draws as several V2 clips
// instead of one fused clip (clipMath.fuseGroups also requires speed to match) —
// a seam where the timing genuinely changes, rather than one clip that is wrong.
function weldAdjacentRanges(ordered, v1Clips) {
  const welded = []
  for (const r of ordered) {
    const prev = welded[welded.length - 1]
    const reversed = !!v1Clips[r.v1Index].reversed
    const speed = clipSpeed(v1Clips[r.v1Index])
    const contiguous = prev && prev.reversed === reversed && prev.speed === speed && (reversed
      ? Math.abs(r.to - prev.from) <= CUT_EPSILON
      : Math.abs(r.from - prev.to) <= CUT_EPSILON)

    if (contiguous) {
      prev.from = Math.min(prev.from, r.from)
      prev.to = Math.max(prev.to, r.to)
      prev.v1Indexes.push(r.v1Index)
      prev.truncatedSec += r.truncatedSec
    } else {
      welded.push({
        from: r.from,
        to: r.to,
        reversed,
        speed,
        v1Indexes: [r.v1Index],
        truncatedSec: r.truncatedSec,
      })
    }
  }
  return welded
}

// The V2 speed that undoes a V1 slow-down: its reciprocal. 1x stays 1x, and a
// reciprocal past what the render accepts stays 1x too — mirroring app.py's
// MAX_SPEED here rather than emitting a clip /api/render_timeline would reject
// with a 400 at Render, long after the user could tell why. Nothing SpeedForm
// offers reaches it (its slowest preset is 0.2x → 5x, and the 12 fps effective
// floor bounds it tighter still); a hand-edited .nara is the only way in.
const MAX_RESTORE_SPEED = 10.0

function restoreSpeed(v1Speed) {
  if (v1Speed === 1) return 1
  const reciprocal = 1 / v1Speed
  return reciprocal <= MAX_RESTORE_SPEED + 1e-9 ? reciprocal : 1
}

// Returns FACTS, no display strings — the caller owns every word the user reads,
// the same split batchCutAgainstV1 and handleBatchAnalyze already use:
//   segments    — V2's FIRST clip replaced by one clip per surviving shot in
//                 source order, then any further V2 clips verbatim. The SAME
//                 ARRAY REFERENCE when there is nothing to reconstruct, so
//                 reduceEdit's reference check spends no undo step on a no-op
//                 (the moveClip convention in clipMath.js) and the caller can
//                 detect the no-op with `===`.
//   shots       — one entry per emitted clip, in output order:
//                 { v1Indexes, from, to, reversed, v1Speed, speed,
//                 truncatedSec } — `v1Speed` is what V1 ran at and `speed` the
//                 reciprocal now on the clip, equal only when both are 1. v1Indexes are
//                 0-based indexes into v1Clips — every clip welded into that
//                 segment, in output order — so the caller can print the order
//                 that was reversed. from/to are seconds from the head of V2's
//                 window.
//   welds       — how many shots were absorbed into an earlier segment.
//   reordered   — whether source order differs from V1's order at all.
//   sources     — per source file, in first-appearance order: { sourceName,
//                 sourceDir, shots, speedShots, croppedShots, sourceDurationSec,
//                 usedSec, unusedSec, overlapSec }. sourceDurationSec and
//                 unusedSec are null when the duration isn't known, so the
//                 caller skips that line instead of printing NaN.
//   restoredSpeeds — one { from, to } per distinct V1 slow-down that was undone:
//                 `from` is the speed V1 ran at, `to` the reciprocal now on V2.
//   restoredSec — { stretchedSec, unstretchedSec }: how much of V2's file those
//                 shots occupy, and what they render back down to.
//   unrestoredSpeeds — V1 speeds whose reciprocal exceeded MAX_RESTORE_SPEED, so
//                 those shots stayed at 1× and DO come back stretched. Empty for
//                 anything the app itself can produce.
//   dropped     — what did not survive: holds and duplicates (count + the
//                 seconds they occupied in V2's file), pastEnd (pieces landing
//                 entirely past the end of V2's window) and subFrame (ranges
//                 that snapped to under a frame wide).
//   overflow /
//   leftoverSec — as batchCutAgainstV1 measures them, but leftover frames are
//                 LEFT OUT here rather than kept (see below).
export function reconstructFromV1(v1Clips, v2Clips) {
  const dropped = { holds: 0, holdSec: 0, duplicates: 0, duplicateSec: 0, pastEnd: 0, pastEndSec: 0, subFrame: 0 }
  const nothing = {
    segments: v2Clips, shots: [], welds: 0, reordered: false, sources: [],
    restoredSpeeds: [], restoredSec: { stretchedSec: 0, unstretchedSec: 0 }, unrestoredSpeeds: [],
    dropped, overflow: 0, leftoverSec: 0,
  }

  const pieces = v2Clips.length > 0 ? sequencePieces(v1Clips) : []
  if (pieces.length === 0) return nothing

  const v2c = v2Clips[0]
  const { offsets, span, overflow, leftoverSec } = pieceOffsetsOnV2(pieces, v2c)
  const isDuplicate = duplicateFlags(v1Clips)

  // Each piece's own range in V2's file, clamped to V2's window — keeping the
  // ones that are real footage the reconstruction should still contain, and
  // accounting for the ones that aren't. Dropped seconds are measured CLAMPED,
  // i.e. as they exist in V2's file: a hold past the end of a short V2 was never
  // in the file to remove, so it reports 0s rather than V1's declared length.
  const kept = []
  pieces.forEach((p, i) => {
    const from = Math.min(Math.max(offsets[i], 0), span)
    const to = Math.min(Math.max(offsets[i + 1], 0), span)

    if (p.kind !== 'main') {
      // A hold is duplicate frames the render froze at the sequence's outer
      // edges, so the whole PIECE goes. Dropping the piece rather than trimming
      // V2's in/out is what makes hold removal survive a reorder: the frozen
      // frames sit at the file's edges, but the shots they were attached to
      // needn't end up there.
      dropped.holds++
      dropped.holdSec += to - from
      return
    }
    if (isDuplicate[p.clipIndex]) {
      dropped.duplicates++
      dropped.duplicateSec += to - from
      return
    }
    if (to - from <= CUT_EPSILON) {
      // Dropped, NOT merged into the neighbour the way batchCutAgainstV1 merges
      // a colliding cut. There, dropping a cut just leaves footage where it
      // already was; here the neighbouring shot would inherit a range that
      // belongs to a different shot.
      if (offsets[i] >= span - CUT_EPSILON) {
        dropped.pastEnd++
        dropped.pastEndSec += p.sec
      } else {
        dropped.subFrame++
      }
      return
    }

    kept.push({ v1Index: p.clipIndex, from, to, truncatedSec: Math.max(0, offsets[i + 1] - span) })
  })

  // `nothing.dropped` is the object just filled in above, so this reports what
  // was found and still returns V2 untouched, by reference.
  if (kept.length === 0) return { ...nothing, overflow, leftoverSec }

  const ordered = sourceChronologicalOrder(kept, v1Clips)
  const reordered = ordered.some((r, i) => r.v1Index !== kept[i].v1Index)
  const welded = weldAdjacentRanges(ordered, v1Clips)

  // The last range is deliberately NOT extended to the end of V2's window, the
  // one thing batchCutAgainstV1 always does to its last segment. In source order
  // the final segment is rarely the file's final range, so extending it would
  // splice some other shot's footage onto it — and `leftoverSec`, whatever an
  // external tool added past V1's total, is footage V1 never had a decision
  // about, so it is left out rather than glued onto whichever shot happens to
  // end there. Reporting it is the caller's job.
  // One id shared by every range this reconstruction emitted, so the lane can
  // draw them as the single clip they are (clipMath.fuseGroups) and a 1+ V2
  // Render writes them as one file. Provenance only — whether a run still LOOKS
  // like one clip is re-derived from the clips themselves on every read, so this
  // never has to be maintained. Minted only when there is more than one range:
  // a reconstruction that came back as one clip has no seam to hide, and marking
  // it would put a `fuseId` on a clip that later spreads into unrelated ones.
  const fuseId = welded.length > 1 ? crypto.randomUUID() : null
  const segments = [
    ...welded.map((r, i) => ({
      ...v2c,
      id: crypto.randomUUID(),
      inSec: v2c.inSec + r.from,
      outSec: v2c.inSec + r.to,
      reversed: r.reversed,
      speed: restoreSpeed(r.speed),
      crop: null,
      cropKeyframes: [],
      headHoldSec: 0,
      tailHoldSec: 0,
      roundHoldSec: 0,
      dirty: true,
      fuseId,
      displayName: `Reconstructed${String(i + 1).padStart(2, '0')}`,
      // A welded range can span several V1 clips; it is stamped with the FIRST,
      // matching how a fused group takes its name from its first member.
      ...v1Provenance(v1Clips[r.v1Indexes[0]]),
    })),
    ...v2Clips.slice(1),
  ]

  // Footage accounting, per source file and in SOURCE seconds (the V1 clip's own
  // in/out) — the only base where "how much of the file V1 never used" means
  // anything, and a different unit from the ranges above.
  const sources = []
  const bySource = new Map()
  for (const r of kept) {
    const c = v1Clips[r.v1Index]
    const key = sourceKey(c)
    let s = bySource.get(key)
    if (!s) {
      const durSec = Number(c.sourceDurationSec)
      s = {
        sourceName: c.sourceName,
        sourceDir: c.sourceDir || 'input',
        sourceDurationSec: Number.isFinite(durSec) && durSec > 0 ? durSec : null,
        shots: 0,
        speedShots: 0,
        croppedShots: 0,
        windows: [],
      }
      bySource.set(key, s)
      sources.push(s)
    }
    s.shots++
    if (clipSpeed(c) !== 1) s.speedShots++
    // A FIT crop is not footage loss — the whole frame is there, just smaller —
    // so it must not be counted here: croppedShots is what tells the user how
    // many shots come back missing picture, and inflating it would report a loss
    // that did not happen.
    if (c.crop && !isFitCrop(c.crop)) s.croppedShots++
    s.windows.push([Math.min(c.inSec, c.outSec), Math.max(c.inSec, c.outSec)])
  }
  for (const s of sources) {
    const sumSec = s.windows.reduce((total, w) => total + (w[1] - w[0]), 0)
    s.usedSec = unionSec(s.windows)
    s.overlapSec = Math.max(0, sumSec - s.usedSec)
    s.unusedSec = s.sourceDurationSec === null ? null : Math.max(0, s.sourceDurationSec - s.usedSec)
    delete s.windows
  }

  // What un-stretching actually buys back, in SECONDS rather than a bare list of
  // multipliers — the number the user needs to see that the timing really came
  // home. A range on V2 already IS the stretched length, so multiplying it by the
  // V1 clip's own speed gives the length it renders back to under the reciprocal;
  // the difference is the padding the V1 render inserted as repeated frames and
  // this reconstruction drops again.
  //
  // Summed over `welded`, not `kept`: only equal-speed ranges weld, so the totals
  // are identical either way, and the welded range is where the speed lives.
  let stretchedSec = 0
  let unstretchedSec = 0
  const restored = new Map()
  const unrestored = new Set()
  for (const r of welded) {
    if (r.speed === 1) continue
    const v2Speed = restoreSpeed(r.speed)
    if (v2Speed === 1) {
      unrestored.add(r.speed)
      continue
    }
    restored.set(r.speed, v2Speed)
    stretchedSec += r.to - r.from
    unstretchedSec += (r.to - r.from) * r.speed
  }

  return {
    segments,
    shots: welded.map(r => ({
      v1Indexes: r.v1Indexes,
      from: r.from,
      to: r.to,
      reversed: r.reversed,
      v1Speed: r.speed,
      speed: restoreSpeed(r.speed),
      truncatedSec: r.truncatedSec,
    })),
    welds: kept.length - welded.length,
    reordered,
    sources,
    restoredSpeeds: [...restored].map(([from, to]) => ({ from, to })).sort((a, b) => a.from - b.from),
    restoredSec: { stretchedSec, unstretchedSec },
    unrestoredSpeeds: [...unrestored].sort((a, b) => a - b),
    dropped,
    overflow,
    leftoverSec,
  }
}

// "Batch Analyze" is the plain-cut sibling of Analyze, for a whole sequence
// handled as ONE file: V1 Render (or V2 Render in its `1` mode) joins the cut
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
//
// `clipIndex` is which V1 clip the piece came from ('head' is always clip 0,
// 'tail'/'round' always the last). Reconstruct needs it to read that clip's own
// reversed flag and source window back off a piece; Batch Analyze ignores it.
// An index rather than the clip itself, so a piece stays a plain description of
// the render's shape that nothing can mutate V1 through.
export function sequencePieces(v1Clips) {
  // Every `sec` below is a whole number of frames on the render's own OUTPUT
  // grid, because a boundary in a rendered file is a running sum of per-clip
  // integer frame counts (clipRenderFrames mirrors both of the render's
  // quantizations). Rounding a cumulative total of real durations instead is off
  // by up to half a frame per clip at any speed whose stretch is not a whole
  // number of frames — 0.75x and 0.4x, both of them presets.
  //
  // Tail and round-up are separate pieces even though the render lays them as
  // one block, because Batch Analyze names segments by piece kind and a hidden
  // round-up inside "the tail hold" would misname them.
  const targetFps = sequenceTargetFps(v1Clips)
  const pieces = []
  v1Clips.forEach((c, i) => {
    const f = clipRenderFrames(c, { isFirst: i === 0, isLast: i === v1Clips.length - 1, targetFps })
    if (f.headFrames > 0) pieces.push({ kind: 'head', sec: f.headFrames / targetFps, clipIndex: i })
    if (f.mainFrames > 0) pieces.push({ kind: 'main', sec: f.mainFrames / targetFps, clipIndex: i })
    if (f.tailFrames > 0) pieces.push({ kind: 'tail', sec: f.tailFrames / targetFps, clipIndex: i })
    if (f.raiseFrames > 0) pieces.push({ kind: 'round', sec: f.raiseFrames / targetFps, clipIndex: i })
  })
  return pieces
}

const CUT_EPSILON = 0.001

// Where each piece BEGINS and ENDS in the file the sequence rendered to, in
// seconds from the head of V2's own window: P pieces give P+1 offsets, with
// offsets[0] === 0 and offsets[P] the sequence's total.
//
// Snapped to V2's own frame grid — V2's fps, not V1's, since these are source
// times on V2's file — because a boundary is a frame boundary: rounding here
// means the pieces tile V2's window exactly instead of leaving sub-frame
// slivers for ffmpeg's `trim` to resolve one way at the end of one piece and
// the other way at the start of the next.
//
// Deliberately UNCLAMPED. An offset past the end of V2's window is returned as
// it is, because the two consumers want opposite things from that case: V2
// Batch Analyzer drops the cut and lets the piece merge into the one before it
// (a cut discards nothing), while Reconstruct clamps and drops the range (a
// dropped piece must take exactly its own footage with it). Shared so those two
// can never disagree about which FRAME a boundary lands on, while each keeps
// its own rule for what to do there.
export function pieceOffsetsOnV2(pieces, v2Clip) {
  const span = v2Clip.outSec - v2Clip.inSec
  const v1Sec = pieces.reduce((sum, p) => sum + p.sec, 0)
  const fps = v2Clip.fps > 0 ? v2Clip.fps : 0
  const snap = s => (fps ? Math.round(s * fps) / fps : s)

  const offsets = [0]
  let elapsed = 0
  for (const p of pieces) {
    elapsed += p.sec
    offsets.push(snap(elapsed))
  }

  return {
    offsets,
    span,
    v1Sec,
    overflow: Math.max(0, v1Sec - span),
    leftoverSec: Math.max(0, span - v1Sec),
  }
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

// Which name a segment gets, by the kind of V1 piece that starts it.
const PIECE_NAMES = { main: 'Shot', head: 'Head', tail: 'Tail', round: 'Round' }

// V1 PROVENANCE stamped onto every V2 segment the three tools emit — which V1
// clip this cut was made against. It exists for one reason: a 1+ V2 Render with
// **V1 name** ticked has to name each file after the V1 clip under it, and a V2
// segment otherwise knows nothing about V1 (its sourceName is the round-tripped
// V2 file, and every path here overwrites displayName with Analyzed01/Shot01/
// Reconstructed01). Positional index is NOT a usable substitute: analyzeAgainstV1
// filters out clips past V2's end, batchCutAgainstV1 merges colliding cuts and
// appends untouched extra V2 clips, and Reconstruct welds several V1 clips into
// one range — so segment i is not V1 clip i in any of them.
//
// Both fields, because they answer different questions. `v1Id` is the live link:
// rename or reorder V1 afterwards and the render still picks up the current name.
// `v1Name` is the snapshot for when that lookup fails — the V1 clip was deleted,
// or the project was saved and reopened against a rebuilt timeline. Resolution
// order lives in App.shotStemsFor.
function v1Provenance(clip) {
  if (!clip) return { v1Id: null, v1Name: null }
  return { v1Id: clip.id ?? null, v1Name: clip.displayName || clip.sourceName || null }
}

// Returns { segments, kinds, overflow, leftoverSec }:
//   segments    — V2's FIRST clip replaced by one clip per V1 PIECE, in track
//                 order; any further V2 clips are left exactly as they were
//                 (same convention as reconstructFromV1 — V2 Render in `1` mode
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
  // The boundary arithmetic is shared with Reconstruct (see pieceOffsetsOnV2);
  // what follows — merging a colliding cut and running the last segment to the
  // end of V2's window — is this function's own, and is where the two differ.
  const { offsets, span, overflow, leftoverSec } = pieceOffsetsOnV2(pieces, v2c)

  // Segment starts, each labelled with the kind of V1 piece that begins there.
  // Only cuts strictly inside V2's window and strictly after the previous
  // surviving one are kept, and both halves of that exist to drop an EMPTY
  // segment rather than a real one: a cut past the end has no footage to cut (it
  // is counted in `overflow` instead), and a cut landing on the previous
  // boundary — two pieces whose boundary snaps to the same frame of V2 — has no
  // footage between them. A dropped cut merges its piece into the one before it.
  // `clipIndex` rides along from the piece so the segment can be stamped with
  // the V1 clip it came from — a merged cut inherits the surviving edge's clip,
  // which is the same clip whose footage the merged segment actually shows.
  const edges = [{ at: 0, kind: pieces[0].kind, clipIndex: pieces[0].clipIndex }]
  for (let i = 0; i < pieces.length - 1; i++) {
    const at = offsets[i + 1]
    if (at > edges[edges.length - 1].at + CUT_EPSILON && at < span - CUT_EPSILON) {
      edges.push({ at, kind: pieces[i + 1].kind, clipIndex: pieces[i + 1].clipIndex })
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
      // Explicitly cleared, not inherited: `...v2c` above would carry a `fuseId`
      // straight off a reconstructed clip, and these segments are the OPPOSITE of
      // fused — their whole point is that each cut is its own clip, sitting under
      // the V1 boundary it came from. Drawing them as one box would also close
      // the 2px gaps this lane needs to stay aligned with V1's.
      fuseId: null,
      displayName: `${PIECE_NAMES[edge.kind]}${String(counts[edge.kind]).padStart(2, '0')}`,
      // Overwrites any v1Id/v1Name `...v2c` carried in from an earlier analyze —
      // this cut's provenance is this run's V1 clip, not the previous run's.
      ...v1Provenance(v1Clips[edge.clipIndex]),
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
      ...v1Provenance(c),
    }
  }).filter(seg => seg.outSec > seg.inSec) // V1's clip lies entirely beyond V2's footage — nothing to cut

  return { segments, overflow }
}
