// Pixels of flex `gap` between clips on a lane. ZERO on purpose, and load-bearing:
// a gap consumes width but represents NO time, so any non-zero value makes a
// lane's seconds-to-pixels scale a function of that lane's own clip count. V1,
// V2 and the ruler do not share a clip count, so at 2px they could never agree —
// a 6-clip V1 drew 10px (4 frames at 60px/s and 24fps) longer than its own
// duration while a 1-clip V2 drew exactly its duration, which made a V2 file ONE
// FRAME LONGER than V1 end 7.5px SHORT of it. Clips are told apart by the 2px
// palette border each one already carries, which meet as a 4px seam.
export const GAP_PX = 0
export const ROUND_EPSILON = 0.0005

export function clipSpeed(clip) {
  return clip.speed && clip.speed > 0 ? clip.speed : 1
}

// Duration the clip's main body occupies on the TIMELINE — the source
// window stretched by any slow-down (0.5 speed doubles the played length).
export function clipMainSec(clip) {
  return (clip.outSec - clip.inSec) / clipSpeed(clip)
}

export function clipTotalSec(clip) {
  return (clip.headHoldSec || 0) + clipMainSec(clip) + (clip.tailHoldSec || 0) + (clip.roundHoldSec || 0)
}

// ─── The render's own frame arithmetic, mirrored ─────────────────────────────
//
// `ffmpeg_utils.clip_timing` is THE source of truth for how long a clip occupies
// a render, and it counts in whole FRAMES: the body is
// ceil(outSec*fps) - ceil(inSec*fps) frames, and each hold is round(H*fps)
// frames. clipMainSec's raw `outSec - inSec` is the right answer for laying the
// timeline out on screen and the WRONG one for predicting which frame the render
// put a cut on.
//
// The difference is not cosmetic. It is up to a frame per clip, it is multiplied
// by 1/speed — a 0.2x shot can be off by five frames on its own — and it
// ACCUMULATES down the sequence, so a reconstruction's later boundaries land
// further out than its earlier ones. Measured at 1-4 frames on ordinary
// sequences with edge-dragged (i.e. not frame-aligned) trims.
//
// This duplicates Python arithmetic, which clip_timing's own docstring warns
// against. It is unavoidable here: these cuts are decided in the browser with no
// render in flight to ask. The two must therefore be changed together — see
// gotchas.md.
export function clipFps(clip) {
  return clip.fps > 0 ? clip.fps : 30
}

