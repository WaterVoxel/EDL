import { useState } from 'react'
import { holdFrame } from '../api'

export default function HoldFrameForm({ inputFiles, onResult }) {
  const [source, setSource] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!source || time === '' || duration === '') return
    setLoading(true)
    const data = await holdFrame(source, parseFloat(time), parseFloat(duration))
    setLoading(false)
    if (data.error) alert('Error: ' + data.error + (data.detail ? '\n' + data.detail : ''))
    else onResult(data.output)
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 rounded-md border border-neutral-700 bg-neutral-800/50">
      <h3 className="text-xs font-semibold text-neutral-300 mb-2">Hold Frame</h3>
      <select value={source} onChange={e => setSource(e.target.value)} className="w-full mb-2 px-2 py-1 text-xs rounded bg-neutral-900 border border-neutral-600 text-neutral-300">
        <option value="">Select file...</option>
        {inputFiles.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
      </select>
      <div className="flex gap-2">
        <input type="number" step="0.1" placeholder="Time (s)" value={time} onChange={e => setTime(e.target.value)} className="flex-1 px-2 py-1 text-xs rounded bg-neutral-900 border border-neutral-600 text-neutral-300" />
        <input type="number" step="0.1" placeholder="Duration (s)" value={duration} onChange={e => setDuration(e.target.value)} className="flex-1 px-2 py-1 text-xs rounded bg-neutral-900 border border-neutral-600 text-neutral-300" />
      </div>
      <button type="submit" disabled={loading} className="mt-2 px-3 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-600">
        {loading ? 'Processing...' : 'Hold Frame'}
      </button>
    </form>
  )
}
