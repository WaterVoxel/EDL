import { forwardRef } from 'react'

// The playhead is positioned imperatively via `ref.style.transform` (see
// Timeline.positionPlayhead) so the playback engine can move it every
// animation frame without a React re-render. `visible` gates it out when
// there are no clips.
const Playhead = forwardRef(function Playhead({ visible, onDrag }, ref) {
  if (!visible) return null

  function handlePointerDown(e) {
    e.stopPropagation()
    e.preventDefault()

    function onMove(ev) { onDrag(ev.clientX) }
    function onUp() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  return (
    <div
      ref={ref}
      className="absolute top-0 bottom-0 left-0 w-0 z-30 pointer-events-none"
    >
      {/* Vertical line spanning ruler + track */}
      <div className="absolute left-0 top-0 w-px h-full bg-red-500 -translate-x-1/2" />
      {/* Draggable handle — sits on the ruler (top) */}
      <div
        onPointerDown={handlePointerDown}
        className="absolute left-0 -top-0.5 w-3 h-3 -translate-x-1/2 pointer-events-auto cursor-ew-resize"
      >
        {/* Triangle/arrow pointing down */}
        <svg viewBox="0 0 12 12" className="w-full h-full fill-red-500 drop-shadow">
          <polygon points="6,12 0,0 12,0" />
        </svg>
      </div>
    </div>
  )
})

export default Playhead
