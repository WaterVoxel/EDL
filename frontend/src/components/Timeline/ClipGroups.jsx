import TimelineClip, { CO_SELECT_RING } from './TimelineClip'
import { clipMainSec, clipSpeed, clipHeadPx, clipTailPx, clipRoundPx } from '../../clipMath'

// One video lane's clips, drawn as fuseGroups (clipMath) rather than as a flat
// list — so a run of clips the user thinks of as ONE clip is one box with one
// name, one duration, one delete × and one selection ring.
//
// Shared by V1 and V2 because both lanes can now hold a fused run: V2's come from
// Reconstruct (one clip per range it keeps) and either lane's can come from Merge.
// This started as V2-only code inline in Timeline.jsx; it was lifted out rather
// than copied when V1 needed it, because two copies of a seam-hiding layout is
// exactly the kind of thing that drifts and reopens the seam on one lane only.
//
// An unfused clip comes back from fuseGroups as a single-member group and renders
// as a plain TimelineClip, with no wrapper — which is why a lane with no merges
// (every V1 lane, until now) looks and behaves exactly as it did before.
export default function ClipGroups({
  groups, pps, selectedId, selectedPart, coSelectedIds = null,
  onSelect, onDeletePart, onTrim, onDelete,
  onDragStart, onDragOver, onDrop, onDragEnd,
  draggingIndex = null, dropSideFor,
}) {
  return groups.map(group => {
    const members = group.clips
    const fused = !!group.fuseId
    const runSelected = members.some(c => c.id === selectedId)
    // A pick on any member marks the run: the merge acts on the whole box, since
    // fuseGroupIds is what "this clip" means once a run exists.
    const runCoSelected = !runSelected && !!coSelectedIds && members.some(c => coSelectedIds.has(c.id))
    const runDirty = members.some(c => c.dirty)
    const lead = members[0]
    const boxes = members.map((clip, k) => (
      <TimelineClip
        key={clip.id}
        clip={clip}
        pps={pps}
        index={group.start + k}
        selected={clip.id === selectedId}
        selectedPart={clip.id === selectedId ? selectedPart : null}
        coSelected={!!coSelectedIds?.has(clip.id)}
        onSelect={onSelect}
        onDeletePart={part => onDeletePart(clip.id, part)}
        onTrim={onTrim}
        onDelete={onDelete}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        // dragFromRef is a ref, so reading it during render only works because
        // `dropAt` state lands on the first dragover and re-renders the lane —
        // which is also exactly when there is something to dim.
        dragging={draggingIndex === group.start + k}
        dropSide={dropSideFor(group.start + k)}
        fuse={fused ? {
          pos: k === 0 ? 'start' : k === members.length - 1 ? 'end' : 'mid',
          colorId: group.fuseId,
          dirty: runDirty,
        } : null}
      />
    ))
    if (!fused) return boxes
    // The duration is the sum of the members' RENDERED lengths — what the joined
    // file will be — so the one label agrees with the one box. clipMainSec already
    // divides by each member's own speed, so this stays correct for a run whose
    // members are retimed differently.
    const runSec = members.reduce((n, c) => n + clipMainSec(c), 0)
    // Speed and direction are uniform across a RECONSTRUCTED run by construction,
    // but a MERGED one can hold a retimed clip next to a full-speed one (see
    // clipMath.fuseGroups) — so both are asked rather than read off the lead. A
    // single "50%" or a single ◀ over a mixed run is exactly the lie the old
    // agreement rule existed to prevent; saying "mixed" prevents it without
    // refusing the merge.
    const runSpeed = clipSpeed(lead)
    const uniformSpeed = members.every(c => clipSpeed(c) === runSpeed)
    const allReversed = members.every(c => !!c.reversed)
    const someReversed = members.some(c => !!c.reversed)
    // One file's ranges (a Reconstruct, or a Merge that couldn't collapse because
    // of a gap) versus genuinely different shots welded together (a Merge across
    // sources). Same box either way, but calling two files "ranges of this file"
    // would be a lie, so the tooltip asks the clips.
    const oneSource = members.every(c => c.sourceName === lead.sourceName)
    const runTitle = oneSource
      ? `One clip made of ${members.length} ranges of this file, in this order. Render joins them into a single file.`
      : `${members.length} clips merged — they render as a single file, in this order.`
    // The wrapper spans the run's HOLD segments too, but a single clip draws its
    // name and × inside the main body only — so inset the overlay past the run's
    // own holds, or the name lands on top of the fuchsia block's own "HOLD 1.0s"
    // label. Holds can only sit on the run's outer members (the hold placement
    // invariant), so the lead's head and the last member's tail/round are the only
    // ones there are.
    const last = members[members.length - 1]
    const padLeft = clipHeadPx(lead, pps)
    const padRight = clipTailPx(last, pps) + clipRoundPx(last, pps)
    return (
      <div
        /* The lead clip's id, not the fuseId: one fuseId can yield two groups when
           members stop agreeing on reverse or speed, and two wrappers keyed the
           same would collide. */
        key={lead.id}
        className={`relative flex items-stretch group ${runSelected ? 'rounded ring-2 ring-white ring-offset-1 ring-offset-neutral-950 brightness-110' : ''} ${runCoSelected ? `rounded ${CO_SELECT_RING}` : ''}`}
      >
        {boxes}
        <div
          className="absolute top-0 bottom-0 flex flex-col items-start justify-between px-1.5 py-0.5 pointer-events-none"
          style={{ left: padLeft, right: padRight }}
        >
          <span className="text-[8px] text-neutral-100 truncate max-w-full font-medium">
            {allReversed && <span title="Reversed">◀ </span>}
            {someReversed && !allReversed && (
              <span title="Some parts of this clip play in reverse and some forward">⇄ </span>
            )}
            {lead.displayName || lead.sourceName}
            <span className="text-neutral-400" title={runTitle}> ⛓ {members.length}</span>
          </span>
          <span
            className="text-[8px] text-neutral-200 font-mono"
            title={uniformSpeed ? undefined : `Parts of this clip play at different speeds (${members.map(c => `${Math.round(clipSpeed(c) * 100)}%`).join(', ')}). The duration is the total as it will render.`}
          >
            {runSec.toFixed(2)}s{uniformSpeed
              ? (runSpeed !== 1 ? ` · ${Math.round(runSpeed * 100)}%` : '')
              : ' · mixed'}
          </span>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete(lead.id) }}
          title={`Delete clip — all ${members.length} ${oneSource ? 'ranges' : 'parts'}`}
          className="absolute top-0 w-3.5 h-3.5 flex items-center justify-center bg-black/50 hover:bg-red-600 text-white text-[9px] leading-none opacity-0 group-hover:opacity-100 z-20"
          style={{ right: padRight }}
        >
          ×
        </button>
      </div>
    )
  })
}
