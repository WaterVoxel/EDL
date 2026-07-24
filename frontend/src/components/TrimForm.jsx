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
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">Trim</h3>
      {!selectedClip && <p className="text-[10px] text-neutral-600 mb-2">Select a clip on the timeline first.</p>}
      <div className="flex items-center gap-2">
        <input
          type="number" step="0.01" min="0" placeholder="in" value={inVal}
          onChange={e => setInVal(e.target.value)}
          disabled={disabled}
          className="w-16 px-2 py-1 text-xs rounded bg-neutral-950 border border-neutral-700 text-neutral-300 disabled:opacity-50"
        />
        <span className="text-[10px] text-neutral-500">to</span>
        <input
          type="number" step="0.01" min="0" placeholder="out" value={outVal}
          onChange={e => setOutVal(e.target.value)}
          disabled={disabled}
          className="w-16 px-2 py-1 text-xs rounded bg-neutral-950 border border-neutral-700 text-neutral-300 disabled:opacity-50"
        />
        <button
          onClick={apply}
          disabled={disabled}
          className="flex-1 px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500"
        >
          Apply
        </button>
        <button
          onClick={reset}
          disabled={disabled}
          className="px-2 py-1 text-xs rounded border border-neutral-700 text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
        >
          Reset
        </button>
      </div>
      <p className="mt-2 text-[10px] text-neutral-600">Or drag the clip's edges directly on the timeline.</p>
    </div>
  )
}
