export default function Playhead({ leftPx, onDrag }) {
  if (leftPx == null) return null

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
    <div className="absolute top-0 bottom-0 left-0 w-0 z-20 pointer-events-none" style={{ transform: `translateX(${leftPx}px)` }}>
      <div className="absolute left-0 top-0 w-px h-full bg-red-500 -translate-x-1/2" />
      <div
        onPointerDown={handlePointerDown}
        className="absolute left-0 top-0 w-3 h-3 -translate-x-1/2 bg-red-500 rounded-full pointer-events-auto cursor-ew-resize"
      />
    </div>
  )
}
