import { sanitizeHoldPlacement, nextSplitName } from '../clipMath'

// Duplicates the selected clip — same trim window, holds, and reversed
// state — and inserts the copy immediately after the original.
export default function DuplicateButton({ selectedClip, clips, setClips, onSelectId }) {
  function apply() {
    if (!selectedClip) return
    const baseName = selectedClip.displayName || selectedClip.sourceName
    const copy = {
      ...selectedClip,
      id: crypto.randomUUID(),
      dirty: true,
      displayName: nextSplitName(baseName, clips),
    }
    setClips(prev => {
      const idx = prev.findIndex(c => c.id === selectedClip.id)
      if (idx === -1) return prev
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      // Inserting a copy can leave a head/tail/round hold stranded away
      // from the sequence's outer edge (e.g. duplicating the last clip
      // copies its tail hold into the middle) — re-anchor them.
      return sanitizeHoldPlacement(next.map(c => ({ ...c, dirty: true })))
    })
    onSelectId(copy.id)
  }

  return (
    <div className="flex items-center gap-1.5">
      {!selectedClip && <span className="text-[9px] text-neutral-600">select a clip</span>}
      <button
        onClick={apply}
        disabled={!selectedClip}
        title="Duplicate the selected clip and place the copy right after it"
        className="px-1.5 py-0.5 text-[9px] rounded bg-violet-600 text-white hover:bg-violet-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Duplicate
      </button>
    </div>
  )
}
