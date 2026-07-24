import { useState } from 'react'
import { holdFrame } from '../api'

const MIN_TAIL_OFFSET = 0.05

export default function HoldFrameForm({ selectedClip, onResult }) {
  const [duration, setDuration] = useState('1')
  const [loading, setLoading] = useState(null) // 'head' | 'tail' | null

  async function run(which) {
    if (!selectedClip) return
    const dur = parseFloat(duration)
    if (!dur || dur <= 0) return
    setLoading(which)
    const time = which === 'head'
      ? selectedClip.inSec
      : Math.max(selectedClip.inSec, selectedClip.outSec - MIN_TAIL_OFFSET)
    const data = await holdFrame(selectedClip.sourceName, time, dur)
    setLoading(null)
    if (data.error) alert('Error: ' + data.error + (data.detail ? '\n' + data.detail : ''))
    else onResult(data.output)
  }

  const disabled = !selectedClip || loading !== null

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">Hold Frame</h3>
      {!selectedClip && <p className="text-[10px] text-neutral-600 mb-2">Select a clip on the timeline first.</p>}
      <div className="flex items-center gap-2">
        <input
          type="number" step="0.1" min="0.1" value={duration}
          onChange={e => setDuration(e.target.value)}
          className="w-16 px-2 py-1 text-xs rounded bg-neutral-950 border border-neutral-700 text-neutral-300"
        />
        <span className="text-[10px] text-neutral-500">sec</span>
        <button
          onClick={() => run('head')}
          disabled={disabled}
          className="flex-1 px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500"
        >
          {loading === 'head' ? '…' : 'Head'}
        </button>
        <button
          onClick={() => run('tail')}
          disabled={disabled}
          className="flex-1 px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500"
        >
          {loading === 'tail' ? '…' : 'Tail'}
        </button>
      </div>
    </div>
  )
}