// Python's round(), which is the one the render uses: a tie goes to the EVEN
// integer, not upward. Math.round(72.5) is 73 where Python's round(72.5) is 72,
// and `expected_sec * fps` lands exactly on .5 constantly — an odd source-frame
// count at 0.4x (×2.5) or 0.2x (×5) does it every time, and both are presets. So
// Math.round in this block is not a pedantic difference; it is a one-frame error
// on ordinary input that then accumulates down the sequence. Every rounding in
// the mirror goes through here.
export function roundFrames(x) {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

// A hold's real length: it contributes round(H*fps) whole frames, never its
// requested duration raw.
export function holdFrames(sec, fps) {
  return sec > 0 ? roundFrames(sec * fps) : 0
}

// Whole frames the trim window selects, exactly as the render counts them —
// including the render's clamp of outSec to the video stream's last frame, since
// a window reaching past that frame selects nothing, and its floor of one frame.
export function clipMainFrames(clip) {
  const fps = clipFps(clip)
  const eps = 1e-6
  const videoDur = clip.sourceDurationSec > 0 ? clip.sourceDurationSec : clip.outSec
  const lastFrame = Math.max(roundFrames(videoDur * fps) - 1, 0)
  const firstSel = Math.max(Math.ceil(clip.inSec * fps - eps), 0)
  const lastSelExcl = Math.min(Math.ceil(clip.outSec * fps - eps), lastFrame + 1)
  return Math.max(lastSelExcl - firstSel, 1)
}

// clipMainSec's frame-exact counterpart: what the RENDER gives the main body,
// slow-down included. Use this, not clipMainSec, for anything that has to line
// up with rendered footage.
export function clipRenderedMainSec(clip) {
  return (clipMainFrames(clip) / clipFps(clip)) / clipSpeed(clip)
}

// There is deliberately no per-clip "how long does this clip render to" helper
// that takes a clip ALONE. Two existed — one raw (clipBaseSec) and one
// frame-exact but position-blind — and both were wrong, for two different
// reasons: raw seconds miss the frame quantization, and a clip's rendered length
// depends on WHERE it sits (the render zeroes any hold that isn't at the
// sequence's outer edge, and quantizes onto the sequence's output grid, not the
// clip's own). Anything asking that question must go through clipRenderFrames
// with isFirst/isLast/targetFps. See the Raise entry in gotchas.md.

// The render's ONE output frame rate for a whole sequence: the max fps across
// its inputs (app.py's target_fps). Every boundary and every duration in a
// rendered file lives on this grid, never on an individual clip's.
export function sequenceTargetFps(clips) {
  return clips.reduce((m, c) => Math.max(m, clipFps(c)), 0) || 30
}

// One clip's frame budget inside a rendered sequence, split the way the render
// splits it, every count on the sequence's OUTPUT grid.
//
// Two quantizations happen here and the order matters: the holds are rounded on
// the CLIP's own fps (that is the grid clip_timing rounds them on), and then the
// clip's whole budget is rounded onto the output grid (n_norm_frames,
// ffmpeg_utils). So the pieces are carved OUT of totalFrames rather than each
// being rounded independently — that way they always sum to exactly what the
// render gives the clip, even when the two grids differ.
export function clipRenderFrames(clip, { isFirst, isLast, targetFps }) {
  const fps = clipFps(clip)
  // app.py zeroes any hold that is not at the sequence's outer edge, and sums
  // the tail hold with the Raise round-up BEFORE quantizing them.
  const leadFrames = isFirst ? holdFrames(clip.headHoldSec || 0, fps) : 0
  const tailHold = isLast ? (clip.tailHoldSec || 0) : 0
  const raiseHold = isLast ? (clip.roundHoldSec || 0) : 0
  const trailFrames = holdFrames(tailHold + raiseHold, fps)

  const expectedSec = (leadFrames + trailFrames) / fps + clipRenderedMainSec(clip)
  const totalFrames = Math.max(roundFrames(expectedSec * targetFps), 1)
  const headFrames = roundFrames((leadFrames / fps) * targetFps)
  const trailTarget = roundFrames((trailFrames / fps) * targetFps)
  // The render lays ONE trail block — it has no tail/Raise boundary — so the
  // split between them is put back on a frame boundary here instead of each
  // half being rounded on its own, which can miss the render's single rounding.
  const tailFrames = Math.min(roundFrames((holdFrames(tailHold, fps) / fps) * targetFps), trailTarget)
  return {
    headFrames,
    mainFrames: totalFrames - headFrames - trailTarget,
    tailFrames,
    raiseFrames: trailTarget - tailFrames,
    totalFrames,
  }
}

// Total frames the sequence renders to. A sum of per-clip integers, which is
// what makes a rendered file's length differ from the rounded sum of its clips'
// real durations — the distinction the whole frame-arithmetic block exists for.
export function sequenceRenderFrames(clips, targetFps = sequenceTargetFps(clips)) {
  return clips.reduce((sum, c, i) => sum + clipRenderFrames(c, {
    isFirst: i === 0,
    isLast: i === clips.length - 1,
    targetFps,
  }).totalFrames, 0)
}

// Everything Raise needs: the sequence's rendered length with any existing
// round-up stripped, and the hold that lands the RENDER exactly on the next
// whole second. `amountSec` is 0 when the render is already whole.
export function sequenceRaise(clips) {
  if (clips.length === 0) return { baseSec: 0, amountSec: 0, wholeSec: 0, exact: true }
  const targetFps = sequenceTargetFps(clips)
  // Measured with every round-up removed: Raise replaces its own previous
  // answer rather than stacking a second hold on top of it.
  const base = clips.map(c => (c.roundHoldSec ? { ...c, roundHoldSec: 0 } : c))
  const baseFrames = sequenceRenderFrames(base, targetFps)
  const baseSec = baseFrames / targetFps
  const wholeSec = Math.ceil(baseSec - ROUND_EPSILON)
  const wantFrames = roundFrames(wholeSec * targetFps)
  if (wantFrames <= baseFrames) return { baseSec, amountSec: 0, wholeSec: baseSec, exact: true }

  // The hold is stored in SECONDS, but the render rounds it on the LAST CLIP's
  // own fps and only then re-rounds that clip's budget onto the output grid. So
  // the reachable sequence lengths are not "every output frame": they step by
  // targetFps/lastFps output frames at a time. Converting the shortfall to
  // seconds in one division therefore lands a frame off, which is what the old
  // raw-seconds Raise did.
  //
  // Instead: walk the hold up one LAST-CLIP frame at a time and take the first
  // one whose whole render reaches the whole second. The render length is
  // monotonic in the hold, so the first hit is also the smallest — Raise must add
  // as little as it can. The scan is bounded by one second of hold because a
  // round-up is by definition under a second, and each step is pure arithmetic.
  const lastFps = clipFps(base[base.length - 1])
  const probe = h => sequenceRenderFrames(
    base.map((c, i) => (i === base.length - 1 ? { ...c, roundHoldSec: h / lastFps } : c)),
    targetFps,
  )
  const maxHoldFrames = Math.ceil(lastFps) + 2
  for (let h = 1; h <= maxHoldFrames; h++) {
    const total = probe(h)
    if (total >= wantFrames) {
      // total > wantFrames means the whole second sits BETWEEN two reachable
      // lengths — only possible when the last clip is slower than the output
      // rate, since then one hold frame is several output frames and no hold
      // expresses the gap. Overshooting by under a frame of output is the honest
      // answer (the sequence is at least the whole second, never short of it),
      // and `exact` says so rather than the UI promising a length it won't hit.
      return { baseSec, amountSec: h / lastFps, wholeSec, exact: total === wantFrames }
    }
  }
  return { baseSec, amountSec: maxHoldFrames / lastFps, wholeSec, exact: false }
}

// How much SOURCE footage a trim to [newIn, newOut] removes from this clip.
// SIGNED on purpose: positive means footage left the sequence, negative means a
// widened window brought footage back. The sign is what lets a caller sum the
// dozens of pointermove updates in one edge drag and learn the NET result — a
// drag pulled inward and then back out past its start cancels to ~0, so nothing
// has to snapshot the window at gesture start.
//
// Source seconds, NOT timeline seconds: speed stretches what a window occupies
// on the timeline but changes no frame's existence, so clipMainSec's /speed
// would report a 0.5-speed clip as losing twice what it lost. Never interchange
// the two here.
export function trimLossSec(clip, newIn, newOut) {
  return (newIn - clip.inSec) + (clip.outSec - newOut)
}

// Deleting a clip drops its whole source window. Slight over-report when an
// identical duplicate clip elsewhere in the sequence still covers the same
// range; correcting that needs a union across every clip on the track on every
// edit, which is not worth it for an advisory number (see the warning's plan).
export function deleteLossSec(clip) {
  return Math.max(0, clip.outSec - clip.inSec)
}

export function clipHeadPx(clip, pps) {
  return (clip.headHoldSec || 0) * pps
}

export function clipMainPx(clip, pps) {
  return clipMainSec(clip) * pps
}

export function clipTailPx(clip, pps) {
  return (clip.tailHoldSec || 0) * pps
}

export function clipRoundPx(clip, pps) {
  return (clip.roundHoldSec || 0) * pps
}

export function clipTotalPx(clip, pps) {
  return clipTotalSec(clip) * pps
}

// The width TimelineClip actually RENDERS for a clip. A clip shorter than
// MIN_CLIP_PX/pps is drawn at that floor so it stays visible and clickable,
// which makes the V1 lane wider than duration*pps — so anything that has to
// sit under V1 has to honor the same floor or it drifts right of the picture.
export const MIN_CLIP_PX = 24

export function clipRenderedPx(clip, pps) {
  return Math.max(clipTotalPx(clip, pps), MIN_CLIP_PX)
}

// Map a timeline position to an X offset inside a lane laid out exactly like
// V1's: per-clip RENDERED widths separated by `gapPx` (the lane's flex `gap`,
// which is 0 — see GAP_PX). This is the one definition of "under the video on V1" — the
// A1 bed measures every edge with it, so the bed's boundaries land on the same
// pixel as the V1 frame playing at that instant. Head/tail holds need no
// special case: they're already inside clipTotalSec, so the span a hold
// occupies on V1 is the same span it occupies here.
//
// Deliberately separate from timelinePosToPx, which drives the playhead and
// ignores the MIN_CLIP_PX floor. Don't merge them without re-verifying the
// playhead — it's calibrated against the current behavior.
export function sequencePosToPx(clips, pos, pps, gapPx = GAP_PX) {
  let px = 0
  let remaining = pos
  for (let i = 0; i < clips.length; i++) {
    const dur = clipTotalSec(clips[i])
    const width = clipRenderedPx(clips[i], pps)
    if (remaining <= dur) {
      // Scale within the clip by its rendered width, not by pps: a floored
      // clip's interior has to spread across the box actually drawn.
      return px + (dur > 0 ? (remaining / dur) * width : 0)
    }
    remaining -= dur
    px += width + gapPx
  }
  // Ran past the end — the lane's full width, minus the trailing gap that the
  // loop added after the last clip.
  return px > 0 ? px - gapPx : 0
}

// Where V1's PICTURE starts on the timeline: the first clip's head hold, which
// freezes a frame before the clip proper begins. The A1 bed is delayed by this
// so it starts on the first real frame — change or remove the hold and the bed
// moves with it. Mirrors bed_offset_sec in build_timeline_filter (which
// frame-quantizes it; a few ms of UI/render difference is not visible at 60px/s).
// Only clip 0 may carry a head hold (sanitizeHoldPlacement enforces it).
export function sequenceVideoStartSec(clips) {
  return clips.length > 0 ? (clips[0].headHoldSec || 0) : 0
}

// Where a clip starts on the timeline, by id. The cumulative sum that clicking a
// clip already seeks to — shared so "the playhead follows the clip" means the
// same position whichever surface moved it (toolbar, ⌥arrow, drag, EDL row).
// 0 for an id that isn't in the array, which is also the right answer for an
// empty sequence.
export function clipStartSec(clips, id) {
  let pos = 0
  for (const c of clips || []) {
    if (c.id === id) return pos
    pos += clipTotalSec(c)
  }
  return 0
}

// V1/V2 have no per-clip position — the render concatenates clips end to end —
// so MOVING a clip means changing its index and nothing else. This is that move,
// and the single definition of it: the toolbar buttons, ⌥←/⌥→, a drag-and-drop
// and the EDL's arrows all route through here, so no two of them can disagree
// about where a clip lands.
//
// Returns the SAME array reference for a no-op or out-of-range move. That is
// load-bearing, not a micro-optimization: reduceEdit bails on
// `next === present[key]` (useUndoableTracks.js), so a move that changes nothing
// costs no undo step — and callers compare by reference to skip re-marking every
// clip dirty.
export function moveClip(clips, from, to) {
  if (!Array.isArray(clips)) return clips
  if (!Number.isInteger(from) || from < 0 || from >= clips.length) return clips
  const dest = Math.max(0, Math.min(to, clips.length - 1))
  if (dest === from) return clips
  const next = [...clips]
  const [moved] = next.splice(from, 1)
  next.splice(dest, 0, moved)
  return next
}

// The index a drop belongs at, from the clip it was dropped ON plus which half of
// that clip the cursor was over. The `from < to` correction accounts for the hole
// the dragged clip leaves when it's removed: without it, dropping on the right
// half of a clip to the right lands one slot short of the boundary the user was
// pointing at — which reads as "it didn't go where I put it".
//
// Pairs with the insertion line the drag draws: the line marks a BOUNDARY (before
// or after clip N), this converts that boundary into the destination index, so
// what is drawn is where the clip lands.
export function dropTargetIndex(from, overIndex, side) {
  let to = side === 'after' ? overIndex + 1 : overIndex
  if (from < to) to -= 1
  return to
}

// Where each V1 clip starts and ends in that same lane coordinate space, plus
// its head/tail hold spans. What the A1 bed draws its clip-boundary dividers
// and hold markers from, so the link to V1 is visible and not just implied.
export function sequenceClipBounds(clips, pps, gapPx = GAP_PX) {
  const bounds = []
  let px = 0
  for (const clip of clips) {
    const width = clipRenderedPx(clip, pps)
    const dur = clipTotalSec(clip)
    // Holds are drawn at their true pps width by TimelineClip (only the OUTER
    // box is floored), so scale them the same way the interior is scaled.
    const scale = dur > 0 ? width / (dur * pps) : 1
    bounds.push({
      id: clip.id,
      left: px,
      width,
      headPx: (clip.headHoldSec || 0) * pps * scale,
      tailPx: ((clip.tailHoldSec || 0) + (clip.roundHoldSec || 0)) * pps * scale,
    })
    px += width + gapPx
  }
  return bounds
}

// Pixel X of the playhead for a given timeline position, in the timeline's
// own coordinate system (gutter + per-clip widths + inter-clip gaps). Pure
// so the playback engine can drive the playhead imperatively every frame
// without a React re-render, and so it's unit-testable. Returns null when
// there are no clips. `layout` carries the Timeline's px constants.
export function timelinePosToPx(clips, pos, layout) {
  if (clips.length === 0) return null
  const { pps, gutterPx = 0, trackPad = 0, gapPx = 0 } = layout
  let remaining = pos
  let px = gutterPx + trackPad
  for (let i = 0; i < clips.length; i++) {
    const dur = clipTotalSec(clips[i])
    if (remaining <= dur) return px + remaining * pps
    remaining -= dur
    px += dur * pps + gapPx
  }
  return px
}

// How much a duration misses landing on the next whole second. Returns 0 if
// already whole (within a small epsilon to tolerate float rounding).
export function roundUpAmount(totalSec) {
  const nextWhole = Math.ceil(totalSec - ROUND_EPSILON)
  const amount = nextWhole - totalSec
  return amount > ROUND_EPSILON && amount < 1 - ROUND_EPSILON ? amount : 0
}

// Decompose a clip list into an ordered list of playback SEGMENTS — the
// single source of truth the timeline playback engine drives. Each clip
// yields up to three segments, mirroring resolveTimelinePos's zones exactly
// so the two can't drift:
//   • head-hold  → mode 'freeze' (frozen on the first visual frame)
//   • main body  → mode 'native' when forward AND normal-speed (the browser
//                  can decode-play it itself), else 'scrub' (reversed or
//                  slow-mo must be seeked frame-by-frame)
//   • tail+round → mode 'freeze' (frozen on the last visual frame; the two
//                  holds are merged — both freeze the same frame)
// Segment fields: { clip, mode, timelineStart, timelineEnd, sourceStart,
// rate, frozenSourceTime }. `sourceStart` is the source time at
// timelineStart for a native/scrub body; `rate` is the play speed, below 1 for a
// slow-down and above it for a Reconstruct un-stretch (which scrubs the same way,
// just consuming source faster than the playhead moves).
export function buildSegments(clips) {
  const segments = []
  let elapsed = 0
  for (const c of clips) {
    const headHold = c.headHoldSec || 0
    const mainDur = clipMainSec(c)
    const tailHold = (c.tailHoldSec || 0) + (c.roundHoldSec || 0)
    const speed = clipSpeed(c)

    if (headHold > 0) {
      segments.push({
        clip: c, mode: 'freeze',
        timelineStart: elapsed, timelineEnd: elapsed + headHold,
        frozenSourceTime: c.reversed ? c.outSec : c.inSec,
      })
      elapsed += headHold
    }

    if (mainDur > 0) {
      const native = !c.reversed && speed === 1
      segments.push({
        clip: c, mode: native ? 'native' : 'scrub',
        timelineStart: elapsed, timelineEnd: elapsed + mainDur,
        sourceStart: c.reversed ? c.outSec : c.inSec,
        rate: speed,
      })
      elapsed += mainDur
    }

    if (tailHold > 0) {
      segments.push({
        clip: c, mode: 'freeze',
        timelineStart: elapsed, timelineEnd: elapsed + tailHold,
        frozenSourceTime: c.reversed ? c.inSec : c.outSec,
      })
      elapsed += tailHold
    }
  }
  return segments
}

// Which segment contains `pos` (the last segment whose span covers it), and
// the clamped position within the full segment list. Returns null for an
// empty list. Used by the engine to pick a play mode at any timeline pos.
export function segmentAt(segments, pos) {
  if (segments.length === 0) return null
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (pos < s.timelineEnd || i === segments.length - 1) {
      return { index: i, segment: s }
    }
  }
  return { index: segments.length - 1, segment: segments[segments.length - 1] }
}

