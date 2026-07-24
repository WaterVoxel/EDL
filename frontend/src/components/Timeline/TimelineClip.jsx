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
      ? 'border-indigo-500 ring-2 ring-indigo-500'
      : 'border-neutral-600 hover:border-neutral-400'

  return (
    <div
      ref={startRef}
      className={`relative flex-shrink-0 h-16 rounded-md bg-neutral-700 border cursor-pointer select-none overflow-hidden ${borderClass}`}
      style={{ width: widthPx }}
      onClick={() => onSelect(clip)}
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(index) }}
      onDragOver={e => { e.preventDefault(); onDragOver(index) }}
      onDrop={e => { e.preventDefault(); onDrop(index) }}
    >
      {/* Left trim handle */}
      <div
        className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-indigo-400/40 z-10"
        onPointerDown={e => handleEdgeDrag('left', e)}
      />
      {/* Right trim handle */}
      <div
        className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-indigo-400/40 z-10"
        onPointerDown={e => handleEdgeDrag('right', e)}
      />
      {/* Label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-3 pointer-events-none">
        <span className="text-[10px] text-neutral-300 truncate max-w-full">{clip.sourceName}</span>
        <span className="text-[9px] text-neutral-500">{durationLabel}</span>
      </div>
    </div>
  )
}
