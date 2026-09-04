import { useState, useEffect } from 'react'
import NumericStepper from './NumericStepper'
import { retimeKeyframesForTrim } from '../cropAnimation'
import { trimLossSec } from '../clipMath'

// Formats/parses a source-time value in whichever unit the shared
// timecode/frames toggle (TransportBar) is currently set to, so Trim's
// In/Out fields always match what the transport clock shows.
function toDisplay(sec, mode, fps) {
  return mode === 'frames' ? String(Math.round(sec * fps)) : sec.toFixed(2)
}
function fromDisplay(value, mode, fps) {
  const n = parseFloat(value)
  if (Number.isNaN(n)) return NaN
  return mode === 'frames' ? n / fps : n
}

// `onFootageLoss` is null unless V1 is the focused track: this form writes
// through `setActiveClips`, so it edits whichever lane has focus, and only V1's
// losses matter to Reconstruct. App.jsx does that gating.
export default function TrimForm({ selectedClip, setClips, displayMode = 'timecode', onFootageLoss = null }) {
  const [inVal, setInVal] = useState('')
  const [outVal, setOutVal] = useState('')
  const fps = selectedClip?.fps || 24

  useEffect(() => {
    if (selectedClip) {
      setInVal(toDisplay(selectedClip.inSec, displayMode, fps))
      setOutVal(toDisplay(selectedClip.outSec, displayMode, fps))
    } else {
      setInVal('')
      setOutVal('')
    }
  }, [selectedClip?.id, selectedClip?.inSec, selectedClip?.outSec, displayMode, fps])

  function apply() {
    if (!selectedClip) return
    const newIn = fromDisplay(inVal, displayMode, fps)
    const newOut = fromDisplay(outVal, displayMode, fps)
    if (Number.isNaN(newIn) || Number.isNaN(newOut)) return
    const clampedIn = Math.max(0, Math.min(newIn, selectedClip.sourceDurationSec - 0.1))
    const clampedOut = Math.min(selectedClip.sourceDurationSec, Math.max(newOut, clampedIn + 0.1))
    // Report against the CLAMPED values, so the number the warning shows is the
    // footage actually dropped rather than what was typed. No gesture token:
    // this is one discrete Apply, not a drag, so App warns immediately.
    // `reset()` needs no equivalent — widening back to the full source produces
    // a negative delta, which is silent by construction.
    if (onFootageLoss) {
      onFootageLoss({
        deltaSec: trimLossSec(selectedClip, clampedIn, clampedOut),
        gesture: null,
        sourceName: selectedClip.sourceName,
      })
    }
    // Crop keyframes are indexed from inSec, so a trim has to rebase them —
    // see cropAnimation.retimeKeyframesForTrim (an out-of-range keyframe
    // makes Render fail validation outright).
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id
        ? {
            ...c,
            inSec: clampedIn,
            outSec: clampedOut,
            cropKeyframes: retimeKeyframesForTrim(c.cropKeyframes, c.inSec, clampedIn, clampedOut),
            dirty: true,
          }
        : c
    ))
  }

  function reset() {
    if (!selectedClip) return
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id
        ? {
            ...c,
            inSec: 0,
            outSec: c.sourceDurationSec,
            cropKeyframes: retimeKeyframesForTrim(c.cropKeyframes, c.inSec, 0, c.sourceDurationSec),
            dirty: true,
          }
        : c
    ))
  }

  const disabled = !selectedClip
  const maxDisplay = selectedClip
    ? (displayMode === 'frames' ? Math.round(selectedClip.sourceDurationSec * fps) : selectedClip.sourceDurationSec)
    : Infinity

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">Trim</span>
      <NumericStepper
        value={inVal}
        onChange={setInVal}
        step={displayMode === 'frames' ? 1 : 0.01}
        min={0}
        max={maxDisplay}
        disabled={disabled}
        title="Or drag the clip's edges directly on the timeline"
      />
      <span className="text-[8px] text-neutral-500">–</span>
      <NumericStepper
        value={outVal}
        onChange={setOutVal}
        step={displayMode === 'frames' ? 1 : 0.01}
        min={0}
        max={maxDisplay}
        disabled={disabled}
        title="Or drag the clip's edges directly on the timeline"
      />
      <button
        onClick={apply}
        disabled={disabled}
        className="px-1.5 py-0.5 text-[8px] rounded bg-indigo-300/15 border border-indigo-300/50 text-indigo-200 hover:bg-indigo-300/25 disabled:bg-transparent disabled:border-neutral-700 disabled:text-neutral-600"
      >
        Apply
      </button>
      <button
        onClick={reset}
        disabled={disabled}
        className="px-1.5 py-0.5 text-[8px] rounded border border-neutral-700 text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
      >
        Reset
      </button>
    </div>
  )
}