// Fixed literal Tailwind class names (not template-interpolated) so the
// build's content scanner can find and generate them.
const CLIP_PALETTE = [
  { grad: 'from-sky-700 to-sky-900', border: 'border-sky-500', ring: 'ring-sky-500' },
  { grad: 'from-emerald-700 to-emerald-900', border: 'border-emerald-500', ring: 'ring-emerald-500' },
  { grad: 'from-violet-700 to-violet-900', border: 'border-violet-500', ring: 'ring-violet-500' },
  { grad: 'from-rose-700 to-rose-900', border: 'border-rose-500', ring: 'ring-rose-500' },
  { grad: 'from-orange-700 to-orange-900', border: 'border-orange-500', ring: 'ring-orange-500' },
  { grad: 'from-teal-700 to-teal-900', border: 'border-teal-500', ring: 'ring-teal-500' },
  { grad: 'from-cyan-700 to-cyan-900', border: 'border-cyan-500', ring: 'ring-cyan-500' },
  { grad: 'from-lime-700 to-lime-900', border: 'border-lime-500', ring: 'ring-lime-500' },
]

// Enforces the invariant that head-hold only ever exists on the first clip
// of the sequence, tail-hold and round-hold only on the last — since those
// segments represent freezing a frame at the very start/end of the whole
// program, not an arbitrary boundary between two clips. Call this after any
// operation that can change clip order or composition (reorder, add,
// split) so a hold segment never ends up stranded in the middle.
export function sanitizeHoldPlacement(clips) {
  if (clips.length === 0) return clips
  return clips.map((c, i) => {
    const isFirst = i === 0
    const isLast = i === clips.length - 1
    const next = { ...c }
    let changed = false
    if (!isFirst && (c.headHoldSec || 0) > 0) { next.headHoldSec = 0; changed = true }
    if (!isLast && (c.tailHoldSec || 0) > 0) { next.tailHoldSec = 0; changed = true }
    if (!isLast && (c.roundHoldSec || 0) > 0) { next.roundHoldSec = 0; changed = true }
    if (changed) next.dirty = true
    return next
  })
}

