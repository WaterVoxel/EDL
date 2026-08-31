import { mergeClips, sanitizeHoldPlacement } from '../clipMath'

// Split's counterpart: takes the clips picked on the focused track and makes them
// render as one file instead of two.
//
// All of the judgement lives in clipMath.mergeClips, which returns either an
// `error` sentence or the new lane. This component asks it TWICE — once on every
// render to decide the disabled state and the tooltip, once on click to do the
// work — so the reason the button gives is by construction the reason it would
// refuse. There is no separate "canMerge" predicate to drift out of step.
//
// Nothing here is V1- or V2-specific: `clips`/`setClips`/`ids` arrive already
// resolved to the focused track by App's activeClips plumbing.
export default function MergeButton({ clips, setClips, ids, onSelectId, onMerged, selectedBed = null }) {
  // An A1 clip selected means the user is working on audio, and merging audio
  // beds is not this feature — Split takes the same view, and it is the only
  // other button that has an opinion about A1 at all.
  const probe = selectedBed ? { error: 'Merge works on V1 and V2 clips, not A1 audio' } : mergeClips(clips, ids)

  function apply() {
    const result = mergeClips(clips, ids)
    if (result.error) return
    // Recomputed against `prev` rather than committing the array built above, the
    // same as Split: the lane is the authority on its own contents at the moment
    // of the update, and a merge that no longer applies must leave it alone
    // instead of reinstating a stale copy of it.
    setClips(prev => {
      const fresh = mergeClips(prev, ids)
      return fresh.error ? prev : sanitizeHoldPlacement(fresh.clips)
    })
    onSelectId(result.selectId)
    // The extra picks are consumed by the merge; leaving them set would offer to
    // merge a clip that no longer exists (collapse) or re-stamp a fuseId over a
    // group that already has one.
    onMerged?.()
  }

  return (
    <button
      onClick={apply}
      disabled={!!probe.error}
      title={probe.error
        ? `Merge: ${probe.error}`
        : (probe.collapsed
          ? 'Merge the selected clips into one clip — they are one unbroken stretch of one file, so they become a single clip with a single trim, and render as one file'
          : 'Merge the selected clips so they render as one file — they stay separate clips (different sources, a gap between them, or a different speed or direction on one of them) but draw and render as one, each part keeping its own retime')}
      className="px-1.5 py-0.5 text-[8px] rounded bg-sky-600 text-white hover:bg-sky-500 disabled:bg-neutral-700 disabled:text-neutral-500"
    >
      Merge
    </button>
  )
}
