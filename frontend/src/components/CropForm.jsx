import { CROP_PRESETS, findPreset, cropForPreset, isFitCrop } from '../cropMath'

// Crop is a per-clip spatial property (like Trim is temporal) — applied at
// Render time via ffmpeg's crop filter, before any trim/reverse/speed step,
// so holds are cropped identically to the main body. Picking a preset here
// sizes the crop box to fit the clip's native resolution (never upscaled)
// and centers it; CropOverlay lets the user drag it anywhere on the preview.
//
// One preset can mean either of two things, decided automatically by
// cropForPreset: a CUT (a preset-sized region out of the middle, the original
// behaviour) or a FIT (the whole frame scaled down into the preset) when the
// clip's aspect ratio is exactly the preset's. A fit box covers the entire
// frame, so there is no region left to position or scale — hence Free and
// Animate switch off below, and CropOverlay stops offering the drag.
export default function CropForm({ selectedClip, setClips, animateEnabled = false, onToggleAnimate, freeEnabled = false, onToggleFree }) {
  const hasResolution = !!(selectedClip?.sourceWidth && selectedClip?.sourceHeight)
  const isFit = isFitCrop(selectedClip?.crop)
  const canAnimate = !!selectedClip?.crop && !isFit
  const canResize = !!selectedClip?.crop && !isFit

  function apply(key) {
    if (!selectedClip) return
    if (!key) {
      setClips(prev => prev.map(c => c.id === selectedClip.id ? { ...c, crop: null, dirty: true } : c))
      return
    }
    const preset = findPreset(key)
    const next = cropForPreset(preset, selectedClip.sourceWidth, selectedClip.sourceHeight)
    if (!next) return
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id
        ? {
            ...c,
            crop: { key, ...next },
            // A fit box spans the whole frame, so every keyframe would clamp
            // to (0,0) and the "pan" would be a dead straight line. Dropping
            // them is the honest outcome of switching to a fit: silently
            // keeping a set of keyframes that can no longer move anything
            // would leave the Animate track looking live while doing nothing.
            cropKeyframes: next.fitW ? [] : c.cropKeyframes,
            dirty: true,
          }
        : c
    ))
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Labelled for V1 because that's the track being cropped in practice,
          but note the control is fed `activeSelectedClip` — it follows
          `focusedTrack`, so with a V2 clip focused this same dropdown crops
          V2. Make the label track-aware if that ever becomes confusing. */}
      <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">V1 CROP</span>
      {!selectedClip && <span className="text-[9px] text-neutral-600">select a clip</span>}
      {selectedClip && !hasResolution && <span className="text-[9px] text-neutral-600">resolution unknown</span>}
      {selectedClip && hasResolution && (
        <select
          value={selectedClip.crop?.key || ''}
          onChange={e => apply(e.target.value)}
          title="Crop to a fixed output resolution — drag the box on the preview to reposition. A preset matching this clip's aspect ratio exactly fits the whole frame into it instead of cutting."
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
      {/* The one visible tell that this preset fitted instead of cut. Without
          it a fit looks like a crop that failed to crop: the box covers the
          whole frame and the two buttons beside it are dead. */}
      {isFit && (
        <span
          className="px-1 py-0.5 text-[8px] rounded bg-emerald-300/15 border border-emerald-300/50 text-emerald-200 whitespace-nowrap"
          title={`This clip is ${selectedClip.sourceWidth}×${selectedClip.sourceHeight} — exactly this preset's aspect ratio, so the whole frame is scaled down to ${selectedClip.crop.fitW}×${selectedClip.crop.fitH} instead of cutting a region out of it. Nothing is lost, so there is no box to move or scale.`}
        >
          FIT
        </span>
      )}
      <button
        onClick={onToggleFree}
        disabled={!canResize}
        title={canResize
          ? (freeEnabled ? 'Turn off free resize' : 'Drag a corner handle on the preview to scale the crop box — the selected aspect ratio is kept')
          : isFit ? 'Not needed on a fit — the box already covers the whole frame'
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
          : isFit ? 'Nothing to animate on a fit — the box covers the whole frame, so there is nowhere to pan to'
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