// Which runs of clips are ONE clip as far as the user is concerned.
//
// V2 Reconstruct has to emit several clips for one piece of footage — putting
// V1's moves back means the ranges it keeps are out of order in V2's file, and a
// clip holds exactly one `inSec`/`outSec` pair, so two discontiguous ranges
// cannot be one clip in the data. They ARE one clip in the render: V2 Render's
// `1` mode posts the whole lane as a single payload and the server concatenates
// it in array order into one file. So the multiplicity is an artifact of the data
// model, and this is where it gets hidden again: members of a group draw as one
// continuous box, count as one file in a `1+` series, and delete together.
//
// `fuseId` is PROVENANCE — "these came out of one reconstruction" — and nothing
// else. Whether a run actually draws fused is decided HERE, at read time, from
// the clips as they currently are:
//
//   - a run must be CONSECUTIVE. A move or a delete that separates members
//     dissolves the group with no bookkeeping, and an undo restores it. Deriving
//     runs from adjacency instead of trusting the flag is what keeps a stale
//     `fuseId` (inherited through a `{...clip}` spread) from drawing a fused box
//     across unrelated footage.
//   - a run must be at least 2 clips. One clip carrying a `fuseId` is just a
//     clip; there is no seam to hide.
//   - members of a RECONSTRUCTED run must AGREE on `reversed`, `speed` and
//     whether a crop is set. Reconstruct can legitimately produce a run that
//     doesn't (it never welds a reversed shot to a forward one), and so can
//     editing one member — both come out as two boxes, which is the truth about
//     what Reconstruct rebuilt.
//
// A MERGED run (`fuseMerged`, set only by mergeClips) is exempt from that last
// rule, which is the whole difference between the two producers. The user picked
// those clips knowing one was retimed or reversed, and the render already honours
// each member's own speed/direction/crop — a group is posted as a multi-clip
// payload, not as one clip. So agreement was never a render constraint; it was
// only ever about the single ◀ badge and single speed label, and `ClipGroups`
// answers that by labelling a mixed run "mixed" instead of quoting the lead's
// numbers. Refusing to merge a retimed clip would have been the display tail
// wagging the dog.
//
// Every clip is returned in exactly one group, in lane order, so a caller can
// map over groups instead of clips and lose nothing. Unfused clips come back as
// single-member groups with `fuseId: null` — which is why V1 (where no clip ever
// carries one) can be fed through this unchanged and get one group per clip.
export function fuseGroups(clips) {
  const groups = []
  let i = 0
  while (i < clips.length) {
    const c = clips[i]
    let end = i + 1
    if (c.fuseId) {
      // Read off the run's LEAD only: `fuseMerged` travels with `fuseId` through
      // every `{...clip}` spread, so one id is never half-merged.
      const strict = !c.fuseMerged
      while (
        end < clips.length
        && clips[end].fuseId === c.fuseId
        && (!strict || (
          !!clips[end].reversed === !!c.reversed
          && clipSpeed(clips[end]) === clipSpeed(c)
          && !!clips[end].crop === !!c.crop
        ))
      ) end++
    }
    // A lone member is not a group: fall through to the single-clip shape so the
    // caller never has to special-case a "fused" run of one.
    const fused = end - i >= 2
    groups.push({
      fuseId: fused ? c.fuseId : null,
      start: i,
      clips: fused ? clips.slice(i, end) : [c],
    })
    i = fused ? end : i + 1
  }
  return groups
}

