export default function Playhead({ leftPx }) {
  if (leftPx == null) return null
  return (
    <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: leftPx }}>
      <div className="w-3 h-3 -translate-x-1/2 bg-red-500 rounded-full" />
      <div className="w-px h-full bg-red-500 mx-auto" />
    </div>
  )
}
