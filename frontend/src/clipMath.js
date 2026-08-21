export const GAP_PX = 2
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

// Total duration excluding any "Raise" round-up extension — this is what
// Raise measures against to decide how much rounding is needed.
export function clipBaseSec(clip) {
  return (clip.headHoldSec || 0) + clipMainSec(clip) + (clip.tailHoldSec || 0)
}

// Sum of clipBaseSec across the whole sequence (excludes any roundHoldSec
// anywhere) — Raise always rounds the *sequence* total, not any individual
// clip, since the round-up extension only ever attaches to the last clip.
export function sequenceBaseSec(clips) {
  return clips.reduce((sum, c) => sum + clipBaseSec(c), 0)
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
// V1's: per-clip RENDERED widths separated by `gapPx` (the flex `gap-0.5`
// between clips). This is the one definition of "under the video on V1" — the
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
// timelineStart for a native/scrub body; `rate` is the play speed (≤1).
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