// The whole group a clip belongs to, as a Set of ids — what "delete this clip"
// has to mean when the clip is one member of a box the user sees as single.
// A clip in no group comes back as just itself.
export function fuseGroupIds(clips, id) {
  const g = fuseGroups(clips).find(group => group.clips.some(c => c.id === id))
  return new Set(g ? g.clips.map(c => c.id) : [id])
}

// How close two ranges have to be to count as adjoining. Ranges that really do
// adjoin came out of one Split, so they meet EXACTLY (`partA.outSec` and
// `partB.inSec` are the same number); this tolerance only absorbs float drift
// from the seconds↔frames round trips a trim goes through. It is well under one
// frame at any rate this app handles (a frame at 240 fps is 4.2 ms), so it can
// never weld two ranges that have real footage missing between them.
const ADJOIN_EPSILON = 0.001

function sameCrop(a, b) {
  const x = a.crop, y = b.crop
  if (!x && !y) return true
  if (!x || !y) return false
  return x.key === y.key && x.w === y.w && x.h === y.h && x.x === y.x && x.y === y.y
}

// Do these two neighbours, in lane order, cover one unbroken stretch of source?
//
// Direction matters and is easy to get backwards. A forward clip plays
// `inSec → outSec`, so `a` ends where `b` starts: `a.outSec === b.inSec`. A
// reversed clip plays `outSec → inSec`, so the seam is at the OTHER end of each
// range — `a` ends at `a.inSec` and `b` begins at `b.outSec`. Comparing the same
// pair of fields for both would call a reversed split non-adjoining and quietly
// downgrade every reversed merge to a fused group.
function adjoins(a, b) {
  return Math.abs(a.reversed ? a.inSec - b.outSec : a.outSec - b.inSec) <= ADJOIN_EPSILON
}

// Can this run become literally one clip, rather than a group of clips drawn as
// one? A clip holds exactly one source range and one set of transforms, so the
// answer is only yes when nothing would have to be thrown away or averaged:
//
//   - one source file, and the ranges adjoin in play order (above);
//   - identical crop, and no `cropKeyframes` on any member — keyframes are timed
//     from the start of their own clip's main body, so a merge would move every
//     one of them. A group keeps the members intact and keeps its keyframes.
//   - no holds at an interior seam. `sanitizeHoldPlacement` means only the
//     lane's first and last clip can carry them, so a mid-lane run has none, but
//     a run that reaches an end does — those belong to the merged clip's outer
//     edges and survive. Anything at a seam would be time we'd have to delete.
//   - one speed and one direction. This is the only check here that a fused GROUP
//     doesn't also need: a group keeps every member's own retime, but a single
//     clip holds a single `speed`, so collapsing a 50% clip onto a 100% one would
//     silently retime half the footage. Mixed speeds are a perfectly good merge —
//     they just have to stay a group.
function canCollapse(members) {
  return members.every((c, i) => {
    if (i > 0) {
      const prev = members[i - 1]
      if (c.sourceName !== prev.sourceName) return false
      if ((c.sourceDir || 'input') !== (prev.sourceDir || 'input')) return false
      if (!!c.reversed !== !!prev.reversed) return false
      if (clipSpeed(c) !== clipSpeed(prev)) return false
      if (!sameCrop(c, prev)) return false
      if (!adjoins(prev, c)) return false
      if ((c.headHoldSec || 0) > 0) return false
      if ((prev.tailHoldSec || 0) > 0 || (prev.roundHoldSec || 0) > 0) return false
    }
    return !(c.cropKeyframes && c.cropKeyframes.length > 0)
  })
}

