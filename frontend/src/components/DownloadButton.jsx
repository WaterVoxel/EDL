import { useState } from 'react'
import { probe } from '../api'

export default function DownloadButton({ outputName, onInfoRefresh, compact = false }) {
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  if (!outputName) return null

  async function handleDownload() {
    setLoading(true)
    setStatus('Verifying...')
    try {
      const info = await probe(outputName, 'output')
      if (info.error) { setStatus('Error: ' + info.error); return }
      if (onInfoRefresh) onInfoRefresh(info)

      const link = document.createElement('a')
      link.href = `/output/${encodeURIComponent(outputName)}`
      link.setAttribute('download', outputName)
      document.body.appendChild(link)
      link.click()
      link.remove()

      setStatus(
        `Downloaded — ${info.format_name || '?'}, ${info.width}×${info.height}, ` +
        `${info.fps ? info.fps.toFixed(2) : '?'} fps, ${info.video_codec || '?'}, ` +
        `${info.audio_codec || 'no audio'}` +
        (info.audio_codec ? ` @ ${info.audio_sample_rate || '?'} Hz / ${info.audio_channels || '?'}ch` : '') +
        `, ${info.bit_rate ? Math.round(info.bit_rate / 1000) + ' kb/s' : '?'}`
      )
    } catch {
      setStatus('Download verification failed.')
    } finally {
      setLoading(false)
    }
  }

  if (compact) {
    return (
      <button
        onClick={handleDownload}
        disabled={loading}
        title={status || 'Download the selected export'}
        className="px-2.5 py-1 text-[9px] rounded bg-neutral-700 text-neutral-400 hover:text-neutral-200 disabled:bg-neutral-600 disabled:cursor-default"
      >
        ↓ Download
      </button>
    )
  }

  return (
    <div className="mt-2">
      <button
        onClick={handleDownload}
        disabled={loading}
        className="px-2.5 py-1 text-[9px] rounded bg-neutral-700 text-neutral-400 hover:text-neutral-200 disabled:bg-neutral-600 disabled:cursor-default"
      >
        ↓ Download
      </button>
      {status && <p className="mt-1 text-[9px] text-neutral-400">{status}</p>}
    </div>
  )
}
