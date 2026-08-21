import { clipHeadPx, clipMainPx, clipTailPx, clipRoundPx, clipTotalPx, clipColor, clipMainSec, clipSpeed } from '../../clipMath'
import { nextGesture } from '../../hooks/useUndoableTracks'

const MIN_CLIP_SEC = 0.1

export default function TimelineClip({
  clip, pps, selected, selectedPart, onSelect, onDeletePart, onTrim, onDelete, index,
  // Reorder drag: `dropSide` marks which edge of THIS clip the insertion line
  // belongs on ('before' | 'after' | null), `dragging` marks this clip as the one
  // being dragged. Both come from the lane, which owns the whole gesture.
  onDragStart, onDragOver, onDrop, onDragEnd, dropSide = null, dragging = false,
}) {
  const headPx = clipHeadPx(clip, pps)
  const mainPx = clipMainPx(clip, pps)
  const tailPx = clipTailPx(clip, pps)
  const roundPx = clipRoundPx(clip, pps)
  const totalPx = clipTotalPx(clip, pps)
  const color = clipColor(clip.id)
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

  const borderClass = clip.dirty ? 'border-dashed border-amber-500' : color.border

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
          Sits in the 2px inter-clip gap (-2px), so it reads as a boundary
          between clips rather than as part of either one. */}
      {dropSide && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-teal-300 z-30 pointer-events-none"
          style={dropSide === 'before' ? { left: -2 } : { right: -2 }}
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
        className={`absolute top-0 bottom-0 rounded overflow-hidden cursor-grab active:cursor-grabbing border-2 ${borderClass} ${selected && selectedPart === 'main' ? 'ring-2 ring-white ring-offset-1 ring-offset-neutral-950 brightness-110' : ''}`}
        style={{ left: headPx, width: Math.max(mainPx, 24) }}
        onClick={() => onSelect(clip, 'main')}
      >
        <div className={`absolute inset-0 rounded bg-gradient-to-b ${color.grad}`} />
        <div
          className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/30 z-10"
          onPointerDown={e => handleEdgeDrag('left', e)}
        />
        <div
          className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/30 z-10"
          onPointerDown={e => handleEdgeDrag('right', e)}
        />
        <div className="absolute inset-0 flex flex-col items-start justify-between px-1.5 py-0.5 pointer-events-none">
          <span className="text-[8px] text-neutral-100 truncate max-w-full font-medium">
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
