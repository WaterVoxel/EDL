import { sanitizeHoldPlacement, duplicateNames } from '../clipMath'

// Duplicates the selected clip — same trim window, holds, and reversed
// state — and inserts the copy immediately after the original.
//
// The pair is named "<name>_a" (original) / "<name>_b" (copy) and the copy
// carries `isDuplicate`, which is what draws the ⧉ marker on the lane and in
// the EDL. That flag is a LABEL only: it never reaches ffmpeg (the render
// payload is read key by key server-side) and Analyze/Reconstruct still detect
// duplicates structurally, by sourceName+inSec+outSec — see analyzeMath's
// `keyForClip`. So a hand-edited or older project without the flag renders
// exactly the same; it just doesn't draw the marker.
export default function DuplicateButton({ selectedClip, clips, setClips, onSelectId }) {
  function apply() {
    if (!selectedClip) return
    const baseName = selectedClip.displayName || selectedClip.sourceName
    const { original, copy: copyName } = duplicateNames(baseName, clips)
    const copy = {
      ...selectedClip,
      id: crypto.randomUUID(),
      dirty: true,
      displayName: copyName,
      isDuplicate: true,
    }
    setClips(prev => {
      const idx = prev.findIndex(c => c.id === selectedClip.id)
      if (idx === -1) return prev
      const next = [...prev]
      // Rename the source clip to the _a half in the SAME update as the insert,
      // so the pair appears together and one Cmd/Ctrl+Z takes both back.
      next[idx] = { ...next[idx], displayName: original }
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
      {!selectedClip && <span className="text-[8px] text-neutral-600">select a clip</span>}
      <button
        onClick={apply}
        disabled={!selectedClip}
        title="Duplicate the selected clip and place the copy right after it"
        className="px-1.5 py-0.5 text-[8px] rounded bg-violet-600 text-white hover:bg-violet-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Duplicate
      </button>
    </div>
  )
}
