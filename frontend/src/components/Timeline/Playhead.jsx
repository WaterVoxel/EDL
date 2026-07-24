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
    <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: leftPx }}>
      <div
        onPointerDown={handlePointerDown}
        className="w-3 h-3 -translate-x-1/2 bg-red-500 rounded-full pointer-events-auto cursor-ew-resize"
      />
      <div className="w-px h-full bg-red-500 mx-auto" />
    </div>
  )
}
