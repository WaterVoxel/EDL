import { useEffect, useRef, useState } from 'react'
import { probe, clearOutput } from '../api'
import TechInfoPanel from './TechInfoPanel'
import DownloadButton from './DownloadButton'
import ClearButton from './ClearButton'

export default function OutputPanel({ files, onCleared }) {
  const videoRef = useRef(null)
  const [selectedName, setSelectedName] = useState(null)
  const [info, setInfo] = useState(null)

  function loadOutput(name) {
    probe(name, 'output').then(data => {
      const url = data.browser_playable === false
        ? `/preview/output/${encodeURIComponent(name)}`
        : `/output/${encodeURIComponent(name)}`
      if (videoRef.current) videoRef.current.src = url
      setInfo({ ...data, _name: name })
      setSelectedName(name)
    })
  }

  // Auto-show the most recently rendered output whenever the list changes
  // (e.g. right after clicking Render), so the right column always reflects
  // the latest render without requiring a manual click.
  useEffect(() => {
    if (files.length === 0) {
      setSelectedName(null)
      setInfo(null)
      return
    }
    const latest = files[files.length - 1]
    loadOutput(latest.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length])

  function handleClear() {
    clearOutput().then(() => {
      if (videoRef.current) videoRef.current.removeAttribute('src')
      setSelectedName(null)
      setInfo(null)
      onCleared()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md bg-black border border-neutral-800 flex items-center justify-center aspect-video max-h-[38vh]">
        <video ref={videoRef} controls className="max-w-full max-h-full" />
      </div>
      <TechInfoPanel info={info} />
      <DownloadButton outputName={selectedName} />
      <div className="rounded-md bg-neutral-900 border border-neutral-800">
        <div className="flex items-center justify-between px-2 py-1 border-b border-neutral-800">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Exports</span>
          <ClearButton
            label="Clear"
            confirmText="Delete all files in output/? This cannot be undone."
            onClear={handleClear}
          />
        </div>
        <ul className="max-h-56 overflow-y-auto divide-y divide-neutral-800">
          {files.map(f => (
            <li
              key={f.name}
              onClick={() => loadOutput(f.name)}
              className={`px-2 py-1 text-[11px] cursor-pointer truncate ${f.name === selectedName ? 'bg-indigo-900/40 text-indigo-300' : 'text-neutral-300 hover:bg-neutral-800/70'}`}
            >
              <div>{f.name}</div>
              {f.modified && (
                <div className="text-[9px] text-neutral-500">{new Date(f.modified * 1000).toLocaleString()}</div>
              )}
            </li>
          ))}
          {files.length === 0 && <li className="px-2 py-2 text-[11px] text-neutral-600 text-center">No exports yet</li>}
        </ul>
      </div>
    </div>
  )
}
