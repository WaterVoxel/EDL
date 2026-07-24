import { useState } from 'react'

export default function HoldFrameForm({ selectedClip, setClips }) {
  const [duration, setDuration] = useState('1')

  function apply(which) {
    if (!selectedClip) return
    const dur = parseFloat(duration)
    if (Number.isNaN(dur) || dur < 0) return
    const field = which === 'head' ? 'headHoldSec' : 'tailHoldSec'
    // A duration of 0 removes any existing hold on that edge and restores
    // the clip to its original (un-extended) length.
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id ? { ...c, [field]: dur, dirty: true } : c
    ))
  }

  const disabled = !selectedClip

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">Hold Frame</h3>
      {!selectedClip && <p className="text-[10px] text-neutral-600 mb-2">Select a clip on the timeline first.</p>}
      <div className="flex items-center gap-2">
        <input
          type="number" step="0.1" min="0" value={duration}
          onChange={e => setDuration(e.target.value)}
          className="w-16 px-2 py-1 text-xs rounded bg-neutral-950 border border-neutral-700 text-neutral-300"
        />
        <span className="text-[10px] text-neutral-500">sec (0 = remove)</span>
        <button
          onClick={() => apply('head')}
          disabled={disabled}
          className="flex-1 px-2 py-1 text-xs rounded bg-fuchsia-700 text-white hover:bg-fuchsia-600 disabled:bg-neutral-700 disabled:text-neutral-500"
        >
          Head
        </button>
        <button
          onClick={() => apply('tail')}
          disabled={disabled}
          className="flex-1 px-2 py-1 text-xs rounded bg-fuchsia-700 text-white hover:bg-fuchsia-600 disabled:bg-neutral-700 disabled:text-neutral-500"
        >
          Tail
        </button>
      </div>
      {selectedClip && (selectedClip.headHoldSec > 0 || selectedClip.tailHoldSec > 0) && (
        <p className="mt-2 text-[10px] text-fuchsia-400">
          Head: {(selectedClip.headHoldSec || 0).toFixed(1)}s · Tail: {(selectedClip.tailHoldSec || 0).toFixed(1)}s — click Render to apply.
        </p>
      )}
    </div>
  )
}
