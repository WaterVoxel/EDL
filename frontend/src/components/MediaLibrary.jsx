import { useEffect, useRef, useState } from 'react'
import { probe, clearInput, deleteInputFile, revealFile, renameFile } from '../api'
import { useMedia } from '../context/MediaContext'
import ClearButton from './ClearButton'
import Dropzone from './Dropzone'
import SortFilterBar from './SortFilterBar'
import {
  loadFavorites, toggleFavorite, renameFavorite,
  loadBinFolders, createBinFolder, renameBinFolder, deleteBinFolder,
  moveToBinFolder, folderOfFile, renameBinFolderFile, buildBinRows,
  DEFAULT_FOLDER_NAME,
} from '../fileList'

const TRACK_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'v1', label: 'V1' },
  { key: 'v2', label: 'V2' },
  { key: 'a1', label: 'A1' },
]

// Stroked 24-grid icons in the house style (see FrameGrabButtons) rather than a
// glyph, because ▶ and ★ next to a 📁 emoji would read as three different eras.
function FolderIcon({ plus = false }) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 6.5a1.8 1.8 0 0 1 1.8-1.8h3.3a1.8 1.8 0 0 1 1.4.7l1.1 1.4h7.2a1.8 1.8 0 0 1 1.8 1.8v8.7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V6.5Z" />
      {plus && <path d="M12 10.8v5" />}
      {plus && <path d="M9.5 13.3h5" />}
    </svg>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 5.5l7 6.5-7 6.5" />
    </svg>
  )
}

