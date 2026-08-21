import { moveClip, sanitizeHoldPlacement, clipStartSec } from '../clipMath'

// Moves the selected clip one slot earlier or later in the sequence. V1/V2 clips
// carry no position of their own — the render concatenates them in array order —
// so this IS what moving a clip means, and it's the same edit a drag-and-drop on
// the timeline performs, routed through the same `moveClip`.
//
// The point of having it here rather than only on the lane: a clip's box shrinks
// with its duration (24px floor), so the pieces a Split leaves behind are nearly
// impossible to drag. These buttons are the same size whatever the clip is.
export default function MoveClipButtons({ selectedClip, clips, setClips, onSelectId, onSeek }) {
  const index = selectedClip ? clips.findIndex(c => c.id === selectedClip.id) : -1

  function apply(delta) {
    if (index === -1) return
    const next = moveClip(clips, index, index + delta)
    // Same reference = clamped at an end. Bail before marking anything dirty, so
    // pressing ◀ on the first clip costs no undo step.
    if (next === clips) return
    // Reordering changes the rendered sequence even though no clip's own
    // decisions changed, so everything is dirty — and a head/tail/round hold that
    // just left an outer slot is stripped, as on any other order change.
    setClips(sanitizeHoldPlacement(next.map(c => ({ ...c, dirty: true }))))
    onSelectId(selectedClip.id)
    // Playhead follows the clip, so the preview keeps showing what's being moved.
    // Null on V2, which has no playhead of its own (V1 is the timeline of record).
    onSeek?.(clipStartSec(next, selectedClip.id))
  }

  return (
    <div className="flex items-center gap-1.5">
      {!selectedClip && <span className="text-[8px] text-neutral-600">select a clip</span>}
      <span className="text-[8px] text-neutral-500">Move</span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => apply(-1)}
          disabled={index <= 0}
          title="Move the selected clip one slot earlier (⌥←)"
          className="px-1.5 py-0.5 text-[8px] rounded bg-teal-600 text-white hover:bg-teal-500 disabled:bg-neutral-700 disabled:text-neutral-500"
        >
          ◀
        </button>
        <button
          onClick={() => apply(1)}
          disabled={index === -1 || index >= clips.length - 1}
          title="Move the selected clip one slot later (⌥→)"
          className="px-1.5 py-0.5 text-[8px] rounded bg-teal-600 text-white hover:bg-teal-500 disabled:bg-neutral-700 disabled:text-neutral-500"
        >
          ▶
        </button>
      </div>
    </div>
  )
}
