import { useState } from 'react'
import { reverse as apiReverse } from '../api'

export default function ReverseForm({ selectedClip, onResult }) {
  const [loading, setLoading] = useState(false)
  const [warning, setWarning] = useState(null)

  async function run(confirm = false) {
    if (!selectedClip) return
    setLoading(true)
    setWarning(null)
    const data = await apiReverse(selectedClip.sourceName, confirm || undefined)
    setLoading(false)
    if (data.warning) {
      setWarning(data.warning)
    } else if (data.error) {
      alert('Error: ' + data.error + (data.detail ? '\n' + data.detail : ''))
    } else {
      onResult(data.output)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">Reverse</span>
      {!selectedClip && <span className="text-[10px] text-neutral-600">select a clip</span>}
      {warning && (
        <div className="flex items-center gap-1 text-[10px] text-amber-300">
          <span>{warning}</span>
          <button type="button" onClick={() => run(true)} className="underline shrink-0">Confirm</button>
        </div>
      )}
      <button
        onClick={() => run(false)}
        disabled={!selectedClip || loading}
        className="px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        {loading ? '…' : 'Reverse'}
      </button>
    </div>
  )
}
