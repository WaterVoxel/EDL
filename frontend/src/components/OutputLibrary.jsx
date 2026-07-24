import { probe } from '../api'
import { useMedia } from '../context/MediaContext'

export default function OutputLibrary({ files, selectedOutput, onSelect }) {
  const { videoRef, setActivePreview } = useMedia()

  function handleClick(name) {
    probe(name, 'output').then(info => {
      const url = info.browser_playable === false
        ? `/preview/output/${encodeURIComponent(name)}`
        : `/output/${encodeURIComponent(name)}`
      if (videoRef.current) videoRef.current.src = url
      setActivePreview({ name, dir: 'output', info })
      onSelect(name)
    })
  }

  return (
    <div className="rounded-md bg-neutral-900 border border-neutral-800">
      <div className="px-2.5 py-1.5 border-b border-neutral-800 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Exports
      </div>
      <ul className="max-h-36 overflow-y-auto divide-y divide-neutral-800">
        {files.map(f => (
          <li
            key={f.name}
            onClick={() => handleClick(f.name)}
            className={`px-2.5 py-1.5 text-xs cursor-pointer truncate ${f.name === selectedOutput ? 'bg-indigo-900/40 text-indigo-300' : 'text-neutral-300 hover:bg-neutral-800/70'}`}
          >
            {f.name}
          </li>
        ))}
        {files.length === 0 && <li className="px-2.5 py-3 text-xs text-neutral-600 text-center">No exports yet</li>}
      </ul>
    </div>
  )
}
