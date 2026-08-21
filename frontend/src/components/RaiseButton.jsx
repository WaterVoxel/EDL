import { sequenceBaseSec, roundUpAmount } from '../clipMath'

// Raise rounds up the *whole sequence's* total duration, always by holding
// the last frame of the last clip — never an individual clip in isolation,
// since what matters is the final program length landing on a whole second.
export default function RaiseButton({ clips, setClips }) {
  const base = sequenceBaseSec(clips)
  const amount = clips.length > 0 ? roundUpAmount(base) : 0
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
        title="Hold the last frame of the sequence to round its total duration up to the next whole second"
        className="px-1.5 py-0.5 text-[8px] rounded bg-amber-600 text-white hover:bg-amber-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Round Up
      </button>
      {clips.length === 0 ? (
        <span className="text-[8px] text-neutral-600">no clips</span>
      ) : amount <= 0 ? (
        <span className="text-[8px] text-neutral-600">whole ({base.toFixed(1)}s)</span>
      ) : (
        <span className="text-[8px] text-amber-400 whitespace-nowrap">+{amount.toFixed(2)}s → {(base + amount).toFixed(0)}s</span>
      )}
    </div>
  )
}
