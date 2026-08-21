import { useEffect, useState } from 'react'
import { useMedia } from '../context/MediaContext'
import {
  sanitizeHoldPlacement, nextSplitName, bedFileTimeAt, canSplitBed, splitBed,
} from '../clipMath'

const MIN_PART_SEC = 0.1

// How often the A1 split point is re-read while an audio clip is selected. The
// button already re-renders at the video's ~4Hz timeupdate, which covers every
// ordinary click on the timeline (clicking seeks, which fires timeupdate) — this
// covers the seek that lands on the same source frame and so fires nothing, e.g.
// a click inside a hold. Local to this component on purpose: the whole reason the
// playhead is read through a ref is to keep its rate out of App's render path.
const A1_POLL_MS = 150

// One Split for both kinds of clip. With an A1 clip selected it cuts THAT clip —
// A1's selection wins, which is the point of the feature — and otherwise it cuts
// the selected video clip exactly as it always has. The rest of the toolbar is
// deliberately unaffected by an A1 selection (see App.jsx's A1 comment), so this
// is the one button that has to know about both.
export default function SpliceButton({
  selectedClip, clips, setClips, onSelectId,
  selectedBed = null, selectedBedIndex = null, setBeds, laneClockRef,
}) {
  const { currentTime } = useMedia()

  // A1's split point comes from the TIMELINE playhead, not from currentTime:
  // currentTime is the video's SOURCE time, which has no fixed relation to where
  // the playhead sits (a hold, a reverse, a slow-down all break it), while A1 is
  // timeline-locked exactly as the render's bed is.
  const [, setA1Tick] = useState(0)
  useEffect(() => {
    if (!selectedBed) return
    const id = setInterval(() => setA1Tick(n => n + 1), A1_POLL_MS)
    return () => clearInterval(id)
  }, [selectedBed])

  const bedSplitTime = selectedBed
    ? bedFileTimeAt(selectedBed, laneClockRef?.current?.() ?? NaN)
    : NaN
  const canSplitBedNow = canSplitBed(selectedBed, bedSplitTime, MIN_PART_SEC)

  const splitTime = selectedClip
    ? Math.max(selectedClip.inSec, Math.min(currentTime, selectedClip.outSec))
    : null
  const canSplitClip = !selectedBed && selectedClip &&
    splitTime - selectedClip.inSec > MIN_PART_SEC &&
    selectedClip.outSec - splitTime > MIN_PART_SEC

  // The two halves are the same file with adjoining source ranges, so the lane
  // sounds identical until one of them is removed or the gap between them grows —
  // see clipMath.splitBed, which is also where the "no hole" arithmetic lives.
  // The playhead is re-read here rather than reused from the render above so the
  // cut lands where the playhead IS, not where it was at the last tick.
  function applyBed() {
    const at = bedFileTimeAt(selectedBed, laneClockRef?.current?.() ?? NaN)
    if (!canSplitBed(selectedBed, at, MIN_PART_SEC)) return
    setBeds(prev => {
      if (!prev[selectedBedIndex]) return prev
      const next = [...prev]
      next.splice(selectedBedIndex, 1, ...splitBed(prev[selectedBedIndex], at))
      return next
    })
    // The selection stays on the LEFT half — the same index, and the same choice
    // the video branch makes below.
  }

  function apply() {
    if (selectedBed) { applyBed(); return }
    if (!canSplitClip) return
    // Head/tail/round hold segments are anchored to the sequence's outer
    // edges, so only the half that still touches that edge keeps them;
    // sanitizeHoldPlacement enforces this afterward as a safety net.
    const baseName = selectedClip.displayName || selectedClip.sourceName
    // A reversed clip plays outSec -> inSec on the timeline, so the half
    // that comes FIRST on the timeline (left, inserted before) is the one
    // whose source range sits next to outSec — the opposite of a forward
    // clip, where timeline order matches source order.
    const firstRange = selectedClip.reversed
      ? { inSec: splitTime, outSec: selectedClip.outSec }
      : { inSec: selectedClip.inSec, outSec: splitTime }
    const secondRange = selectedClip.reversed
      ? { inSec: selectedClip.inSec, outSec: splitTime }
      : { inSec: splitTime, outSec: selectedClip.outSec }
    // Crop keyframes are indexed by t relative to the pre-split main body;
    // remapping them onto two halves with different time bases (and, if
    // reversed, opposite play directions) is ambiguous, so both halves
    // reset to no animation rather than silently misaligning.
    const left = {
      ...selectedClip,
      ...firstRange,
      id: crypto.randomUUID(),
      tailHoldSec: 0,
      roundHoldSec: 0,
      cropKeyframes: [],
      dirty: true,
      displayName: nextSplitName(baseName, clips),
    }
    const right = {
      ...selectedClip,
      ...secondRange,
      id: crypto.randomUUID(),
      headHoldSec: 0,
      cropKeyframes: [],
      dirty: true,
      displayName: nextSplitName(baseName, clips, [left]),
    }
    setClips(prev => {
      const idx = prev.findIndex(c => c.id === selectedClip.id)
      if (idx === -1) return prev
      const next = [...prev]
      next.splice(idx, 1, left, right)
      return sanitizeHoldPlacement(next)
    })
    onSelectId(left.id)
  }

  // Button only — no "Splice" group label and no playhead readout. The
  // readout tracked currentTime, so it re-laid out the toolbar on every
  // frame; the split point is already visible as the playhead itself, and
  // the disabled state stands in for the "select a clip" hint.
  return (
    <button
      onClick={apply}
      disabled={selectedBed ? !canSplitBedNow : !canSplitClip}
      title={selectedBed
        ? 'Split the selected A1 clip into two at the playhead — the two halves play exactly what the one clip did, so nothing else on the lane moves and nothing is re-encoded'
        : 'Split the selected clip into two clips at the playhead'}
      className="px-1.5 py-0.5 text-[8px] rounded bg-sky-600 text-white hover:bg-sky-500 disabled:bg-neutral-700 disabled:text-neutral-500"
    >
      Split
    </button>
  )
}
