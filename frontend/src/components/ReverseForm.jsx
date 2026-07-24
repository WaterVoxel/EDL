import { useState } from 'react'
import { reverse as apiReverse } from '../api'

export default function ReverseForm({ inputFiles, onResult }) {
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(false)
  const [warning, setWarning] = useState(null)

  async function handleSubmit(e, confirm = false) {
    e.preventDefault()
    if (!source) return
    setLoading(true)
    setWarning(null)
    const data = await apiReverse(source, confirm || undefined)
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
    <form onSubmit={handleSubmit} className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">Reverse</h3>
      <select value={source} onChange={e => setSource(e.target.value)} className="w-full mb-2 px-2 py-1 text-xs rounded bg-neutral-900 border border-neutral-600 text-neutral-300">
        <option value="">Select file...</option>
        {inputFiles.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
      </select>
      {warning && (
        <div className="mb-2 p-2 text-[10px] rounded bg-amber-900/30 border border-amber-600 text-amber-300">
          {warning}
          <button type="button" onClick={e => handleSubmit(e, true)} className="ml-2 underline">Confirm anyway</button>
        </div>
      )}
      <button type="submit" disabled={loading} className="px-3 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-600">
        {loading ? 'Processing...' : 'Reverse'}
      </button>
    </form>
  )
}
