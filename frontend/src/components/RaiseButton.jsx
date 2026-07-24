import { clipBaseSec, roundUpAmount } from '../clipMath'

export default function RaiseButton({ selectedClip, setClips }) {
  const base = selectedClip ? clipBaseSec(selectedClip) : 0
  const amount = selectedClip ? roundUpAmount(base) : 0

  function apply() {
    if (!selectedClip || amount <= 0) return
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id ? { ...c, roundHoldSec: amount, dirty: true } : c
    ))
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3 flex flex-col">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">Raise</h3>
      {!selectedClip && <p className="text-[10px] text-neutral-600 mb-2">Select a clip on the timeline first.</p>}
      {selectedClip && amount <= 0 && (
        <p className="text-[10px] text-neutral-600 mb-2">Duration already whole ({base.toFixed(1)}s).</p>
      )}
      {selectedClip && amount > 0 && (
        <p className="text-[10px] text-amber-400 mb-2">
          Hold last frame {amount.toFixed(2)}s → {(base + amount).toFixed(0)}s total.
        </p>
      )}
      <button
        onClick={apply}
        disabled={!selectedClip || amount <= 0}
        className="mt-auto px-3 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Round Up
      </button>
    </div>
  )
}
