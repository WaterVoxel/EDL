import { useState, useEffect } from 'react'

export default function TrimForm({ selectedClip, setClips }) {
  const [inVal, setInVal] = useState('')
  const [outVal, setOutVal] = useState('')

  useEffect(() => {
    if (selectedClip) {
      setInVal(selectedClip.inSec.toFixed(2))
      setOutVal(selectedClip.outSec.toFixed(2))
    } else {
      setInVal('')
      setOutVal('')
    }
  }, [selectedClip?.id, selectedClip?.inSec, selectedClip?.outSec])

  function apply() {
    if (!selectedClip) return
    const newIn = parseFloat(inVal)
    const newOut = parseFloat(outVal)
    if (Number.isNaN(newIn) || Number.isNaN(newOut)) return
    const clampedIn = Math.max(0, Math.min(newIn, selectedClip.sourceDurationSec - 0.1))
    const clampedOut = Math.min(selectedClip.sourceDurationSec, Math.max(newOut, clampedIn + 0.1))
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id ? { ...c, inSec: clampedIn, outSec: clampedOut, dirty: true } : c
    ))
  }

  function reset() {
    if (!selectedClip) return
    setClips(prev => prev.map(c =>
      c.id === selectedClip.id ? { ...c, inSec: 0, outSec: c.sourceDurationSec, dirty: true } : c
    ))
  }

  const disabled = !selectedClip

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">Trim</span>
      <input
        type="number" step="0.01" min="0" placeholder="in" value={inVal}
        onChange={e => setInVal(e.target.value)}
        disabled={disabled}
        title="Or drag the clip's edges directly on the timeline"
        className="w-11 px-1.5 py-0.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-300 disabled:opacity-50"
      />
      <span className="text-[9px] text-neutral-500">–</span>
      <input
        type="number" step="0.01" min="0" placeholder="out" value={outVal}
        onChange={e => setOutVal(e.target.value)}
        disabled={disabled}
        title="Or drag the clip's edges directly on the timeline"
        className="w-11 px-1.5 py-0.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-300 disabled:opacity-50"
      />
      <button
        onClick={apply}
        disabled={disabled}
        className="px-1.5 py-0.5 text-[11px] rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Apply
      </button>
      <button
        onClick={reset}
        disabled={disabled}
        className="px-1.5 py-0.5 text-[11px] rounded border border-neutral-700 text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
      >
        Reset
      </button>
    </div>
  )
}
