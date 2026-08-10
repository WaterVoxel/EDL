// Reverse is a per-clip property applied at Render time (like trim/hold),
// not an immediate backend action — so a reversed clip's holds can freeze
// on the correct frame (the render pipeline swaps which end of the trim
// window a lead/trail hold samples from when reversed is set).
export default function ReverseForm({ selectedClip, setClips }) {
  function toggle() {
    if (!selectedClip) return
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id ? { ...c, reversed: !c.reversed, dirty: true } : c
    ))
  }

  const isReversed = !!selectedClip?.reversed

  return (
    <div className="flex items-center gap-1.5">
      {!selectedClip && <span className="text-[9px] text-neutral-600">select a clip</span>}
      <button
        onClick={toggle}
        disabled={!selectedClip}
        title="Play this clip backwards (applied on Render)"
        className={`px-1.5 py-0.5 text-[9px] rounded disabled:bg-neutral-700 disabled:text-neutral-500 ${
          isReversed ? 'bg-orange-600 text-white hover:bg-orange-500' : 'bg-indigo-600 text-white hover:bg-indigo-500'
        }`}
      >
        {isReversed ? '◀ Reversed' : 'Reverse'}
      </button>
    </div>
  )
}
