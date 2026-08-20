// Slow-down control: stretches frame timing (setpts) without re-encoding
// tricks, interpolation, or generated frames — every output frame is an
// existing source frame shown longer. Only predefined speeds whose
// effective frame rate stays at or above MIN_EFFECTIVE_FPS are offered,
// computed per clip from its source fps.
import NumericStepper from './NumericStepper'

const MIN_EFFECTIVE_FPS = 12
const PRESET_SPEEDS = [1.0, 0.75, 0.5, 0.4, 0.25, 0.2]

// Room-tone level, in dB of gain applied to the room-tone asset. MIRRORS
// ffmpeg_utils.NOISE_GAIN_DB / _MIN / _MAX — the server clamps to the same
// numbers and rejects anything outside them, so these three are the only
// duplication and changing one side without the other shows up as a 400 rather
// than as a silently different render.
//
// The ceiling is measured, not chosen: the asset peaks at −24.92 dBFS, so +24 dB
// is the loudest the tone can be while still, on its own, not clipping.
export const NOISE_GAIN_DB_DEFAULT = 12
export const NOISE_GAIN_DB_MIN = -12
export const NOISE_GAIN_DB_MAX = 24

export function allowedSpeeds(sourceFps) {
  const fps = sourceFps || 30
  return PRESET_SPEEDS.filter(s => fps * s >= MIN_EFFECTIVE_FPS - 1e-9)
}

export default function SpeedForm({
  selectedClip, setClips, noiseEnabled = false, onToggleNoise,
  noiseGainDb = String(NOISE_GAIN_DB_DEFAULT), onSetNoiseGainDb,
}) {
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
      {/* Same divider the parent toolbar puts between its groups; mx-1.5 tops
          up this row's tighter gap-1.5 so the spacing around it matches. */}
      <div className="w-px h-3.5 mx-1.5 bg-neutral-700" />
      {/* Room tone. A render-wide setting, not a per-clip decision, so it needs
          no selected clip and is never marked dirty — at render time it fills
          the sequence's SILENT stretches with room tone and leaves everything
          else exactly as it was, so it moves no clip audio, no A1 audio and no
          video frame (verified bit-identical). Amber matches the other
          render-affecting toggle (ANIM) rather than a clip-editing color. On
          state is carried by color alone — the label stays "A1 Room Tone"
          either way so the button never changes size. */}
      <button
        onClick={onToggleNoise}
        title={noiseEnabled
          ? 'Turn off room tone — every silent stretch renders as pure digital silence again. The dB setting is kept for next time'
          : 'Fill the silent stretches with room tone: holds, round-ups, slow-downs, clips whose source has no audio, gaps left by a removed A1 clip, and the tail past the end of a short A1 track. Set how loud with the dB arrows beside this button. Never plays over sound that is already there — clip audio and the A1 track come out untouched, at the same level, and no video frame changes. Applies at render time; the preview will not play it'}
        className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${
          noiseEnabled
            ? 'bg-amber-500 text-neutral-950 border-amber-500'
            : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-neutral-200'
        }`}
      >
        A1 Room Tone
      </button>
      {/* How loud the tone above is — the same ▲/▼ stepper the trim fields use,
          sitting next to the toggle it belongs to rather than next to A1 Render,
          since it changes what a V1 render contains too, not just the stem.
          Greyed out with the toggle off: it still SHOWS the level, so turning
          tone back on holds no surprise, but there is nothing to set until
          something is being filled.

          No text label: the value's own "dB" suffix says what it is, and it sits
          immediately after the button it belongs to. The tooltip carries the
          detail a word could not.

          min is passed explicitly because NumericStepper defaults it to 0, which
          would make the whole quieter-than-the-asset half unreachable by ▼. */}
      <NumericStepper
        value={noiseGainDb}
        onChange={onSetNoiseGainDb}
        step={1}
        min={NOISE_GAIN_DB_MIN}
        max={NOISE_GAIN_DB_MAX}
        disabled={!noiseEnabled}
        width="w-9"
        title={`How loud the room tone is, in dB of gain on the tone asset. ${NOISE_GAIN_DB_MIN} to +${NOISE_GAIN_DB_MAX} dB, default +${NOISE_GAIN_DB_DEFAULT}. 0 leaves the asset at its recorded level (about −25 dBFS peak); +${NOISE_GAIN_DB_MAX} is as loud as it goes without the tone clipping on its own. Only scales the tone — clip audio and the A1 track are never touched, whatever this is set to`}
      />
      <span className={`text-[9px] ${noiseEnabled ? 'text-neutral-500' : 'text-neutral-700'}`}>dB</span>
    </div>
  )
}
