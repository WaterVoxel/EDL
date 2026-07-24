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
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">Reverse</h3>
      {!selectedClip && <p className="text-[10px] text-neutral-600 mb-2">Select a clip on the timeline first.</p>}
      {warning && (
        <div className="mb-2 p-2 text-[10px] rounded bg-amber-900/30 border border-amber-600 text-amber-300">
          {warning}
          <button type="button" onClick={() => run(true)} className="ml-2 underline">Confirm anyway</button>
        </div>
      )}
      <button
        onClick={() => run(false)}
        disabled={!selectedClip || loading}
        className="w-full px-3 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        {loading ? 'Processing...' : 'Reverse'}
      </button>
    </div>
  )
}
