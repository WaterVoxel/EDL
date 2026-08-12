import { useEffect, useRef, useState } from 'react'
import { probe, clearInput, deleteInputFile } from '../api'
import { useMedia } from '../context/MediaContext'
import ClearButton from './ClearButton'
import Dropzone from './Dropzone'
import SortFilterBar from './SortFilterBar'
import { loadFavorites, toggleFavorite, sortFiles, filterFiles, filterByTrack } from '../fileList'

const TRACK_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'v1', label: 'V1' },
  { key: 'v2', label: 'V2' },
]

export default function MediaLibrary({ files, trackTags = {}, onAddToTimeline, onCleared, onDeleted, onUpload, children }) {
  const { setBinSelection } = useMedia()
  // A dedicated preview box for source media — mirrors OutputPanel's own
  // video element (own ref, own <video>), independent of the shared
  // MediaContext videoRef the center editing preview/timeline scrubs.
  const previewRef = useRef(null)
  const listRef = useRef(null)
  const [favorites, setFavorites] = useState(() => loadFavorites('input'))
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  // Which track view is active: 'all' (everything), 'v1', or 'v2' (only
  // files sticky-tagged for that track — see fileList.filterByTrack).
  const [trackFilter, setTrackFilter] = useState('all')
  const [selectedName, setSelectedName] = useState(null)
  // Right-click context menu: {name, x, y} in viewport coords, or null.
  const [menu, setMenu] = useState(null)

  useEffect(() => { setFavorites(loadFavorites('input')) }, [])

  function selectFile(name) {
    setSelectedName(name)
    probe(name, 'input').then(info => {
      const url = info.browser_playable === false
        ? `/preview/input/${encodeURIComponent(name)}`
        : `/input/${encodeURIComponent(name)}`
      // Bin preview belongs ONLY to the left column's own <video>
      // (previewRef). The shared center videoRef is left untouched — that
      // element is driven exclusively by the timeline playback engine (and
      // reflects Timeline/Reformat content), so selecting a source here
      // must not hijack it. We write binSelection (NOT activePreview) so the
      // center preview's crop/clip-path — computed from activePreview.info —
      // never changes; Media Info In and the Reformat panel read
      // binSelection to know which source is selected.
      if (previewRef.current) previewRef.current.src = url
      setBinSelection({ name, dir: 'input', info })
    })
  }

  function handleClick(name) {
    selectFile(name)
  }

  function handleToggleFavorite(name) {
    setFavorites(toggleFavorite('input', name, favorites))
  }

  const visible = sortFiles(
    filterByTrack(filterFiles(files, query), trackFilter, trackTags),
    favorites, sortBy, sortDir
  )

  // Move the selection up/down through the currently-visible (filtered +
  // sorted) list and preview the newly-selected file. Wraps at neither end;
  // if nothing is selected yet, ArrowDown picks the first, ArrowUp the last.
  function moveSelection(delta) {
    if (visible.length === 0) return
    const idx = visible.findIndex(f => f.name === selectedName)
    let next
    if (idx === -1) next = delta > 0 ? 0 : visible.length - 1
    else next = Math.min(visible.length - 1, Math.max(0, idx + delta))
    const name = visible[next].name
    if (name !== selectedName) selectFile(name)
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1) }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedName) {
      e.preventDefault(); handleDelete(selectedName)
    }
  }

  function handleContextMenu(e, name) {
    e.preventDefault()
    selectFile(name)
    setMenu({ name, x: e.clientX, y: e.clientY })
  }

  async function handleDelete(name) {
    setMenu(null)
    if (!window.confirm(`Delete "${name}" from the Media Bin? This removes the file from input/ and cannot be undone.`)) return
    const result = await deleteInputFile(name)
    if (result.error) { alert('Delete failed: ' + result.error); return }
    if (name === selectedName) {
      setSelectedName(null)
      setBinSelection(null)
      // Only clear the left-column bin preview — the shared center video is
      // owned by the timeline, not the bin, so it must not be touched here.
      if (previewRef.current) previewRef.current.removeAttribute('src')
    }
    onDeleted?.()
  }

  // Dismiss the context menu on any outside click, scroll, or Escape.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onEsc = e => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onEsc)
    }
  }, [menu])

  return (
    // Mirrors OutputPanel's own three-block shape: video (shrink-0), an
    // info panel slot (shrink-0, passed in as children so App.jsx still
    // owns the actual TechInfoPanel/data-tour wiring), then the bin itself
    // as a flex-1 card so its list fills exactly the same remaining height
    // Export Bin's own list does, not a fixed row count.
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="shrink-0 rounded-md bg-black border border-neutral-800 flex items-center justify-center aspect-video max-h-[38vh]">
        <video ref={previewRef} controls className="w-full h-full object-contain" />
      </div>
      <div className="shrink-0">
        {children}
      </div>
      <div data-tour="mediaBin" className="flex-1 min-h-0 flex flex-col rounded-md bg-neutral-900 border border-neutral-800">
        <div className="shrink-0 flex items-center justify-between px-2 py-1 border-b border-neutral-800">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Media Bin ({files.length})</span>
          <div className="flex items-center gap-1">
            <ClearButton
              label="Clear"
              confirmText="Delete all files in input/? This cannot be undone."
              onClear={() => clearInput().then(() => onCleared())}
            />
            <Dropzone onUpload={onUpload} />
          </div>
        </div>
        <div className="shrink-0">
          <SortFilterBar
            query={query} onQueryChange={setQuery}
            sortBy={sortBy} onSortByChange={setSortBy}
            sortDir={sortDir} onSortDirChange={setSortDir}
          />
        </div>
        {/* Track view: All / V1 / V2. V1 and V2 show only files sticky-tagged
            for that track (stamped when first placed on it); untagged bin
            uploads appear only under All. */}
        <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-neutral-800">
          {TRACK_FILTERS.map(t => (
            <button
              key={t.key}
              onClick={() => setTrackFilter(t.key)}
              title={t.key === 'all' ? 'Show all media' : `Show only files used on ${t.label}`}
              className={`px-2 py-0.5 text-[9px] font-medium rounded ${trackFilter === t.key ? 'bg-indigo-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}`}
            >{t.label}</button>
          ))}
        </div>
        {/* tabIndex makes the list focusable so Arrow Up/Down (and Delete)
            reach handleKeyDown; clicking a file focuses it via the list. */}
        <ul
          ref={listRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="flex-1 min-h-0 overflow-y-auto divide-y divide-neutral-800 outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-700/50"
        >
          {visible.map(f => (
            <li
              key={f.name}
              onContextMenu={e => handleContextMenu(e, f.name)}
              className={`flex items-center justify-between gap-1.5 px-2 py-1 text-[11px] ${f.name === selectedName ? 'bg-indigo-900/40 text-indigo-300' : 'hover:bg-neutral-800/70'}`}
            >
              <button
                onClick={() => handleToggleFavorite(f.name)}
                title="Favorite"
                className={`shrink-0 text-[11px] ${favorites.has(f.name) ? 'text-amber-400' : 'text-neutral-600 hover:text-neutral-400'}`}
              >★</button>
              <button
                onClick={() => { handleClick(f.name); listRef.current?.focus() }}
                className="flex-1 flex items-center gap-1.5 min-w-0 text-left"
              >
                <span className="w-4 h-4 shrink-0 rounded bg-neutral-700 flex items-center justify-center text-[8px] text-neutral-400">▶</span>
                <span className={`truncate text-[9px] ${f.name === selectedName ? 'text-indigo-300' : 'text-neutral-300'}`}>{f.name}</span>
              </button>
              <button
                onClick={() => onAddToTimeline(f.name)}
                title="Add to timeline"
                className="shrink-0 w-4 h-4 flex items-center justify-center rounded bg-neutral-700 text-neutral-400 hover:text-neutral-200 text-[11px] leading-none"
              >+</button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="px-2 py-2 text-[11px] text-neutral-600 text-center">
              {files.length === 0
                ? 'No files yet'
                : trackFilter !== 'all' && !query
                  ? `No ${trackFilter.toUpperCase()} files yet`
                  : 'No matches'}
            </li>
          )}
        </ul>
      </div>

      {/* Right-click context menu, portaled at the cursor via fixed
          positioning. Its own pointerdown is stopped so the window-level
          dismiss listener doesn't fire before the button's onClick. */}
      {menu && (
        <div
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={e => e.stopPropagation()}
          className="fixed z-50 min-w-32 rounded-md border border-neutral-700 bg-neutral-900 shadow-xl py-1 text-[11px]"
        >
          <button
            onClick={() => handleDelete(menu.name)}
            className="w-full text-left px-3 py-1 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >Delete</button>
        </div>
      )}
    </div>
  )
}
