import { useMedia } from '../context/MediaContext'
import { sanitizeHoldPlacement, nextSplitName } from '../clipMath'

const MIN_PART_SEC = 0.1

export default function SpliceButton({ selectedClip, clips, setClips, onSelectId }) {
  const { currentTime } = useMedia()

  const splitTime = selectedClip
    ? Math.max(selectedClip.inSec, Math.min(currentTime, selectedClip.outSec))
    : null
  const canSplit = selectedClip &&
    splitTime - selectedClip.inSec > MIN_PART_SEC &&
    selectedClip.outSec - splitTime > MIN_PART_SEC

  function apply() {
    if (!canSplit) return
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
      disabled={!canSplit}
      title="Split the selected clip into two clips at the playhead"
      className="px-1.5 py-0.5 text-[9px] rounded bg-sky-600 text-white hover:bg-sky-500 disabled:bg-neutral-700 disabled:text-neutral-500"
    >
      Split
    </button>
  )
}
