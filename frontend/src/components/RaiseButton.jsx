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

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">Raise</span>
      {clips.length === 0 ? (
        <span className="text-[10px] text-neutral-600">no clips</span>
      ) : amount <= 0 ? (
        <span className="text-[10px] text-neutral-600">whole ({base.toFixed(1)}s)</span>
      ) : (
        <span className="text-[10px] text-amber-400">+{amount.toFixed(2)}s → {(base + amount).toFixed(0)}s</span>
      )}
      <button
        onClick={apply}
        disabled={amount <= 0}
        title="Hold the last frame of the sequence to round its total duration up to the next whole second"
        className="px-2 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Round Up
      </button>
    </div>
  )
}
