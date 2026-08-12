// Crop keyframe animation: each clip carries `cropKeyframes`, an array of
// { t, x, y } entries where `t` is SOURCE seconds relative to the clip's
// inSec (0 → outSec-inSec). Only crop.x/crop.y interpolate — crop.w/h stay
// static. Interpolation is linear; before the first keyframe the origin
// holds at the first frame's value, after the last it holds at the last.
// Frames are always sorted by t, which is invariant #1 downstream (render
// pipeline emits a piecewise-linear expression assuming sorted t).
//
// CRITICAL: `t` is defined in SOURCE time (relative to inSec), NOT timeline
// time. This is the one unit the writer (+ button / drag), the preview
// reader (CropOverlay), and the ffmpeg render expression must all agree on.
// The render `crop` filter runs on the raw input before trim/setpts, so its
// `t` variable is the source frame's own timestamp — source time is the
// only frame of reference every consumer shares. clipTFromTimelinePos below
// is the single conversion used by both writer and reader so they can never
// drift (it mirrors useTimelinePlayback.resolveTimelinePos: speed stretch
// and reversal included).

const EPS = 1e-6

// Given a timeline position and the clip that owns it, return the keyframe
// `t` (source seconds relative to inSec) the playhead sits at within that
// clip's MAIN body, or null if the playhead is outside the clip or inside
// one of its frozen head/tail/round hold segments (a hold is a single
// frozen frame — there is no motion to key over it).
//
// `clipStartTimeline` is the clip's start offset on the timeline (sum of
// clipTotalSec of all preceding clips). speed/reversed handled exactly like
// resolveTimelinePos so the preview frame and the keyframe agree.
export function clipTFromTimelinePos(clip, clipStartTimeline, timelinePos) {
  const within = timelinePos - clipStartTimeline
  const head = clip.headHoldSec || 0
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
  const mainTimeline = (clip.outSec - clip.inSec) / speed // timeline-domain length
  if (within < head - EPS || within > head + mainTimeline + EPS) return null
  const mainOffsetTimeline = Math.max(0, Math.min(mainTimeline, within - head))
  // Convert the timeline offset within the body to SOURCE offset from inSec.
  const sourceOffsetFromIn = clip.reversed
    ? (clip.outSec - clip.inSec) - mainOffsetTimeline * speed
    : mainOffsetTimeline * speed
  const dur = clip.outSec - clip.inSec
  return Math.max(0, Math.min(dur, sourceOffsetFromIn))
}

export function sortKeyframes(kfs) {
  return [...kfs].sort((a, b) => a.t - b.t)
}

// Rebase keyframes when a clip's trim changes. Two things would otherwise
// break, because `t` is measured FROM inSec rather than from the source's
// own zero:
//   • moving inSec slides every keyframe onto different source frames, so
//     a pan the user placed against specific content drifts off it;
//   • shortening the body leaves keyframes past its end, and render
//     validation REJECTS the whole job (app.py bounds-checks every t
//     against outSec-inSec) — the edit appears to work, then Render fails.
// Fix: shift t by the inSec delta so each keyframe keeps its absolute
// source position, then replace anything now outside [0, dur] with a single
// keyframe at that edge carrying the curve's own interpolated value there.
// The retained span of the pan is preserved exactly, and the result is
// always in range. Returns the same array identity when nothing moves, so
// callers can skip a needless dirty flag.
export function retimeKeyframesForTrim(kfs, oldInSec, newInSec, newOutSec) {
  if (!kfs || kfs.length === 0) return kfs
  const dur = Math.max(0, newOutSec - newInSec)
  const delta = (oldInSec || 0) - (newInSec || 0)
  const shifted = sortKeyframes(kfs.map(k => ({ t: k.t + delta, x: k.x, y: k.y })))
  const inside = shifted.filter(k => k.t >= -EPS && k.t <= dur + EPS)
  const next = []
  // Sampling the shifted curve at the boundary is exact: sampleCropOrigin
  // holds endpoints, so this works even when every keyframe fell outside.
  if (inside.length !== shifted.length || shifted[0].t < -EPS) {
    if (shifted[0].t < -EPS) {
      const at0 = sampleCropOrigin(shifted, 0)
      next.push({ t: 0, x: at0.x, y: at0.y })
    }
  }
  for (const k of inside) {
    if (next.length > 0 && Math.abs(k.t - next[next.length - 1].t) < EPS) continue
    next.push({ t: Math.max(0, Math.min(dur, k.t)), x: k.x, y: k.y })
  }
  if (shifted[shifted.length - 1].t > dur + EPS) {
    const atEnd = sampleCropOrigin(shifted, dur)
    if (next.length > 0 && Math.abs(dur - next[next.length - 1].t) < EPS) next.pop()
    next.push({ t: dur, x: atEnd.x, y: atEnd.y })
  }
  if (next.length === 0) {
    const at0 = sampleCropOrigin(shifted, 0)
    next.push({ t: 0, x: at0.x, y: at0.y })
  }
  const unchanged = next.length === kfs.length
    && next.every((k, i) => Math.abs(k.t - kfs[i].t) < EPS && k.x === kfs[i].x && k.y === kfs[i].y)
  return unchanged ? kfs : next
}

