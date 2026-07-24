export const GAP_PX = 2
export const ROUND_EPSILON = 0.0005

export function clipMainSec(clip) {
  return clip.outSec - clip.inSec
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

// How much a duration misses landing on the next whole second. Returns 0 if
// already whole (within a small epsilon to tolerate float rounding).
export function roundUpAmount(totalSec) {
  const nextWhole = Math.ceil(totalSec - ROUND_EPSILON)
  const amount = nextWhole - totalSec
  return amount > ROUND_EPSILON && amount < 1 - ROUND_EPSILON ? amount : 0
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
