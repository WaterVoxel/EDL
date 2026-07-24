import { probe, clearInput } from '../api'
import { useMedia } from '../context/MediaContext'
import ClearButton from './ClearButton'

export default function MediaLibrary({ files, onAddToTimeline, onCleared }) {
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
      <div className="flex items-center justify-between px-2 py-1 border-b border-neutral-800">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Media Bin</span>
        <ClearButton
          label="Clear"
          confirmText="Delete all files in input/? This cannot be undone."
          onClear={() => clearInput().then(() => onCleared())}
        />
      </div>
      <ul className="max-h-36 overflow-y-auto divide-y divide-neutral-800">
        {files.map(f => (
          <li key={f.name} className="flex items-center justify-between gap-1.5 px-2 py-1 text-[11px] hover:bg-neutral-800/70">
            <button onClick={() => handleClick(f.name)} className="flex-1 flex items-center gap-1.5 min-w-0 text-left">
              <span className="w-4 h-4 shrink-0 rounded bg-neutral-700 flex items-center justify-center text-[8px] text-neutral-400">▶</span>
              <span className="truncate text-neutral-300">{f.name}</span>
            </button>
            <button
              onClick={() => onAddToTimeline(f.name)}
              title="Add to timeline"
              className="shrink-0 w-4 h-4 flex items-center justify-center rounded bg-indigo-600 text-white hover:bg-indigo-500 text-[11px] leading-none"
            >+</button>
          </li>
        ))}
        {files.length === 0 && <li className="px-2 py-2 text-[11px] text-neutral-600 text-center">No files yet</li>}
      </ul>
    </div>
  )
}
