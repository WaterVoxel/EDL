import { CROP_PRESETS, findPreset, cropBoxSize, centeredCropOrigin } from '../cropMath'

// Crop is a per-clip spatial property (like Trim is temporal) — applied at
// Render time via ffmpeg's crop filter, before any trim/reverse/speed step,
// so holds are cropped identically to the main body. Picking a preset here
// sizes the crop box to fit the clip's native resolution (never upscaled)
// and centers it; CropOverlay lets the user drag it anywhere on the preview.
export default function CropForm({ selectedClip, setClips, animateEnabled = false, onToggleAnimate, freeEnabled = false, onToggleFree }) {
  const hasResolution = !!(selectedClip?.sourceWidth && selectedClip?.sourceHeight)
  const canAnimate = !!selectedClip?.crop
  const canResize = !!selectedClip?.crop

  function apply(key) {
    if (!selectedClip) return
    if (!key) {
      setClips(prev => prev.map(c => c.id === selectedClip.id ? { ...c, crop: null, dirty: true } : c))
      return
    }
    const preset = findPreset(key)
    const box = cropBoxSize(preset, selectedClip.sourceWidth, selectedClip.sourceHeight)
    const origin = centeredCropOrigin(box, selectedClip.sourceWidth, selectedClip.sourceHeight)
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id ? { ...c, crop: { key, w: box.w, h: box.h, x: origin.x, y: origin.y }, dirty: true } : c
    ))
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">Crop</span>
      {!selectedClip && <span className="text-[9px] text-neutral-600">select a clip</span>}
      {selectedClip && !hasResolution && <span className="text-[9px] text-neutral-600">resolution unknown</span>}
      {selectedClip && hasResolution && (
        <select
          value={selectedClip.crop?.key || ''}
          onChange={e => apply(e.target.value)}
          title="Crop to a fixed output resolution — drag the box on the preview to reposition"
          className={`px-1 py-0.5 text-[10px] rounded bg-neutral-950 border text-neutral-300 ${selectedClip.crop ? 'border-emerald-500' : 'border-neutral-700'}`}
        >
          <option value="">None</option>
          {CROP_PRESETS.map(([group, options]) => (
            <optgroup key={group} label={group}>
              {options.map(o => (
                <option key={`${o.w}x${o.h}`} value={`${o.w}x${o.h}`}>{o.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      <button
        onClick={onToggleFree}
        disabled={!canResize}
        title={canResize
          ? (freeEnabled ? 'Turn off free resize' : 'Drag a corner handle on the preview to scale the crop box — the selected aspect ratio is kept')
          : 'Pick a crop preset first — Free lets you scale the crop box while keeping its aspect ratio'}
        className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${
          freeEnabled
            ? 'bg-sky-500 text-neutral-950 border-sky-500'
            : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-neutral-200 disabled:text-neutral-600 disabled:hover:text-neutral-600'
        }`}
      >
        {freeEnabled ? '⤡ Free' : 'Free'}
      </button>
      <button
        onClick={onToggleAnimate}
        disabled={!canAnimate}
        title={canAnimate
          ? (animateEnabled ? 'Hide the keyframe track' : 'Show the keyframe track under V1 to animate the crop position')
          : 'Pick a crop preset first — Animate keyframes the crop’s position over time'}
        className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${
          animateEnabled
            ? 'bg-amber-500 text-neutral-950 border-amber-500'
            : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-neutral-200 disabled:text-neutral-600 disabled:hover:text-neutral-600'
        }`}
      >
        {animateEnabled ? '● Animate' : 'Animate'}
      </button>
    </div>
  )
}