// Merge a selection of clips into one thing that renders as one file.
//
// Two outcomes, and which one you get is a property of the clips, not a mode the
// user picks. When the run is one continuous piece of one source file it
// COLLAPSES: the members are replaced by a single clip spanning the whole range,
// which is one clip everywhere afterwards — one trim, one speed, one entry in a
// `.nara`. When it isn't (two different files, or a gap), the members are stamped
// with a shared `fuseId` and become a FUSED GROUP: still two clips in the data,
// but `fuseGroups` draws them as one box and `renderShots` posts them as one file
// (which is the part the user actually asked for). Refusing the second case
// outright would mean Merge did nothing for the commonest reason to want it —
// gluing two different shots into one deliverable.
//
// Returns `{ error }` with a sentence fit to show, or `{ clips, selectId,
// collapsed }`. One function answers both "may I?" and "do it", so the button's
// tooltip can never disagree with what pressing it does.
export function mergeClips(clips, ids) {
  const idSet = new Set(ids)
  const indices = []
  clips.forEach((c, i) => { if (idSet.has(c.id)) indices.push(i) })
  if (indices.length !== idSet.size) return { error: 'those clips are no longer on this track' }
  if (indices.length < 2) return { error: 'select two clips to merge — click one, then Shift-click a neighbour' }
  const from = indices[0]
  const to = indices[indices.length - 1]
  // Derived from adjacency, exactly as fuseGroups does: a run with something
  // else between its ends is not a run, and merging it would either reorder the
  // lane behind the user's back or leave a group fuseGroups won't draw.
  if (to - from + 1 !== indices.length) {
    return { error: 'only side-by-side clips can merge — there are other clips between the ones you picked' }
  }
  const members = clips.slice(from, to + 1)
  const head = members[0]
  const tail = members[members.length - 1]
  // Adjacency is the ONLY requirement. A retime, a reverse or a crop on some
  // members but not others used to be refused here, because fuseGroups would
  // have split the run straight back apart and Merge would have looked like it
  // did nothing — that is now handled at the other end (`fuseMerged`) instead of
  // by telling the user to undo their retime first.

  if (canCollapse(members)) {
    // Keeps the first member's id, so the selection stays live, the lane colour
    // doesn't change (clip colour is hashed from the id) and any V2 overlay
    // pointing at this clip still matches. It reads as "these became one"
    // instead of "a clip vanished and a stranger appeared".
    const merged = {
      ...head,
      inSec: head.reversed ? tail.inSec : head.inSec,
      outSec: head.reversed ? head.outSec : tail.outSec,
      headHoldSec: head.headHoldSec || 0,
      tailHoldSec: tail.tailHoldSec || 0,
      roundHoldSec: tail.roundHoldSec || 0,
      // Provenance from before the merge is not provenance of the merged clip,
      // and a lone clip carrying a fuseId invites a stale box later.
      fuseId: null,
      fuseMerged: false,
      dirty: true,
    }
    return {
      clips: [...clips.slice(0, from), merged, ...clips.slice(to + 1)],
      selectId: merged.id,
      collapsed: true,
    }
  }

  // `fuseMerged` marks the run as user-made rather than reconstructed, which is
  // what exempts it from fuseGroups' agreement rule — so a run whose members were
  // retimed, reversed or cropped differently still draws and renders as one.
  const fuseId = crypto.randomUUID()
  return {
    clips: clips.map((c, i) => (i >= from && i <= to ? { ...c, fuseId, fuseMerged: true, dirty: true } : c)),
    selectId: head.id,
    collapsed: false,
  }
}

function stripExt(name) {
  return name.replace(/\.[^/.]+$/, '')
}

// The "root" a split name belongs to: strips file extension and any
// existing 2-digit split suffix, so splitting "Video01" again still groups
// with "Video02" etc. under the same root "Video" instead of drifting.
function splitRoot(name) {
  const noExt = stripExt(name)
  const m = noExt.match(/^(.*)(\d{2})$/)
  return m ? m[1] : noExt
}

// Next available "<Root><NN>" display name (e.g. Video -> Video01, then
// Video02, ...), scanning both the current clips and an `extra` list (used
// when computing two new names in the same split before either is
// committed to state yet) so the two halves never collide.
export function nextSplitName(baseName, clips, extra = []) {
  const root = splitRoot(baseName)
  let maxN = 0
  for (const c of [...clips, ...extra]) {
    const name = c.displayName || c.sourceName
    if (!name || splitRoot(name) !== root) continue
    const m = stripExt(name).match(/(\d{2})$/)
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10))
  }
  return root + String(maxN + 1).padStart(2, '0')
}

// The "family" a duplicate name belongs to: extension and any trailing
// single-letter suffix stripped, so duplicating "video_b" groups with
// "video_a" under the root "video" instead of starting a family called
// "video_b". Deliberately ONE letter and not `_([a-z]+)`: a multi-letter
// pattern would read the "_video" in "my_video" as a suffix and rename that
// clip to "my_a", destroying a name the user chose.
const DUP_SUFFIX_RE = /_([a-z])$/

function duplicateRoot(name) {
  return stripExt(name).replace(DUP_SUFFIX_RE, '')
}

// Names for a duplicate pair: the original becomes "<root>_a" and the copy
// "<root>_b", then "_c", "_d"… for further copies of the same family. An
// original that ALREADY carries a suffix keeps it (it's already in the family,
// and renaming it to _a would collide with the _a that exists), so duplicating
// the _b clip yields _c and leaves _b alone.
//
// `original` is returned rather than assumed so the caller renames the source
// clip in the same state update as the insert — one undo step for one action.
// Past 26 members the letters are exhausted and it falls back to the numeric
// split scheme, which cannot collide with any letter name.
export function duplicateNames(baseName, clips) {
  const root = duplicateRoot(baseName)
  const stripped = stripExt(baseName)
  const used = new Set()
  for (const c of clips || []) {
    const name = c.displayName || c.sourceName
    if (!name || duplicateRoot(name) !== root) continue
    const m = stripExt(name).match(DUP_SUFFIX_RE)
    if (m) used.add(m[1])
  }

  const own = stripped.match(DUP_SUFFIX_RE)
  const original = own ? stripped : `${root}_a`
  used.add(own ? own[1] : 'a')

  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i)
    if (!used.has(letter)) return { original, copy: `${root}_${letter}` }
  }
  // Keyed off `root`, not `baseName`, so the fallback is "v01" rather than a
  // suffix-on-suffix "v_a01" — and no letter name can ever equal it.
  return { original, copy: nextSplitName(root, clips) }
}

// Deterministic color per clip id, so a clip keeps its color across
// reorders and stays visually traceable after being split by Splice.
export function clipColor(clipId) {
  let hash = 0
  for (let i = 0; i < clipId.length; i++) {
    hash = (hash * 31 + clipId.charCodeAt(i)) >>> 0
  }
  return CLIP_PALETTE[hash % CLIP_PALETTE.length]
}

// Room-tone level, from the stepper's raw text to a number the server will
// accept. The field holds a string so an in-progress "-" or "" survives typing;
// clamping happens once, at payload time.
//
// The empty/unparseable case returns `dflt`, but a parsed 0 is returned AS 0 —
// 0 dB (the asset at its recorded level) is a legal setting, so this can never
// be written as `parseFloat(text) || dflt`, which is the `speed || 1` bug.
export function clampNoiseGainDb(text, dflt, min, max) {
  const n = parseFloat(text)
  if (!Number.isFinite(n)) return dflt
  // Rounded to the server's own precision (round(gain, 1)) so the level shown
  // in the toolbar is exactly the level that reaches the filtergraph.
  return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10
}

