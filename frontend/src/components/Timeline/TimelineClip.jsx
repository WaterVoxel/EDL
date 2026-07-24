import { clipHeadPx, clipMainPx, clipTailPx, clipRoundPx, clipTotalPx, clipColor } from '../../clipMath'

const MIN_CLIP_SEC = 0.1

export default function TimelineClip({ clip, pps, selected, onSelect, onTrim, index, onDragStart, onDragOver, onDrop }) {
  const headPx = clipHeadPx(clip, pps)
  const mainPx = clipMainPx(clip, pps)
  const tailPx = clipTailPx(clip, pps)
  const roundPx = clipRoundPx(clip, pps)
  const totalPx = clipTotalPx(clip, pps)
  const color = clipColor(clip.id)

  const mainDurationLabel = (clip.outSec - clip.inSec).toFixed(2) + 's'

  function handleEdgeDrag(edge, e) {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startIn = clip.inSec
    const startOut = clip.outSec

    function onMove(ev) {
      const dx = ev.clientX - startX
      const deltaSec = dx / pps
      if (edge === 'left') {
        const newIn = Math.max(0, Math.min(startIn + deltaSec, clip.outSec - MIN_CLIP_SEC))
        onTrim(clip.id, newIn, clip.outSec)
      } else {
        const newOut = Math.min(clip.sourceDurationSec, Math.max(startOut + deltaSec, clip.inSec + MIN_CLIP_SEC))
        onTrim(clip.id, clip.inSec, newOut)
      }
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const borderClass = clip.dirty
    ? 'border-dashed border-amber-500'
    : selected
      ? `${color.border} ring-1 ${color.ring}`
      : color.border

  return (
    <div
      className="relative flex-shrink-0 h-full select-none"
      style={{ width: Math.max(totalPx, 24) }}
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(index) }}
      onDragOver={e => { e.preventDefault(); onDragOver(index) }}
      onDrop={e => { e.preventDefault(); onDrop(index) }}
      title="Drag to reorder"
    >
      {/* Head hold segment — only ever present on the sequence's first clip */}
      {headPx > 0 && (
        <div
          className="absolute top-0 bottom-0 left-0 rounded-l border border-fuchsia-500 bg-gradient-to-b from-fuchsia-700 to-fuchsia-900 flex flex-col items-center justify-center overflow-hidden cursor-pointer"
          style={{ width: headPx }}
          onClick={() => onSelect(clip)}
        >
          <span className="text-[8px] text-fuchsia-100 font-medium leading-none">HOLD</span>
          <span className="text-[8px] text-fuchsia-200 font-mono leading-none mt-0.5">{clip.headHoldSec.toFixed(1)}s</span>
        </div>
      )}

      {/* Main body — the trimmed source clip, color-coded per clip id */}
      <div
        className={`absolute top-0 bottom-0 rounded overflow-hidden cursor-pointer bg-gradient-to-b ${color.grad} border ${borderClass}`}
        style={{ left: headPx, width: Math.max(mainPx, 24) }}
        onClick={() => onSelect(clip)}
      >
        <div
          className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/30 z-10"
          onPointerDown={e => handleEdgeDrag('left', e)}
        />
        <div
          className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/30 z-10"
          onPointerDown={e => handleEdgeDrag('right', e)}
        />
        <div className="absolute inset-0 flex flex-col items-start justify-between px-2 py-1 pointer-events-none">
          <span className="text-[9px] text-neutral-100 truncate max-w-full font-medium">{clip.sourceName}</span>
          <span className="text-[9px] text-neutral-200 font-mono">{mainDurationLabel}</span>
        </div>
      </div>

      {/* Tail hold segment — only ever present on the sequence's last clip */}
      {tailPx > 0 && (
        <div
          className="absolute top-0 bottom-0 border border-fuchsia-500 bg-gradient-to-b from-fuchsia-700 to-fuchsia-900 flex flex-col items-center justify-center overflow-hidden cursor-pointer"
          style={{ left: headPx + mainPx, width: tailPx }}
          onClick={() => onSelect(clip)}
        >
          <span className="text-[8px] text-fuchsia-100 font-medium leading-none">HOLD</span>
          <span className="text-[8px] text-fuchsia-200 font-mono leading-none mt-0.5">{clip.tailHoldSec.toFixed(1)}s</span>
        </div>
      )}

      {/* Round segment — Raise's auto round-up extension, always trails the sequence's last clip */}
      {roundPx > 0 && (
        <div
          className="absolute top-0 bottom-0 rounded-r border border-amber-400 bg-gradient-to-b from-amber-600 to-amber-800 flex flex-col items-center justify-center overflow-hidden cursor-pointer"
          style={{ left: headPx + mainPx + tailPx, width: roundPx }}
          onClick={() => onSelect(clip)}
        >
          <span className="text-[8px] text-amber-100 font-medium leading-none">ROUND</span>
          <span className="text-[8px] text-amber-200 font-mono leading-none mt-0.5">{clip.roundHoldSec.toFixed(1)}s</span>
        </div>
      )}
    </div>
  )
}
