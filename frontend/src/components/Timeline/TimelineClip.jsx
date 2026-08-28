import { clipHeadPx, clipMainPx, clipTailPx, clipRoundPx, clipTotalPx, clipColor, clipMainSec, clipSpeed } from '../../clipMath'
import { nextGesture } from '../../hooks/useUndoableTracks'

const MIN_CLIP_SEC = 0.1

// One member of a fused run has to lose the three things that make a box read as
// its own clip — the border on the seam side, the rounding on that corner, and
// the fill layer's matching rounding — while keeping the two that make the run
// read as one: the border along the top and bottom, and the outer corners.
//
// Spelled out per position as LITERAL class strings. Tailwind v4's scanner reads
// source text, so `rounded-${side}` would be purged and the seam would silently
// reopen in a production build only (see CLIP_PALETTE's note in clipMath).
const FUSE_BOX = {
  start: 'rounded-l border-y-2 border-l-2',
  mid: 'border-y-2',
  end: 'rounded-r border-y-2 border-r-2',
}
const FUSE_FILL = { start: 'rounded-l', mid: '', end: 'rounded-r' }

export default function TimelineClip({
  clip, pps, selected, selectedPart, onSelect, onDeletePart, onTrim, onDelete, index,
  // Reorder drag: `dropSide` marks which edge of THIS clip the insertion line
  // belongs on ('before' | 'after' | null), `dragging` marks this clip as the one
  // being dragged. Both come from the lane, which owns the whole gesture.
  onDragStart, onDragOver, onDrop, onDragEnd, dropSide = null, dragging = false,
  // Set only for a member of a fused run (clipMath.fuseGroups); null everywhere
  // else, which is why V1's lane and an ordinary V2 clip are untouched by all of
  // it. `pos` says which end of the run this is, `colorId` is the run's shared
  // palette key, `dirty` is the RUN's dirty state (any member counts, so a box
  // is never half-dashed). The run's name, duration, badges, delete button and
  // selection ring are drawn by the lane, over the whole run — a member must not
  // draw its own, or the seam comes back as doubled labels.
  fuse = null,
}) {
  const headPx = clipHeadPx(clip, pps)
  const mainPx = clipMainPx(clip, pps)
  const tailPx = clipTailPx(clip, pps)
  const roundPx = clipRoundPx(clip, pps)
  const totalPx = clipTotalPx(clip, pps)
  // One gradient across the run instead of one per member: clipColor hashes the
  // id, and every reconstructed range gets its own fresh UUID, so untouched this
  // would paint a colour change exactly where the seam is supposed to disappear.
  const color = clipColor(fuse ? fuse.colorId : clip.id)
  const speed = clipSpeed(clip)

  // Label shows the duration as played on the timeline (stretched by any
  // slow-down), plus the speed when it isn't 100%.
  const mainDurationLabel = clipMainSec(clip).toFixed(2) + 's'
    + (speed !== 1 ? ` · ${Math.round(speed * 100)}%` : '')

  function handleEdgeDrag(edge, e) {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startIn = clip.inSec
    const startOut = clip.outSec
    // One token for the whole drag, so the dozens of pointermove updates below
    // collapse into a SINGLE undo step (see useUndoableTracks). Minted per
    // gesture, not per clip: two successive drags of the same edge have to be
    // two separate entries.
    const gesture = nextGesture('trim')

    function onMove(ev) {
      const dx = ev.clientX - startX
      // On-screen pixels are timeline seconds; a slowed clip covers less
      // SOURCE time per pixel, so scale the trim delta back by speed.
      const deltaSec = (dx / pps) * speed
      if (edge === 'left') {
        const newIn = Math.max(0, Math.min(startIn + deltaSec, clip.outSec - MIN_CLIP_SEC))
        onTrim(clip.id, newIn, clip.outSec, gesture)
      } else {
        const newOut = Math.min(clip.sourceDurationSec, Math.max(startOut + deltaSec, clip.inSec + MIN_CLIP_SEC))
        onTrim(clip.id, clip.inSec, newOut, gesture)
      }
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  // A fused run reports the RUN's dirty state, so trimming one member can't leave
  // a box that is amber-dashed down one half and palette-bordered down the other.
  const borderClass = (fuse ? fuse.dirty : clip.dirty) ? 'border-dashed border-amber-500' : color.border

  function segmentRing(part) {
    return selected && selectedPart === part ? 'ring-2 ring-white ring-offset-1 ring-offset-neutral-950' : ''
  }

  return (
    <div
      className={`relative flex-shrink-0 h-full select-none group ${dragging ? 'opacity-40' : ''}`}
      style={{ width: Math.max(totalPx, 24) }}
      // How the lane tells "the drag is over a clip" from "it's over the empty
      // stretch past the last clip", which is a drop-at-the-end.
      data-clip=""
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(index) }}
      // Which HALF of this clip the cursor is over, from the cursor itself rather
      // than from the index: that's what lets the caller draw the insertion line
      // on the near edge and drop the clip exactly there. A clip floored to 24px
      // still has a real rect, so short clips work the same way.
      onDragOver={e => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        onDragOver(index, e.clientX < rect.left + rect.width / 2 ? 'before' : 'after')
      }}
      onDrop={e => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        onDrop(index, e.clientX < rect.left + rect.width / 2 ? 'before' : 'after')
      }}
      // Fires even when the drag is abandoned (Esc, or a drop outside the lane),
      // which is what clears the insertion line and stops the edge scroll.
      onDragEnd={() => onDragEnd?.()}
      title="Drag to reorder — or use Move ◀ ▶ / ⌥← ⌥→"
    >
      {/* Insertion line: where this clip WILL land if dropped now. Teal and 2px,
          deliberately unlike the playhead's 1px red line and the indigo wash a
          file drag paints — three things that can appear over the same lane.
          Straddles the seam (-1px on a 2px line), so it reads as a boundary
          between clips rather than as part of either one. Clips are flush now —
          clipMath.GAP_PX is 0 — so there is no gap left to sit inside. */}
      {dropSide && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-teal-300 z-30 pointer-events-none"
          style={dropSide === 'before' ? { left: -1 } : { right: -1 }}
        />
      )}
      {/* Head hold segment — only ever present on the sequence's first clip */}
      {headPx > 0 && (
        <div
          className={`absolute top-0 bottom-0 left-0 rounded-l border border-fuchsia-500 bg-gradient-to-b from-fuchsia-700 to-fuchsia-900 flex flex-col items-center justify-center overflow-hidden cursor-pointer ${segmentRing('head')}`}
          style={{ width: headPx }}
          onClick={e => { e.stopPropagation(); onSelect(clip, 'head') }}
        >
          <span className="text-[7px] text-fuchsia-100 font-medium leading-none">HOLD</span>
          <span className="text-[7px] text-fuchsia-200 font-mono leading-none mt-0.5">{clip.headHoldSec.toFixed(1)}s</span>
          <button
            onClick={e => { e.stopPropagation(); onDeletePart('head') }}
            title="Remove head hold"
            className="absolute top-0 right-0 w-3 h-3 flex items-center justify-center bg-black/50 hover:bg-red-600 text-white text-[8px] leading-none opacity-0 group-hover:opacity-100 z-20"
          >×</button>
        </div>
      )}

      {/* Main body — the trimmed source clip, color-coded per clip id.
          The gradient fill lives on an inset inner layer, not the bordered
          box itself: a dashed border (dirty state) paints gaps in its own
          background, so a fill on the SAME element as the border shows
          through those gaps as a mismatched second color that reads as an
          offset outline. Keeping the outer box border-only and the fill on
          a child inset inside it means the dashes reveal nothing (the dark
          track behind), not the clip's own color. */}
      <div
        /* grab, not pointer: the body is the drag handle for reordering, and that
           cursor is the only standing hint that a clip can be moved at all. The
           edge trim strips below keep their own ew-resize. */
        className={`absolute top-0 bottom-0 overflow-hidden cursor-grab active:cursor-grabbing ${fuse ? FUSE_BOX[fuse.pos] : 'rounded border-2'} ${borderClass} ${!fuse && selected && selectedPart === 'main' ? 'ring-2 ring-white ring-offset-1 ring-offset-neutral-950 brightness-110' : ''}`}
        style={{ left: headPx, width: Math.max(mainPx, 24) }}
        onClick={() => onSelect(clip, 'main')}
      >
        <div className={`absolute inset-0 bg-gradient-to-b ${fuse ? FUSE_FILL[fuse.pos] : 'rounded'} ${color.grad}`} />
        {/* Trim handles only on the run's OUTER edges. An interior handle sits
            exactly on the invisible seam, and dragging it would cut a hole out of
            the middle of what the user is being shown as one continuous clip —
            with the ranges already discontiguous, nothing downstream could tell. */}
        {(!fuse || fuse.pos === 'start') && (
          <div
            className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/30 z-10"
            onPointerDown={e => handleEdgeDrag('left', e)}
          />
        )}
        {(!fuse || fuse.pos === 'end') && (
          <div
            className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/30 z-10"
            onPointerDown={e => handleEdgeDrag('right', e)}
          />
        )}
        {/* Name, duration, badges and the delete × are the run's, not a member's —
            the lane draws them once across the whole box. */}
        {!fuse && (
          <>
            <div className="absolute inset-0 flex flex-col items-start justify-between px-1.5 py-0.5 pointer-events-none">
              <span className="text-[8px] text-neutral-100 truncate max-w-full font-medium">
                {clip.isDuplicate && <span title="Duplicate of another clip on this track">⧉ </span>}
                {clip.reversed && <span title="Reversed">◀ </span>}
                {clip.displayName || clip.sourceName}
              </span>
              <span className="text-[8px] text-neutral-200 font-mono">{mainDurationLabel}</span>
            </div>
            <button
              onClick={e => { e.stopPropagation(); onDelete(clip.id) }}
              title="Delete clip"
              className="absolute top-0 right-0 w-3.5 h-3.5 flex items-center justify-center bg-black/50 hover:bg-red-600 text-white text-[9px] leading-none opacity-0 group-hover:opacity-100 z-20"
            >
              ×
            </button>
          </>
        )}
      </div>

      {/* Tail hold segment — only ever present on the sequence's last clip */}
      {tailPx > 0 && (
        <div
          className={`absolute top-0 bottom-0 border border-fuchsia-500 bg-gradient-to-b from-fuchsia-700 to-fuchsia-900 flex flex-col items-center justify-center overflow-hidden cursor-pointer ${segmentRing('tail')}`}
          style={{ left: headPx + mainPx, width: tailPx }}
          onClick={e => { e.stopPropagation(); onSelect(clip, 'tail') }}
        >
          <span className="text-[7px] text-fuchsia-100 font-medium leading-none">HOLD</span>
          <span className="text-[7px] text-fuchsia-200 font-mono leading-none mt-0.5">{clip.tailHoldSec.toFixed(1)}s</span>
          <button
            onClick={e => { e.stopPropagation(); onDeletePart('tail') }}
            title="Remove tail hold"
            className="absolute top-0 right-0 w-3 h-3 flex items-center justify-center bg-black/50 hover:bg-red-600 text-white text-[8px] leading-none opacity-0 group-hover:opacity-100 z-20"
          >×</button>
        </div>
      )}

      {/* Round segment — Raise's auto round-up extension, always trails the sequence's last clip */}
      {roundPx > 0 && (
        <div
          className={`absolute top-0 bottom-0 rounded-r border border-amber-400 bg-gradient-to-b from-amber-600 to-amber-800 flex flex-col items-center justify-center overflow-hidden cursor-pointer ${segmentRing('round')}`}
          style={{ left: headPx + mainPx + tailPx, width: roundPx }}
          onClick={e => { e.stopPropagation(); onSelect(clip, 'round') }}
        >
          <span className="text-[7px] text-amber-100 font-medium leading-none">ROUND</span>
          <span className="text-[7px] text-amber-200 font-mono leading-none mt-0.5">{clip.roundHoldSec.toFixed(1)}s</span>
          <button
            onClick={e => { e.stopPropagation(); onDeletePart('round') }}
            title="Remove round extension"
            className="absolute top-0 right-0 w-3 h-3 flex items-center justify-center bg-black/50 hover:bg-red-600 text-white text-[8px] leading-none opacity-0 group-hover:opacity-100 z-20"
          >×</button>
        </div>
      )}
    </div>
  )
}