// Which part of its FILE an A1 clip plays. `inSec`/`outSec` are optional and
// absent means "all of it": that is every A1 clip that has never been split, and
// every bed in a project saved before Split reached the lane, so an old .nara
// needs no migration and renders the graph it always did.
//
// `outSec` is bounded by `durationSec` — the probed CONTAINER duration, the same
// approximation that has always drawn the lane and placed the next clip. The
// render bounds its own copy by the file's measured AUDIO-stream duration
// instead (app.py `_a1_bed_lane`), which is why a clip's tail is the server's
// call and an untrimmed clip sends no `outSec` at all.
export function bedInSec(bed) {
  return Number.isFinite(bed?.inSec) ? Math.max(bed.inSec, 0) : 0
}

export function bedOutSec(bed) {
  const dur = Number.isFinite(bed?.durationSec) ? Math.max(bed.durationSec, 0) : 0
  const out = Number.isFinite(bed?.outSec) ? bed.outSec : dur
  return dur > 0 ? Math.min(out, dur) : out
}

// How long an A1 clip is ON THE LANE. This — not durationSec — is what draws it,
// what places the clip after it and what the preview plays: a split clip's half
// occupies only the part of the file it kept.
export function bedPlayedSec(bed) {
  return Math.max(bedOutSec(bed) - bedInSec(bed), 0)
}

// Lane seconds → that clip's own file seconds. The inverse of how the bar and the
// preview player place it, and the one conversion Split needs: the playhead is a
// lane position, and a cut is a point in the file.
export function bedFileTimeAt(bed, laneSec) {
  return bedInSec(bed) + (laneSec - (bed?.startSec || 0))
}

// Both halves must be worth having. Same strict comparison (and, at the call
// site, the same MIN_PART_SEC) a V1 splice uses, so the two Splits refuse for the
// same reason at the same margin.
export function canSplitBed(bed, atFileSec, minPartSec) {
  if (!bed || !Number.isFinite(atFileSec)) return false
  return atFileSec - bedInSec(bed) > minPartSec && bedOutSec(bed) - atFileSec > minPartSec
}

// Cut one A1 clip into two at a point in its file. The halves are the SAME file
// twice with adjoining source ranges, which is what makes this a cut rather than
// a re-layout: the render concatenates them sample-exactly, so the lane sounds
// identical until one of them is moved or removed.
//
// The left half keeps the original's `startSec` and the right half starts exactly
// one left-half later, so a split opens NO hole — the invariant that lets a split
// be undone by deleting either half without disturbing the rest of the lane.
//
// The right half deliberately does not gain an `outSec` the original didn't have:
// absent still means "to the end of the file", so the render keeps measuring that
// tail itself instead of trusting a container duration.
export function splitBed(bed, atFileSec) {
  const inSec = bedInSec(bed)
  return [
    { ...bed, inSec, outSec: atFileSec },
    { ...bed, inSec: atFileSec, startSec: (bed.startSec || 0) + (atFileSec - inSec) },
  ]
}

// A1 lane positions. A bed's `startSec` is LANE seconds — 0 is where V1's
// picture starts, excluding V1's head hold (the render adelays the whole lane by
// that hold), so a bed's start survives every V1 head-hold edit untouched.
//
// Back-fills `startSec` from the cumulative sum for beds that predate the field
// (every .nara through version 5, where position was implicit in array order),
// which is what makes an old project open exactly as it rendered before. Also
// clamps a start that would overlap the previous bed forward to that bed's end:
// the render's counterpart (ffmpeg_utils.normalize_bed_placements) does the same
// clamp, because a negative gap would mean a negative anullsrc duration. Neither
// is reachable by removing a clip — it exists for a re-probed or hand-edited
// duration that grew.
//
// Idempotent, and returns the SAME array when nothing changed so React's
// referential equality holds and the undo history doesn't record a no-op.
export function normalizeBeds(beds) {
  if (!Array.isArray(beds) || beds.length === 0) return beds
  let changed = false
  let cursor = 0
  const out = beds.map(bed => {
    // The PLAYED length, not the file's: a split clip's half occupies only its
    // own part of the lane, so the clip after it (and any clamp against it)
    // measures from where that half actually ends.
    const dur = bedPlayedSec(bed)
    const raw = Number.isFinite(bed.startSec) ? bed.startSec : cursor
    const start = Math.max(raw, cursor)
    cursor = start + dur
    if (start === bed.startSec) return bed
    changed = true
    return { ...bed, startSec: start }
  })
  return changed ? out : beds
}

// Where the A1 lane's last bed ends, in lane seconds. Not the sum of durations:
// with a hole in the lane those differ, and every consumer (the bar's
// short/long/exact state, the trailing hatch) means the end, not the total.
export function bedLaneEndSec(beds) {
  return (beds || []).reduce(
    (end, b) => Math.max(end, (b.startSec || 0) + bedPlayedSec(b)), 0)
}

// A microsecond of slack, so a butt joint (this clip's start === that clip's
// end) counts as fitting rather than as a hair of overlap. Deliberately far
// below EPS-sized musical tolerances: this is float dust, not a snap distance.
const BED_FIT_EPS = 1e-6

// What one A1 clip is allowed to do on the lane, given where all the others
// sit: whether a start is legal, and the shortlist of starts that touch
// something. Used by moveBed, the one A1 edit that has to ask whether a position
// is free — swapBeds holds the pair's own span, so it never needs to. The
// candidate list is what a drag snaps to. The obstacles' own starts are never
// modified here — that is what makes a drag a function of this clip alone.
function bedGeometry(lane, index) {
  const dur = bedPlayedSec(lane[index])
  const others = lane
    .filter((_, i) => i !== index)
    .map(b => ({ start: b.startSec || 0, end: (b.startSec || 0) + bedPlayedSec(b) }))
  return {
    fits: s => s >= -BED_FIT_EPS
      && others.every(o => s + dur <= o.start + BED_FIT_EPS || s >= o.end - BED_FIT_EPS),
    // Butted against the far side or the near side of some other clip, or at the
    // head of the lane. Not filtered for legality — the caller tests `fits`.
    candidates: [0, ...others.flatMap(o => [o.end, o.start - dur])],
  }
}

