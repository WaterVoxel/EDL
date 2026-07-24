import { useMedia } from '../context/MediaContext'
import { sanitizeHoldPlacement } from '../clipMath'

const MIN_PART_SEC = 0.1

export default function SpliceButton({ selectedClip, setClips, onSelectId }) {
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
    const left = {
      ...selectedClip,
      id: crypto.randomUUID(),
      outSec: splitTime,
      tailHoldSec: 0,
      roundHoldSec: 0,
      dirty: true,
      renderedInputName: null,
    }
    const right = {
      ...selectedClip,
      id: crypto.randomUUID(),
      inSec: splitTime,
      headHoldSec: 0,
      dirty: true,
      renderedInputName: null,
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

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">Splice</span>
      {selectedClip ? (
        <span className="text-[10px] text-neutral-500">at {splitTime.toFixed(2)}s{!canSplit && ' (move playhead inside clip)'}</span>
      ) : (
        <span className="text-[10px] text-neutral-600">select a clip</span>
      )}
      <button
        onClick={apply}
        disabled={!canSplit}
        title="Split the selected clip into two clips at the playhead"
        className="px-2 py-1 text-xs rounded bg-sky-600 text-white hover:bg-sky-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Split
      </button>
    </div>
  )
}