// `inUseNames` is the set of source filenames the timeline currently points at
// (V1 + V2 clips and the A1 bed), passed down from App.jsx because it owns
// that state. It only gates Rename — see handleRename for why.
export default function MediaLibrary({ files, trackTags = {}, inUseNames = null, onAddToTimeline, onCleared, onDeleted, onRenamed, onUpload, children }) {
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
  // Which track view is active: 'all' (everything), or 'v1'/'v2'/'a1' (only
  // files sticky-tagged for that track — see fileList.filterByTrack).
  const [trackFilter, setTrackFilter] = useState('all')
  const [selectedName, setSelectedName] = useState(null)
  // Right-click context menu: {kind: 'file'|'folder'|'empty', name, x, y} in
  // viewport coords, or null. `name` is null for 'empty'.
  const [menu, setMenu] = useState(null)
  // Bin folders: { [folderName]: [filename] }. A grouping over input/, not
  // directories on disk — see fileList.js for why that distinction matters.
  const [folders, setFolders] = useState(() => loadBinFolders())
  // Which folders are shut. Collapse is view state, not a preference: unlike
  // favorites and the folders themselves it isn't persisted, so a reload opens
  // everything. The panel stays mounted for the session, so it survives
  // everything short of that.
  const [collapsed, setCollapsed] = useState(() => new Set())
  // The folder whose name is being edited inline, or null.
  const [editingFolder, setEditingFolder] = useState(null)
  // Escape has to cancel an edit, but removing the focused input also blurs it,
  // and blur is what commits. A ref (not state) so the blur handler firing in
  // the same tick sees the flag.
  const cancelEditRef = useRef(false)
  // The file being dragged, or null when no internal drag is in flight. Doubles
  // as the "this is our drag, not an OS file drop" test — an internal drag
  // carries no dataTransfer items, so there is nothing on the event to read.
  const [dragName, setDragName] = useState(null)
  // Folder under the cursor mid-drag; null means the top level.
  const [dropFolder, setDropFolder] = useState(null)

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

  // One flat row list — folder rows and file rows interleaved in display order.
  // All of the sorting and both filters still happen in fileList, applied within
  // each folder as well as at the top level.
  const rows = buildBinRows({ files, folders, favorites, query, trackFilter, trackTags, sortBy, sortDir, collapsed, pinnedFolder: editingFolder })
  // The files the arrow keys can reach: rows only, in the order shown, so the
  // walk skips folder rows and anything inside a collapsed folder.
  const visible = rows.filter(r => r.type === 'file').map(r => r.file)
  // Highlight the list as a drop target only when dropping there would actually
  // move something — dragging a top-level file around the top level shouldn't
  // light anything up.
  const rootDropActive = Boolean(dragName) && dropFolder === null && folderOfFile(dragName, folders) !== null
  // Mirrors buildBinRows' own `filtering` test. A filter forces every folder
  // open — a match inside a shut folder would be unreachable — which means the
  // collapse control genuinely can't act, so it's shown disabled rather than
  // left as a button that does nothing.
  const foldersForcedOpen = Boolean(query) || trackFilter !== 'all'

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
    // The folder-rename input is inside this list, so its keystrokes bubble
    // here. Backspace while naming a folder would otherwise delete the selected
    // FILE off disk.
    if (e.target.tagName === 'INPUT') return
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1) }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedName) {
      e.preventDefault(); handleDelete(selectedName)
    }
  }

  function handleContextMenu(e, name) {
    e.preventDefault()
    e.stopPropagation()
    selectFile(name)
    setMenu({ kind: 'file', name, x: e.clientX, y: e.clientY })
  }

  // --- Folders ------------------------------------------------------------

  function setFolderOpen(name, open) {
    setCollapsed(prev => {
      if (open === !prev.has(name)) return prev
      const next = new Set(prev)
      if (open) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function handleNewFolder() {
    setMenu(null)
    const { folders: next, name } = createBinFolder(DEFAULT_FOLDER_NAME, folders)
    setFolders(next)
    // Open (a folder of this name may have been collapsed, removed and remade)
    // and go straight into rename mode, so the folder gets named in the same
    // gesture that created it rather than needing a second click.
    setFolderOpen(name, true)
    setEditingFolder(name)
  }

  function commitFolderName(oldName, value) {
    setEditingFolder(null)
    if (cancelEditRef.current) { cancelEditRef.current = false; return }
    const { folders: next, name } = renameBinFolder(oldName, value, folders)
    if (next === folders) return
    setFolders(next)
    // Carry the collapse state across so a renamed folder doesn't spring open.
    setCollapsed(prev => {
      if (!prev.has(oldName)) return prev
      const s = new Set(prev)
      s.delete(oldName)
      s.add(name)
      return s
    })
  }

  function handleRemoveFolder(name) {
    setMenu(null)
    // Counted against what's actually in input/, not against the stored
    // assignments — a file deleted from the bin leaves its assignment behind,
    // and the confirm must say the same number the folder row shows.
    const count = (folders[name] || []).filter(n => files.some(f => f.name === n)).length
    // Nothing leaves input/ — only the grouping goes — so this doesn't warrant
    // the same warning file Delete gets, just a heads-up when files are inside.
    if (count > 0 && !window.confirm(`Remove the folder "${name}"? Its ${count} file${count === 1 ? '' : 's'} go back to the top level. Nothing is deleted from input/.`)) return
    setFolders(deleteBinFolder(name, folders))
  }

  // --- Dragging a file between folders ------------------------------------
  // HTML5 drag events, following the timeline's clip reorder (TimelineClip.jsx)
  // rather than conventions.md's pointer-listener idiom: this is a drag between
  // list rows, which is what the native API is for, and the two need to look
  // and feel the same.

  // `dragName` gates every handler so an OS file drop passing over the list is
  // left entirely to Dropzone — we never preventDefault on someone else's drag.
  function handleRowDragOver(e, folder) {
    if (!dragName) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (folder !== dropFolder) setDropFolder(folder)
  }

  function handleRowDrop(e, folder) {
    if (!dragName) return
    e.preventDefault()
    e.stopPropagation()
    setFolders(moveToBinFolder(dragName, folder, folders))
    // Dropping into a collapsed folder would swallow the file with no sign it
    // arrived anywhere.
    if (folder) setFolderOpen(folder, true)
    setDragName(null)
    setDropFolder(null)
  }

  async function handleShowDestination(name) {
    setMenu(null)
    const result = await revealFile(name, 'input')
    if (result.error) alert('Could not show file: ' + result.error)
  }

  async function handleRename(name) {
    setMenu(null)
    // A clip records its source by FILENAME, so renaming a file the timeline
    // still points at would leave those clips — and every undo step behind
    // them — aimed at a file that no longer exists, surfacing only as an
    // ffmpeg failure at Render. Refuse rather than silently rewriting the
    // timeline. (A rename still breaks a *saved* .nara project that used the
    // old name; nothing here can know about those.)
    if (inUseNames?.has(name)) {
      alert(`"${name}" is on the timeline (or loaded as the A1 bed), so it can't be renamed — the clips point at it by name. Remove it from the timeline first.`)
      return
    }
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const input = window.prompt('Rename source file to:', stem)
    if (input == null) return
    const trimmed = input.trim()
    if (!trimmed || trimmed === stem) return
    const result = await renameFile(name, trimmed, 'input')
    if (result.error) { alert('Rename failed: ' + result.error); return }
    // Every sticky per-file state is keyed by filename, so carry them over: the
    // ★ and the bin folder belong to this component, the track tag to App.jsx
    // (onRenamed, which also refreshes the list from disk).
    setFavorites(renameFavorite('input', name, result.name, favorites))
    setFolders(renameBinFolderFile(name, result.name, folders))
    // Keep the preview/Media Info In on the same file under its new name.
    if (name === selectedName) selectFile(result.name)
    onRenamed?.(name, result.name)
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
            <button
              onClick={handleNewFolder}
              title="New folder — groups files in the bin. Nothing moves in input/."
              className="px-1 py-0.5 rounded border border-neutral-700 text-neutral-500 hover:text-indigo-300 hover:border-indigo-500 flex items-center"
            >
              <FolderIcon plus />
            </button>
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
            reach handleKeyDown; clicking a file focuses it via the list.
            The list itself is the top-level drop target: folder and file rows
            stop propagation so whichever row is under the cursor wins, and
            anything else — including the empty stretch below the last row —
            falls through to here and means "out of every folder". */}
        <ul
          ref={listRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onContextMenu={e => { e.preventDefault(); setMenu({ kind: 'empty', name: null, x: e.clientX, y: e.clientY }) }}
          onDragOver={e => handleRowDragOver(e, null)}
          onDrop={e => handleRowDrop(e, null)}
          className={`flex-1 min-h-0 overflow-y-auto divide-y divide-neutral-800 outline-none ${
            rootDropActive ? 'ring-1 ring-inset ring-indigo-400' : 'focus:ring-1 focus:ring-inset focus:ring-indigo-700/50'
          }`}
        >
          {rows.map(row => row.type === 'folder' ? (
            <li
              key={`folder:${row.name}`}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ kind: 'folder', name: row.name, x: e.clientX, y: e.clientY }) }}
              onDragOver={e => handleRowDragOver(e, row.name)}
              onDrop={e => handleRowDrop(e, row.name)}
              className={`flex items-center gap-1.5 px-2 py-1 text-[11px] ${
                dragName && dropFolder === row.name
                  ? 'bg-indigo-900/40 ring-1 ring-inset ring-indigo-400'
                  : 'hover:bg-neutral-800/70'
              }`}
            >
              <button
                onClick={() => setFolderOpen(row.name, !row.open)}
                disabled={foldersForcedOpen}
                title={foldersForcedOpen ? 'Folders stay open while a filter is active' : row.open ? 'Collapse' : 'Expand'}
                className="shrink-0 w-3 h-4 flex items-center justify-center text-neutral-500 enabled:hover:text-neutral-300 disabled:opacity-40"
              ><ChevronIcon open={row.open} /></button>
              <span className="shrink-0 text-neutral-500"><FolderIcon /></span>
              {editingFolder === row.name ? (
                /* Mounted straight into edit mode by handleNewFolder, so a new
                   folder is named in one gesture. Enter blurs (blur commits),
                   Escape cancels via the ref, and keystrokes are stopped here so
                   Backspace never reaches the list's own key handler. */
                <input
                  autoFocus
                  defaultValue={row.name}
                  onFocus={e => e.target.select()}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelEditRef.current = true; setEditingFolder(null) }
                  }}
                  onBlur={e => commitFolderName(row.name, e.target.value)}
                  className="flex-1 min-w-0 px-1 py-0 text-[9px] rounded bg-neutral-950 border border-indigo-500 text-neutral-200 outline-none"
                />
              ) : (
                <button
                  onClick={() => { if (!foldersForcedOpen) setFolderOpen(row.name, !row.open) }}
                  onDoubleClick={() => setEditingFolder(row.name)}
                  title={foldersForcedOpen ? 'Double-click to rename' : 'Click to open or close, double-click to rename'}
                  className="flex-1 min-w-0 text-left"
                ><span className="block truncate text-[9px] text-neutral-300">{row.name}</span></button>
              )}
              <span className="shrink-0 text-[9px] text-neutral-600">{row.count}</span>
            </li>
          ) : (
            <li
              key={`file:${row.folder ?? ''}/${row.file.name}`}
              onContextMenu={e => handleContextMenu(e, row.file.name)}
              // Drag to file away; a file row reports its own container, so
              // dropping onto a file inside a folder means that folder.
              draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragName(row.file.name); setDropFolder(row.folder) }}
              // Fires even on an abandoned drag (Esc, or a drop outside the
              // list), which is what clears the indicator.
              onDragEnd={() => { setDragName(null); setDropFolder(null) }}
              onDragOver={e => handleRowDragOver(e, row.folder)}
              onDrop={e => handleRowDrop(e, row.folder)}
              className={`flex items-center justify-between gap-1.5 py-1 text-[11px] ${row.folder ? 'pl-7 pr-2' : 'px-2'} ${
                dragName === row.file.name ? 'opacity-40' : ''
              } ${row.file.name === selectedName ? 'bg-indigo-900/40 text-indigo-300' : 'hover:bg-neutral-800/70'}`}
            >
              <button
                onClick={() => handleToggleFavorite(row.file.name)}
                title="Favorite"
                className={`shrink-0 text-[11px] ${favorites.has(row.file.name) ? 'text-amber-400' : 'text-neutral-600 hover:text-neutral-400'}`}
              >★</button>
              <button
                onClick={() => { handleClick(row.file.name); listRef.current?.focus() }}
                className="flex-1 flex items-center gap-1.5 min-w-0 text-left"
              >
                <span className="w-4 h-4 shrink-0 rounded bg-neutral-700 flex items-center justify-center text-[8px] text-neutral-400">▶</span>
                <span className={`truncate text-[9px] ${row.file.name === selectedName ? 'text-indigo-300' : 'text-neutral-300'}`}>{row.file.name}</span>
              </button>
              <button
                onClick={() => onAddToTimeline(row.file.name)}
                title="Add to timeline"
                className="shrink-0 w-4 h-4 flex items-center justify-center rounded bg-neutral-700 text-neutral-400 hover:text-neutral-200 text-[11px] leading-none"
              >+</button>
            </li>
          ))}
          {/* Counts files, not rows — an empty folder is a row, but the bin is
              still empty and should say so. */}
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
          {menu.kind === 'file' && (
            <>
              <button
                onClick={() => handleRename(menu.name)}
                title="Rename the file in input/ (blocked while it's on the timeline)"
                className="block w-full text-left px-3 py-1 text-neutral-200 hover:bg-neutral-800"
              >Rename</button>
              <button
                onClick={() => handleShowDestination(menu.name)}
                title="Reveal the file in Finder"
                className="block w-full text-left px-3 py-1 text-neutral-200 hover:bg-neutral-800"
              >Show destination</button>
              {/* The keyboard-and-menu way out of a folder, so a mis-drop doesn't
                  need a second precise drag to undo. */}
              {folderOfFile(menu.name, folders) && (
                <button
                  onClick={() => { setMenu(null); setFolders(moveToBinFolder(menu.name, null, folders)) }}
                  title="Move this file back to the top level of the bin"
                  className="block w-full text-left px-3 py-1 text-neutral-200 hover:bg-neutral-800"
                >Move out of folder</button>
              )}
            </>
          )}
          {menu.kind === 'folder' && (
            <button
              onClick={() => { setMenu(null); setEditingFolder(menu.name) }}
              title="Rename this folder"
              className="block w-full text-left px-3 py-1 text-neutral-200 hover:bg-neutral-800"
            >Rename folder</button>
          )}
          <button
            onClick={handleNewFolder}
            title="New folder — groups files in the bin. Nothing moves in input/."
            className="block w-full text-left px-3 py-1 text-neutral-200 hover:bg-neutral-800"
          >New Folder</button>
          {menu.kind === 'folder' && (
            <>
              {/* Not red: this removes the grouping and nothing else — the files
                  stay in input/ and reappear at the top level. */}
              <div className="my-1 border-t border-neutral-800" />
              <button
                onClick={() => handleRemoveFolder(menu.name)}
                title="Remove the folder. Its files go back to the top level; nothing is deleted."
                className="block w-full text-left px-3 py-1 text-neutral-200 hover:bg-neutral-800"
              >Remove folder</button>
            </>
          )}
          {menu.kind === 'file' && (
            <>
              {/* Delete stays visually separate — it's the only irreversible one. */}
              <div className="my-1 border-t border-neutral-800" />
              <button
                onClick={() => handleDelete(menu.name)}
                className="block w-full text-left px-3 py-1 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >Delete</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