// Move ONE A1 clip to a new position on the lane. The A1 counterpart of
// moveClip, and the single definition of an A1 move: a bed owns its `startSec`,
// so moving one IS changing that number — it is never a reorder for its own
// sake, and it never changes any OTHER clip's start. That last part is the
// invariant the lane is built on (removing a clip leaves the rest exactly where
// they were), so a move keeps it: nothing is pushed out of the way to make room.
//
// Two clips cannot overlap. The render concatenates the lane into ONE stream and
// pads the holes with measured silence (ffmpeg_utils.a1_bed_source /
// bed_lane_gaps), so "two beds sounding at once" has no representation at all —
// which is why this SNAPS instead of placing blindly. `startSec` is where the
// cursor asks for: if the clip fits there it goes there, and if it doesn't it
// goes to the nearest position where it does — butted against a neighbour, or
// into the next hole big enough to hold it. Dragging a clip left until it stops
// therefore closes a hole exactly, with no need to land on the edge by hand.
//
// The array comes back sorted by start, because both normalizeBeds here and
// normalize_bed_placements on the server read the lane in ARRAY order and clamp
// a bed that starts before the one in front of it — an out-of-order array would
// be silently pulled back into order and the move would look like it didn't
// take. So the new INDEX comes back too: dragging a clip past a neighbour
// changes its index, and identity on A1 is position (see App.handleRemoveBed),
// so the caller's selection has to follow it.
//
// Same array reference back for a move that changes nothing or that has nowhere
// legal to go, exactly like moveClip: reduceEdit bails on an unchanged slice, so
// a drag that can't move anything spends no undo step.
export function moveBed(beds, index, startSec) {
  const lane = normalizeBeds(beds)
  if (!Array.isArray(lane) || !Number.isInteger(index) || index < 0 || index >= lane.length) {
    return { beds, index }
  }
  const { fits, candidates } = bedGeometry(lane, index)

  const want = Math.max(Number.isFinite(startSec) ? startSec : 0, 0)
  let start = null
  if (fits(want)) {
    start = want
  } else {
    // Where else it could sit: butted against the far side or the near side of
    // some other clip, or at the head of the lane. A legal spot that isn't
    // `want` always touches something — if it didn't, it could slide towards
    // `want` and still fit, so it wasn't the nearest one.
    for (const cand of candidates) {
      if (cand < 0 || !fits(cand)) continue
      if (start == null || Math.abs(cand - want) < Math.abs(start - want)) start = cand
    }
  }
  if (start == null) return { beds, index }
  if (Math.abs(start - (lane[index].startSec || 0)) <= BED_FIT_EPS) return { beds, index }

  const moved = { ...lane[index], startSec: start }
  // Sorted with the original index as the tiebreak, so the order of clips that
  // share a start (only reachable with a zero-length one) is stable.
  const ordered = lane
    .map((bed, i) => ({ bed: i === index ? moved : bed, i }))
    .sort((a, b) => ((a.bed.startSec || 0) - (b.bed.startSec || 0)) || (a.i - b.i))
  return {
    beds: ordered.map(o => o.bed),
    index: ordered.findIndex(o => o.bed === moved),
  }
}

// Which A1 clip the selected one would trade places with, going one clip earlier
// (`dir` -1) or later (+1) — its array index, or null when there is no clip that
// way. This is what enables/disables the toolbar's Move ◀ ▶ on A1, and it is the
// same rule V1 uses: the first clip can't go earlier, the last can't go later.
export function bedSwapTarget(beds, index, dir) {
  const lane = normalizeBeds(beds)
  if (!Array.isArray(lane) || !Number.isInteger(index) || !lane[index]) return null
  const other = index + (dir < 0 ? -1 : 1)
  return lane[other] ? other : null
}

// Trade one A1 clip's place with its neighbour's. This is what Move ◀ ▶ and
// ⌥←/⌥→ do on A1 — the counterpart of moveClip's reorder on V1, and the one A1
// edit that moves a clip OTHER than the selected one. Dragging still doesn't:
// moveBed slides one clip into a spot that already fits (see its comment), which
// is the right thing for a pointer aimed at a position but can't put two clips
// in the other's order when neither has room to pass.
//
// The pair keeps the span it already occupied. The neighbour takes the selected
// clip's start; the selected clip lands so that it ends exactly where the
// neighbour used to end, with the gap that was between them still between them:
//
//     before   [ A ][ A ]   gap   [ B ][ B ][ B ]
//     after    [ B ][ B ][ B ]   gap   [ A ][ A ]
//              ^ unchanged                      ^ unchanged
//
// Holding the outer edges is what makes this safe with no fits() test at all:
// the two clips between them cover the same stretch of lane as before, so a swap
// can never collide with a third clip or run off the head of the lane, whatever
// the durations are. Anchoring the pair's start alone (letting the far edge fall
// where the durations put it) would have needed one, and could have refused a
// swap that plainly ought to work.
//
// Same `{beds, index}` contract as moveBed, including the same array reference
// back when there is no neighbour, so a press that can't do anything spends no
// undo step. The index comes back because the two clips exchange array slots and
// identity on A1 is position (see App.handleRemoveBed), so the caller's
// selection has to follow the clip it was on.
export function swapBeds(beds, index, dir) {
  const lane = normalizeBeds(beds)
  const other = bedSwapTarget(lane, index, dir)
  if (other == null) return { beds, index }

  const lo = Math.min(index, other)
  const hi = Math.max(index, other)
  const first = lane[lo]
  const second = lane[hi]
  const firstStart = first.startSec || 0
  const secondDur = bedPlayedSec(second)
  // Whatever silence sat between them stays between them. Clamped at 0 because
  // normalizeBeds has already pulled any overlap apart, so a negative here would
  // be float dust rather than a real hole.
  const gap = Math.max((second.startSec || 0) - (firstStart + bedPlayedSec(first)), 0)

  const next = lane.slice()
  next[lo] = { ...second, startSec: firstStart }
  next[hi] = { ...first, startSec: firstStart + secondDur + gap }
  return { beds: next, index: index === lo ? hi : lo }
}
