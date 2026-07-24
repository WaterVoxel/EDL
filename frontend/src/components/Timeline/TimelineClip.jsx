import { useRef } from 'react'

const MIN_CLIP_SEC = 0.1

export default function TimelineClip({ clip, pps, selected, onSelect, onTrim, index, onDragStart, onDragOver, onDrop }) {
  const startRef = useRef(null)

  const widthPx = (clip.outSec - clip.inSec) * pps
  const durationLabel = (clip.outSec - clip.inSec).toFixed(2) + 's'

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
      ? 'border-indigo-400 ring-1 ring-indigo-400'
      : 'border-neutral-700 hover:border-neutral-500'

  return (
    <div
      ref={startRef}
      className={`relative flex-shrink-0 h-full rounded border cursor-pointer select-none overflow-hidden bg-gradient-to-b from-neutral-700 to-neutral-800 ${borderClass}`}
      style={{ width: Math.max(widthPx, 24) }}
      onClick={() => onSelect(clip)}
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(index) }}
      onDragOver={e => { e.preventDefault(); onDragOver(index) }}
      onDrop={e => { e.preventDefault(); onDrop(index) }}
    >
      {/* Left trim handle */}
      <div
        className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize hover:bg-indigo-400/50 z-10"
        onPointerDown={e => handleEdgeDrag('left', e)}
      />
      {/* Right trim handle */}
      <div
        className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize hover:bg-indigo-400/50 z-10"
        onPointerDown={e => handleEdgeDrag('right', e)}
      />
      {/* Label */}
      <div className="absolute inset-0 flex flex-col items-start justify-between px-2 py-1 pointer-events-none">
        <span className="text-[9px] text-neutral-200 truncate max-w-full font-medium">{clip.sourceName}</span>
        <span className="text-[9px] text-neutral-400 font-mono">{durationLabel}</span>
      </div>
    </div>
  )
}
