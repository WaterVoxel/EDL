import { probe } from '../api'
import { useMedia } from '../context/MediaContext'

export default function MediaLibrary({ files, onAddToTimeline }) {
  const { setActivePreview, videoRef } = useMedia()

  function handleClick(name) {
    probe(name, 'input').then(info => {
      const url = info.browser_playable === false
        ? `/preview/input/${encodeURIComponent(name)}`
        : `/input/${encodeURIComponent(name)}`
      if (videoRef.current) videoRef.current.src = url
      setActivePreview({ name, dir: 'input', info })
    })
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-neutral-300 mb-2">Input Files</h2>
      <ul className="max-h-40 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-800/50">
        {files.map(f => (
          <li key={f.name} className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-neutral-700/50 last:border-0 hover:bg-neutral-700/50 cursor-pointer">
            <span className="truncate" onClick={() => handleClick(f.name)}>{f.name}</span>
            <button
              onClick={() => onAddToTimeline(f.name)}
              className="ml-2 px-2 py-0.5 text-[10px] rounded bg-indigo-600 text-white hover:bg-indigo-500 shrink-0"
            >+ Add</button>
          </li>
        ))}
        {files.length === 0 && <li className="px-3 py-2 text-xs text-neutral-500">No files yet</li>}
      </ul>
    </div>
  )
}
