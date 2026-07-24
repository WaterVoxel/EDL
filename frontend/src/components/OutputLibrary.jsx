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
    <div>
      <h2 className="text-sm font-semibold text-neutral-300 mb-2">Results</h2>
      <ul className="max-h-40 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-800/50">
        {files.map(f => (
          <li
            key={f.name}
            onClick={() => handleClick(f.name)}
            className={`px-3 py-1.5 text-xs border-b border-neutral-700/50 last:border-0 cursor-pointer truncate ${f.name === selectedOutput ? 'bg-indigo-900/50' : 'hover:bg-neutral-700/50'}`}
          >
            {f.name}
          </li>
        ))}
        {files.length === 0 && <li className="px-3 py-2 text-xs text-neutral-500">No outputs yet</li>}
      </ul>
    </div>
  )
}
