import { useMedia } from '../context/MediaContext'

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
    // Head/tail/round hold segments are anchored to the original clip's
    // outer edges, so only the half that still touches that edge keeps them.
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
      return next
    })
    onSelectId(left.id)
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3 flex flex-col">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">Splice</h3>
      {!selectedClip && <p className="text-[10px] text-neutral-600 mb-2">Select a clip on the timeline first.</p>}
      {selectedClip && (
        <p className="text-[10px] text-neutral-500 mb-2">
          Split at playhead ({splitTime.toFixed(2)}s){!canSplit && ' — move playhead inside the clip'}
        </p>
      )}
      <button
        onClick={apply}
        disabled={!canSplit}
        className="mt-auto px-3 py-1 text-xs rounded bg-sky-600 text-white hover:bg-sky-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Split at Playhead
      </button>
    </div>
  )
}
