import { useEffect, useRef, useState } from 'react'
import { probe } from '../api'
import TechInfoPanel from './TechInfoPanel'
import DownloadButton from './DownloadButton'

export default function OutputPanel({ files }) {
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

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md bg-black border border-neutral-800 flex items-center justify-center aspect-video">
        <video ref={videoRef} controls className="max-w-full max-h-full" />
      </div>
      <TechInfoPanel info={info} />
      <DownloadButton outputName={selectedName} />
      <div className="rounded-md bg-neutral-900 border border-neutral-800">
        <div className="px-2.5 py-1.5 border-b border-neutral-800 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          Exports
        </div>
        <ul className="max-h-32 overflow-y-auto divide-y divide-neutral-800">
          {files.map(f => (
            <li
              key={f.name}
              onClick={() => loadOutput(f.name)}
              className={`px-2.5 py-1.5 text-xs cursor-pointer truncate ${f.name === selectedName ? 'bg-indigo-900/40 text-indigo-300' : 'text-neutral-300 hover:bg-neutral-800/70'}`}
            >
              {f.name}
            </li>
          ))}
          {files.length === 0 && <li className="px-2.5 py-3 text-xs text-neutral-600 text-center">No exports yet</li>}
        </ul>
      </div>
    </div>
  )
}
