import { moveClip, sanitizeHoldPlacement, clipStartSec, bedSwapTarget, swapBeds } from '../clipMath'

// Moves the selected clip one slot earlier or later in the sequence. V1/V2 clips
// carry no position of their own — the render concatenates them in array order —
// so this IS what moving a clip means, and it's the same edit a drag-and-drop on
// the timeline performs, routed through the same `moveClip`.
//
// The point of having it here rather than only on the lane: a clip's box shrinks
// with its duration (24px floor), so the pieces a Split leaves behind are nearly
// impossible to drag. These buttons are the same size whatever the clip is.
//
// With an A1 clip selected these move THAT clip instead — the same rule Split
// follows (A1's selection wins), and for the same reason: a short audio clip is
// as hard to drag as a short video one. On A1 a press SWAPS the clip with its
// neighbour (clipMath.swapBeds), which is as close to V1's "one slot earlier" as
// a lane of positioned clips gets: the pair keeps the stretch of lane it had,
// gap included, so the swap is always possible and always reversible by pressing
// the other way. Dragging is still the way to place a clip somewhere new.
// Selecting an audio clip clears the video selection, so the two branches below
// can never both be live.
export default function MoveClipButtons({
  selectedClip, clips, setClips, onSelectId, onSeek,
  selectedBedIndex = null, beds = [], onMoveBed,
}) {
  const index = selectedClip ? clips.findIndex(c => c.id === selectedClip.id) : -1
  const bedIndex = onMoveBed && selectedBedIndex != null && beds[selectedBedIndex]
    ? selectedBedIndex : -1
  // Whether there is a clip that way to trade places with — also the disabled
  // state, so a button is dark exactly when pressing it would do nothing. On the
  // first and last clip of the lane that's the same pair of dark buttons V1 shows
  // on its own first and last clip.
  const bedLeft = bedIndex === -1 ? null : bedSwapTarget(beds, bedIndex, -1)
  const bedRight = bedIndex === -1 ? null : bedSwapTarget(beds, bedIndex, 1)

  // No seek, no dirty flags, no sanitizeHoldPlacement: a bed has no decisions to
  // invalidate and no picture to look at, and the drag deliberately doesn't move
  // the playhead either (it would pull the preview off the video clip the user is
  // watching). The whole edit is where the two clips sit.
  function applyBed(dir) {
    const next = swapBeds(beds, bedIndex, dir)
    if (next.beds === beds) return
    onMoveBed(next.beds, next.index)
  }

  function apply(delta) {
    if (bedIndex !== -1) { applyBed(delta); return }
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
      {!selectedClip && bedIndex === -1 && <span className="text-[8px] text-neutral-600">select a clip</span>}
      <span className="text-[8px] text-neutral-500">Move</span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => apply(-1)}
          disabled={bedIndex !== -1 ? bedLeft == null : index <= 0}
          title={bedIndex !== -1
            ? 'Swap the selected A1 clip with the audio clip before it (⌥←)'
            : 'Move the selected clip one slot earlier (⌥←)'}
          className="px-1.5 py-0.5 text-[8px] rounded bg-teal-300/15 border border-teal-300/50 text-teal-200 hover:bg-teal-300/25 disabled:bg-transparent disabled:border-neutral-700 disabled:text-neutral-600"
        >
          ◀
        </button>
        <button
          onClick={() => apply(1)}
          disabled={bedIndex !== -1 ? bedRight == null : (index === -1 || index >= clips.length - 1)}
          title={bedIndex !== -1
            ? 'Swap the selected A1 clip with the audio clip after it (⌥→)'
            : 'Move the selected clip one slot later (⌥→)'}
          className="px-1.5 py-0.5 text-[8px] rounded bg-teal-300/15 border border-teal-300/50 text-teal-200 hover:bg-teal-300/25 disabled:bg-transparent disabled:border-neutral-700 disabled:text-neutral-600"
        >
          ▶
        </button>
      </div>
    </div>
  )
}