// Add a keyframe at `t`. If one already exists at (nearly) the same t,
// overwrite its x/y instead of introducing a duplicate — a duplicate would
// make the render expression ambiguous (two branches with the same
// condition), and the user's intent when clicking + at the same playhead
// spot twice is "update," not "insert."
export function addKeyframe(kfs, t, x, y) {
  const existing = kfs.findIndex(k => Math.abs(k.t - t) < EPS)
  if (existing >= 0) {
    const next = [...kfs]
    next[existing] = { t, x, y }
    return sortKeyframes(next)
  }
  return sortKeyframes([...kfs, { t, x, y }])
}

// Remove the keyframe whose t is closest to the given `t`. No-op if the
// list is empty. Symmetric with add: same "at the playhead" model.
export function removeNearestKeyframe(kfs, t) {
  if (kfs.length === 0) return kfs
  let bestIdx = 0
  let bestDist = Math.abs(kfs[0].t - t)
  for (let i = 1; i < kfs.length; i++) {
    const d = Math.abs(kfs[i].t - t)
    if (d < bestDist) { bestIdx = i; bestDist = d }
  }
  return kfs.filter((_, i) => i !== bestIdx)
}

// The furthest origin a keyframed pan ever reaches (`fallback` — normally
// the static crop origin — acts as the floor). The crop box has to fit
// inside the source frame at EVERY keyframe, not just the one under the
// playhead, so this is what a resize must clamp against: growing the box
// while parked on a keyframe near x=0 would otherwise push a later
// keyframe past the frame edge, and render_timeline rejects the whole job
// (app.py validates every keyframe's x+w / y+h against the source).
export function maxKeyframeOrigin(kfs, fallback) {
  let x = fallback?.x || 0
  let y = fallback?.y || 0
  for (const k of kfs) {
    if (k.x > x) x = k.x
    if (k.y > y) y = k.y
  }
  return { x, y }
}

// Linearly interpolate crop origin at time `t`. Extrapolation: hold the
// endpoint values before the first / after the last keyframe (a natural
// "ease-out into pan, ease-out at end" for the common case where the user
// keys the start and end of a move).
export function sampleCropOrigin(kfs, t) {
  if (kfs.length === 0) return null
  const sorted = sortKeyframes(kfs)
  if (t <= sorted[0].t) return { x: sorted[0].x, y: sorted[0].y }
  const last = sorted[sorted.length - 1]
  if (t >= last.t) return { x: last.x, y: last.y }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      const f = span > EPS ? (t - a.t) / span : 0
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
      }
    }
  }
  return { x: last.x, y: last.y }
}
