import { useEffect, useRef, useState } from 'react'
import { probe, clearOutput, revealFile, renameOutput } from '../api'
import TechInfoPanel from './TechInfoPanel'
import DownloadButton from './DownloadButton'
import ClearButton from './ClearButton'
import SortFilterBar from './SortFilterBar'
import ExportSettings from './ExportSettings'
import ContextMenu from './ContextMenu'
import { loadFavorites, toggleFavorite, sortFiles, filterFiles } from '../fileList'

export default function OutputPanel({ files, onCleared }) {
  const videoRef = useRef(null)
  const [selectedName, setSelectedName] = useState(null)
  const [info, setInfo] = useState(null)
  const [favorites, setFavorites] = useState(() => loadFavorites('output'))
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [showSettings, setShowSettings] = useState(false)
  const [contextMenu, setContextMenu] = useState(null) // {position, name}

  function handleContextMenu(e, name) {
    if (!name) return
    e.preventDefault()
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, name })
  }

  async function handleShowDestination(name) {
    const result = await revealFile(name)
    if (result.error) alert('Could not show file: ' + result.error)
  }

  async function handleRename(name) {
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const input = window.prompt('Rename export to:', stem)
    if (input == null) return
    const trimmed = input.trim()
    if (!trimmed || trimmed === stem) return
    const result = await renameOutput(name, trimmed)
    if (result.error) { alert('Rename failed: ' + result.error); return }
    // Re-point the current selection at the new name so the preview/info
    // panel stay on the same file, then refresh the list from disk.
    if (name === selectedName) loadOutput(result.name)
    onCleared()
  }

  useEffect(() => { setFavorites(loadFavorites('output')) }, [])

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
  // the latest render without requiring a manual click. This only ever
  // shows a file that's already in `files` (i.e. already finished writing
  // and reported back by /api/outputs) — nothing is shown mid-render.
  useEffect(() => {
    if (files.length === 0) {
      setSelectedName(null)
      setInfo(null)
      return
    }
    const latest = [...files].sort((a, b) => b.modified - a.modified)[0]
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

  function handleToggleFavorite(name) {
    setFavorites(toggleFavorite('output', name, favorites))
  }

  const visible = sortFiles(filterFiles(files, query), favorites, sortBy, sortDir)

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div
        onContextMenu={e => handleContextMenu(e, selectedName)}
        className="shrink-0 rounded-md bg-black border border-neutral-800 flex items-center justify-center aspect-video max-h-[38vh]"
      >
        <video ref={videoRef} controls className="w-full h-full object-contain" />
      </div>
      <div className="shrink-0">
        <TechInfoPanel info={info} title="Media Info Out" />
      </div>
      {/* Fills whatever room is left below Media Info Out, pinning its own
          bottom to the bottom of the column, rather than stopping at a
          fixed height. */}
      <div className="flex-1 min-h-0 flex flex-col rounded-md bg-neutral-900 border border-neutral-800">
        <div className="shrink-0 flex items-center justify-between px-2 py-1 border-b border-neutral-800">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Export Bin</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(true)}
              title="Export settings"
              className="w-4 h-4 flex items-center justify-center rounded text-[11px] text-neutral-500 hover:text-white hover:bg-neutral-700"
            >⚙</button>
            <ClearButton
              label="Clear"
              confirmText="Delete all files in output/? This cannot be undone."
              onClear={handleClear}
            />
            <DownloadButton outputName={selectedName} compact />
          </div>
        </div>
        {showSettings && <ExportSettings onClose={() => setShowSettings(false)} />}
        <div className="shrink-0">
          <SortFilterBar
            query={query} onQueryChange={setQuery}
            sortBy={sortBy} onSortByChange={setSortBy}
            sortDir={sortDir} onSortDirChange={setSortDir}
          />
        </div>
        <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-neutral-800">
          {visible.map(f => (
            <li
              key={f.name}
              onContextMenu={e => handleContextMenu(e, f.name)}
              className={`flex items-start gap-1.5 px-2 py-1 text-[11px] cursor-pointer ${f.name === selectedName ? 'bg-indigo-900/40 text-indigo-300' : 'text-neutral-300 hover:bg-neutral-800/70'}`}
            >
              <button
                onClick={e => { e.stopPropagation(); handleToggleFavorite(f.name) }}
                title="Favorite"
                className={`shrink-0 text-[11px] ${favorites.has(f.name) ? 'text-amber-400' : 'text-neutral-600 hover:text-neutral-400'}`}
              >★</button>
              <div className="flex-1 min-w-0 truncate" onClick={() => loadOutput(f.name)}>
                <div className="truncate text-[9px]">{f.name}</div>
                {f.modified && (
                  <div className="text-[9px] text-neutral-500">{new Date(f.modified * 1000).toLocaleString()}</div>
                )}
              </div>
            </li>
          ))}
          {visible.length === 0 && <li className="px-2 py-2 text-[11px] text-neutral-600 text-center">{files.length === 0 ? 'Export Bin is empty' : 'No matches'}</li>}
        </ul>
      </div>

      {contextMenu && (
        <ContextMenu
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          items={[
            { label: 'Rename', onClick: () => handleRename(contextMenu.name) },
            { label: 'Show destination', onClick: () => handleShowDestination(contextMenu.name) },
          ]}
        />
      )}
    </div>
  )
}
