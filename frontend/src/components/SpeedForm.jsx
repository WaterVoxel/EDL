// Slow-down control: stretches frame timing (setpts) without re-encoding
// tricks, interpolation, or generated frames — every output frame is an
// existing source frame shown longer. Only predefined speeds whose
// effective frame rate stays at or above MIN_EFFECTIVE_FPS are offered,
// computed per clip from its source fps.
const MIN_EFFECTIVE_FPS = 12
const PRESET_SPEEDS = [1.0, 0.75, 0.5, 0.4, 0.25, 0.2]

export function allowedSpeeds(sourceFps) {
  const fps = sourceFps || 30
  return PRESET_SPEEDS.filter(s => fps * s >= MIN_EFFECTIVE_FPS - 1e-9)
}

export default function SpeedForm({ selectedClip, setClips }) {
  const disabled = !selectedClip
  const speeds = selectedClip ? allowedSpeeds(selectedClip.fps) : [1.0]
  const current = selectedClip?.speed && selectedClip.speed > 0 ? selectedClip.speed : 1

  function apply(speed) {
    if (!selectedClip) return
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id ? { ...c, speed, dirty: true } : c
    ))
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">Speed</span>
      {!selectedClip && <span className="text-[9px] text-neutral-600">select a clip</span>}
      {selectedClip && (
        <select
          value={String(current)}
          onChange={e => apply(parseFloat(e.target.value))}
          title={`Slow down by stretching frame timing (no generated frames). Options keep the effective rate ≥ ${MIN_EFFECTIVE_FPS} fps for this clip's ${(selectedClip.fps || 30).toFixed(0)} fps source.`}
          className={`px-1 py-0.5 text-[9px] rounded bg-neutral-950 border text-neutral-300 ${current !== 1 ? 'border-orange-500' : 'border-neutral-700'}`}
        >
          {speeds.map(s => (
            <option key={s} value={String(s)}>
              {Math.round(s * 100)}%{s !== 1 ? ` (${((selectedClip.fps || 30) * s).toFixed(1).replace(/\.0$/, '')} fps)` : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
