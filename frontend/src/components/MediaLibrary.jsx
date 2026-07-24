import { probe } from '../api'
import { useMedia } from '../context/MediaContext'
import { formatSeconds } from '../timecode'

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
    <div className="rounded-md bg-neutral-900 border border-neutral-800">
      <div className="px-2.5 py-1.5 border-b border-neutral-800 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Media Bin
      </div>
      <ul className="max-h-44 overflow-y-auto divide-y divide-neutral-800">
        {files.map(f => (
          <li key={f.name} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs hover:bg-neutral-800/70">
            <button onClick={() => handleClick(f.name)} className="flex-1 flex items-center gap-2 min-w-0 text-left">
              <span className="w-6 h-6 shrink-0 rounded bg-neutral-700 flex items-center justify-center text-[10px] text-neutral-400">▶</span>
              <span className="truncate text-neutral-300">{f.name}</span>
            </button>
            <button
              onClick={() => onAddToTimeline(f.name)}
              title="Add to timeline"
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-indigo-600 text-white hover:bg-indigo-500 text-sm leading-none"
            >+</button>
          </li>
        ))}
        {files.length === 0 && <li className="px-2.5 py-3 text-xs text-neutral-600 text-center">No files yet</li>}
      </ul>
    </div>
  )
}
