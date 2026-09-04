// Retime control: scales frame timing (setpts) without interpolation or
// generated frames. Below 1× every output frame is an existing source frame
// shown longer; above 1× the same PTS scaling runs the other way and the fps
// normalization drops frames instead of repeating them. Nothing is ever
// invented in either direction.
import NumericStepper from './NumericStepper'

// Floor on the SLOW side only — it is a picture rule about a frame held too
// long, and a speed-up raises the effective rate rather than lowering it, so
// applying this to the fast half would rule out the whole half.
const MIN_EFFECTIVE_FPS = 12
// Mirrors app.py MAX_SPEED, which both render routes enforce with a 400. No
// preset below is near it; it is here so that adding one can't outrun the
// server.
const MAX_SPEED = 10

// The speed-ups are the exact RECIPROCALS of the slow-downs, not a fresh set of
// round numbers: reciprocals are the operation's own inverse, so 50% then 200%
// on the same shot is a verified byte-identical round trip (gotchas.md), and
// each one lands on a whole multiple of the source rate the way the slow-downs
// land on whole divisions of it — 24 fps footage reads 12 / 18 / 24 / 32 / 48,
// not 24 / 36 / 24.
//
// Only the first two slow-downs get a counterpart, by request: 2.5×/4×/5× were
// offered briefly and taken back out. The render accepts them (up to MAX_SPEED)
// and V2 Reconstruct still EMITS them to undo a deep V1 slow-down, so dropping
// them from this list narrows the menu without narrowing the app — a clip
// carrying one still displays it, through the not-a-preset branch below. Slicing
// SLOW_SPEEDS rather than writing [1.3333…, 2] literally keeps the two halves
// exact inverses of each other by construction.
const SLOW_SPEEDS = [0.75, 0.5, 0.4, 0.25, 0.2]
const FAST_SPEEDS = SLOW_SPEEDS.slice(0, 2).map(s => 1 / s)
// Fastest first, descending through 100% to slowest — one monotonic ladder, so
// the percentages and the fps beside them both read in order. 100% is no longer
// the first entry, which only matters for the <select>-falls-back-to-its-first-
// option case handled below.
const PRESET_SPEEDS = [...FAST_SPEEDS.slice().reverse(), 1.0, ...SLOW_SPEEDS]

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

// Which presets this clip may use. A slow-down has to keep the effective rate
// at or above the floor; a speed-up has no equivalent quality limit (it only
// ever drops frames, and the output rate is unchanged) so the only bound on it
// is the server's.
export function allowedSpeeds(sourceFps) {
  const fps = sourceFps || 30
  return PRESET_SPEEDS.filter(s => (s > 1
    ? s <= MAX_SPEED + 1e-9
    : fps * s >= MIN_EFFECTIVE_FPS - 1e-9))
}

export default function SpeedForm({
  selectedClip, setClips, noiseEnabled = false, onToggleNoise,
  noiseGainDb = String(NOISE_GAIN_DB_DEFAULT), onSetNoiseGainDb,
}) {
  const presets = selectedClip ? allowedSpeeds(selectedClip.fps) : [1.0]
  const current = selectedClip?.speed && selectedClip.speed > 0 ? selectedClip.speed : 1
  // A clip can carry a speed no preset offers, and V2 Reconstruct is the common
  // way in: it un-stretches a 0.4×/0.25×/0.2× V1 slow-down to 2.5×/4×/5×, none of
  // which are on this menu. (Also a slow-down the 12 fps floor rules out for THIS
  // clip's source rate, or a project saved when the preset list differed.) A
  // <select> whose value matches no option silently shows its FIRST one instead,
  // so such a clip would read 200% while rendering at 5×; list the real value
  // rather than let the control state a number that isn't the clip's. Sorted in,
  // not prepended, so the ladder stays monotonic.
  const speeds = presets.includes(current)
    ? presets
    : [...presets, current].sort((a, b) => b - a)

  function apply(speed) {
    if (!selectedClip) return
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id ? { ...c, speed, dirty: true } : c
    ))
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">Speed</span>
      {!selectedClip && <span className="text-[8px] text-neutral-600">select a clip</span>}
      {selectedClip && (
        <select
          value={String(current)}
          onChange={e => apply(parseFloat(e.target.value))}
          title={`Retime this clip by scaling frame timing — nothing is interpolated or generated in either direction. Under 100% slows down: existing frames are held longer, and the fps beside each option is the rate the source is read at, kept at or above ${MIN_EFFECTIVE_FPS} fps for this clip's ${(selectedClip.fps || 30).toFixed(0)} fps source. Over 100% speeds up by the exact reciprocals, reading the source faster and dropping frames instead of holding them — so 50% and 200% on the same shot cancel out exactly. The rendered file keeps its own frame rate whichever way you go, and a retimed clip renders silent (a slowed or sped-up soundtrack is out of scope), so use A1 Room Tone or the A1 track for sound over it.`}
          className={`px-1 py-0.5 text-[8px] rounded bg-neutral-950 border text-neutral-300 ${current !== 1 ? 'border-orange-500' : 'border-neutral-700'}`}
        >
          {/* One fps formula for both halves: `source fps × speed` is the rate
              the SOURCE is read at, which is the number that actually changes —
              12 fps at 50% on 24 fps footage, 48 fps at 200%. The rendered
              file's own frame rate never moves, so labelling that instead would
              print the same number on every row. */}
          {speeds.map(s => (
            <option key={s} value={String(s)}>
              {Math.round(s * 100)}%
              {s !== 1 ? ` (${((selectedClip.fps || 30) * s).toFixed(1).replace(/\.0$/, '')} fps)` : ''}
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
          either way so the button never changes size.

          Styled with the flat tint + hairline recipe the rest of this toolbar row
          uses (see conventions.md), which it missed when the row was flattened in
          0.68.0: it was the last solid `bg-amber-500` fill left among eleven
          outlined buttons, so ON read as a different KIND of control rather than as
          the same control switched on. Both states keep amber — the tint carries
          the on state now, and OFF is the row's standard neutral. */}
      <button
        onClick={onToggleNoise}
        title={noiseEnabled
          ? 'Turn off room tone — every silent stretch renders as pure digital silence again. The dB setting is kept for next time'
          : 'Fill the silent stretches with room tone: holds, round-ups, slow-downs, clips whose source has no audio, gaps left by a removed A1 clip, and the tail past the end of a short A1 track. Set how loud with the dB arrows beside this button. Never plays over sound that is already there — clip audio and the A1 track come out untouched, at the same level, and no video frame changes. Applies at render time; the preview will not play it'}
        className={`px-1.5 py-0.5 text-[8px] rounded border transition-colors ${
          noiseEnabled
            ? 'bg-amber-300/15 border-amber-300/50 text-amber-200 hover:bg-amber-300/25'
            : 'bg-transparent border-neutral-700 text-neutral-400 hover:text-neutral-200'
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
      <span className={`text-[8px] ${noiseEnabled ? 'text-neutral-500' : 'text-neutral-700'}`}>dB</span>
    </div>
  )
}
