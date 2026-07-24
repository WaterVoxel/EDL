import { useState } from 'react'
import { reverse as apiReverse } from '../api'

export default function ReverseForm({ selectedClip, onResult }) {
  const [loading, setLoading] = useState(false)

  async function run() {
    if (!selectedClip) return
    setLoading(true)
    let data = await apiReverse(selectedClip.sourceName)
    // The backend warns before buffering large/long clips in memory, but
    // this control is just "reverse the clip" — auto-confirm rather than
    // surfacing that as a blocking choice.
    if (data.warning) {
      data = await apiReverse(selectedClip.sourceName, true)
    }
    setLoading(false)
    if (data.error) {
      alert('Error: ' + data.error + (data.detail ? '\n' + data.detail : ''))
    } else {
      onResult(data.output)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">Reverse</span>
      {!selectedClip && <span className="text-[9px] text-neutral-600">select a clip</span>}
      <button
        onClick={run}
        disabled={!selectedClip || loading}
        className="px-1.5 py-0.5 text-[11px] rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        {loading ? '…' : 'Reverse'}
      </button>
    </div>
  )
}
