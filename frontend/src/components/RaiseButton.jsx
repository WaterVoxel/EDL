import { sequenceRaise } from '../clipMath'

// Raise rounds up the *whole sequence's* total duration, always by holding
// the last frame of the last clip — never an individual clip in isolation,
// since what matters is the final program length landing on a whole second.
//
// It measures the RENDER's length, not the timeline's arithmetic length: they
// differ by up to half a frame per clip, and a slow-down multiplies that. When
// Raise measured the timeline it would offer a round-up on an already-whole
// render — and applying it pushed the render a frame past the whole second it
// advertised — and call a non-whole render "whole". See gotchas.md.
export default function RaiseButton({ clips, setClips }) {
  const { baseSec: base, amountSec: amount, wholeSec, exact } = sequenceRaise(clips)
  const lastClip = clips[clips.length - 1] || null

  function apply() {
    if (!lastClip || amount <= 0) return
    setClips(prev => prev.map(c =>
      c.id === lastClip.id ? { ...c, roundHoldSec: amount, dirty: true } : c
    ))
  }

  // No "Raise" text label: the button's own "Round Up" says what it does, and
  // the readout sits AFTER the button so the amber "+0.83s → 11s" reads as the
  // result of pressing it rather than as a heading in front of it.
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={apply}
        disabled={amount <= 0}
        title={exact
          ? 'Hold the last frame of the sequence to round its total duration up to the next whole second'
          : `Holds the last frame to reach ${wholeSec}s. The whole second isn't exactly reachable here — `
            + `the hold is quantized on the last clip's own frame rate, so the render lands a frame or two `
            + `past ${wholeSec}s rather than on it (never short of it).`}
        className="px-1.5 py-0.5 text-[8px] rounded bg-amber-600 text-white hover:bg-amber-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Round Up
      </button>
      {clips.length === 0 ? (
        <span className="text-[8px] text-neutral-600">no clips</span>
      ) : amount <= 0 ? (
        <span className="text-[8px] text-neutral-600">whole ({base.toFixed(1)}s)</span>
      ) : (
        // "≈" when the render can't land exactly on the second — see the tooltip.
        <span className="text-[8px] text-amber-400 whitespace-nowrap">+{amount.toFixed(2)}s → {exact ? '' : '≈'}{wholeSec.toFixed(0)}s</span>
      )}
    </div>
  )
}
