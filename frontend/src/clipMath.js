export const GAP_PX = 2

export function clipMainSec(clip) {
  return clip.outSec - clip.inSec
}

export function clipTotalSec(clip) {
  return (clip.headHoldSec || 0) + clipMainSec(clip) + (clip.tailHoldSec || 0)
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

export function clipTotalPx(clip, pps) {
  return clipTotalSec(clip) * pps
}
