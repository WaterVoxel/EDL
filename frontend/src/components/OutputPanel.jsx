import { useEffect, useRef, useState } from 'react'
import { probe, clearOutput, deleteOutputFile, revealFile, renameFile } from '../api'
import TechInfoPanel from './TechInfoPanel'
import DownloadButton from './DownloadButton'
import ClearButton from './ClearButton'
import SortFilterBar from './SortFilterBar'
import ExportSettings from './ExportSettings'
import ContextMenu from './ContextMenu'
import BinFolderRow, { FolderIcon, rowPad } from './BinFolderRow'
import useBinFolders from '../hooks/useBinFolders'
import { loadFavorites, toggleFavorite, renameFavorite } from '../fileList'

// `inUseNames` is the set of Export Bin filenames the timeline points at — a
// clip lands there when a chat edit or Reformat re-points it at a render. Like
// the Media Bin's own set, it only gates Rename (see handleRename).
export default function OutputPanel({ files, inUseNames = null, onCleared }) {
  const videoRef = useRef(null)
  // Ticket for the newest probe request — see loadOutput. Same guard the Media
  // Bin uses, for the same reason.
  const probeSeqRef = useRef(0)
  const [selectedName, setSelectedName] = useState(null)
  const [info, setInfo] = useState(null)
  const [favorites, setFavorites] = useState(() => loadFavorites('output'))
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [showSettings, setShowSettings] = useState(false)
  // {position, name, kind}. `kind` is 'file' | 'folder' | 'empty' as in the Media
  // Bin — a folder row and the blank space below the list need different items.
  const [contextMenu, setContextMenu] = useState(null)

  // The same folder machinery the Media Bin runs, over output/ instead of input/:
  // a grouping that lets a long list of renders be filed by job, shoot or day
  // without moving anything on disk (a clip whose source is a render still
  // resolves it by bare filename — see fileList.js).
  const bin = useBinFolders({
    scope: 'output',
    dirLabel: 'output/',
    files, favorites, query, sortBy, sortDir,
  })
  const { rows } = bin

  function handleContextMenu(e, name) {
    if (!name) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, name, kind: 'file' })
  }

  async function handleShowDestination(name) {
    const result = await revealFile(name)
    if (result.error) alert('Could not show file: ' + result.error)
  }

  async function handleRename(name) {
    // A render can itself be a clip's source (a chat edit or Reformat
    // re-points the selected clip at the file it just produced), and a clip
    // resolves its media by filename — so renaming one the timeline still
    // uses would orphan it, surfacing only as an ffmpeg failure at Render.
    // Same refusal the Media Bin makes, for the same reason.
    if (inUseNames?.has(name)) {
      alert(`"${name}" is in use on the timeline as a clip's source, so it can't be renamed — the clip points at it by name. Remove that clip first.`)
      return
    }
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const input = window.prompt('Rename export to:', stem)
    if (input == null) return
    const trimmed = input.trim()
    if (!trimmed || trimmed === stem) return
    const result = await renameFile(name, trimmed)
    if (result.error) { alert('Rename failed: ' + result.error); return }
    // The ★ and the bin folder are both keyed by filename, so carry them over or
    // the rename drops the star and kicks the file back to the top level.
    setFavorites(renameFavorite('output', name, result.name, favorites))
    bin.carryRenamedFile(name, result.name)
    // Re-point the current selection at the new name so the preview/info
    // panel stay on the same file, then refresh the list from disk.
    if (name === selectedName) loadOutput(result.name)
    onCleared()
  }

  async function handleDelete(name) {
    // Deleting is allowed even when a clip points at this render (unlike
    // Rename, which has a "do it later" alternative) — the same call the
    // Media Bin's own Delete makes. The confirm just says so, since an
    // orphaned clip would otherwise only surface as a Render failure.
    const inUseNote = inUseNames?.has(name)
      ? '\n\nA clip on the timeline uses this file as its source — that clip will have nothing to render.'
      : ''
    if (!window.confirm(`Delete "${name}" from the Export Bin? This removes the file from disk and cannot be undone.${inUseNote}`)) return
    const result = await deleteOutputFile(name)
    if (result.error) { alert('Delete failed: ' + result.error); return }
    if (name === selectedName) {
      // Bumping the probe ticket is what makes this stick. loadOutput's reply
      // sets selectedName/info/src from inside the .then, so a probe already on
      // the wire for the file just deleted would land after this and repopulate
      // the panel with a file that is no longer on disk (finding #14). #10 added
      // the ref for the click race and deliberately left delete alone.
      probeSeqRef.current++
      setSelectedName(null)
      setInfo(null)
      if (videoRef.current) videoRef.current.removeAttribute('src')
    }
    onCleared()
  }

  useEffect(() => { setFavorites(loadFavorites('output')) }, [])

  function loadOutput(name) {
    // Probes resolve out of order, so a slow reply for an earlier file can land
    // after a fast one and win. Here it would also drag the highlighted row
    // back with it (setSelectedName is inside the reply), so a click and a
    // finishing render racing each other could leave every part of the panel
    // pointing at the wrong export. Newest ticket wins; older replies are
    // dropped.
    const seq = ++probeSeqRef.current
    probe(name, 'output').then(data => {
      if (seq !== probeSeqRef.current) return
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
      // Third place the panel is emptied, and it needs the same ticket bump: an
      // empty list means nothing in flight can still be worth showing.
      probeSeqRef.current++
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
      // Same reason as handleDelete: every file this panel could be probing has
      // just been removed, so no reply still in flight may set the panel.
      probeSeqRef.current++
      if (videoRef.current) videoRef.current.removeAttribute('src')
      setSelectedName(null)
      setInfo(null)
      onCleared()
    })
  }

  function handleToggleFavorite(name) {
    setFavorites(toggleFavorite('output', name, favorites))
  }

  // File rows only, in display order — the empty-state test and the newest-export
  // auto-select both count files, not rows, since an empty folder is a row.
  const visible = bin.visibleFiles

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div
        onContextMenu={e => handleContextMenu(e, selectedName)}
        className="shrink-0 rounded-md bg-black border border-neutral-800 flex items-center justify-center aspect-video max-h-[38vh]"
      >
        <video ref={videoRef} controls className="w-full h-full object-contain" />
      </div>
      <div className="shrink-0">
        <TechInfoPanel info={info} title="Media Info Out" collapsible />
      </div>
      {/* Fills whatever room is left below Media Info Out, pinning its own
          bottom to the bottom of the column, rather than stopping at a
          fixed height. */}
      <div className="flex-1 min-h-0 flex flex-col rounded-md bg-neutral-900 border border-neutral-800">
        <div className="shrink-0 flex items-center justify-between px-2 py-1 border-b border-neutral-800">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Export Bin</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setContextMenu(null); bin.newFolder(null) }}
              title="New folder — groups exports in the bin. Nothing moves in output/. Drop a folder on another to nest it."
              className="px-1 py-0.5 rounded border border-neutral-700 text-neutral-500 hover:text-indigo-300 hover:border-indigo-500 flex items-center"
            >
              <FolderIcon plus />
            </button>
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
        {/* The list itself is the top-level drop target: folder and file rows stop
            propagation so whichever row is under the cursor wins, and anything
            else — including the empty stretch below the last row — falls through
            to here and means "out of every folder". */}
        <ul
          onContextMenu={e => { e.preventDefault(); setContextMenu({ position: { x: e.clientX, y: e.clientY }, name: null, kind: 'empty' }) }}
          onDragOver={e => bin.handleRowDragOver(e, null)}
          onDrop={e => bin.handleRowDrop(e, null)}
          className={`flex-1 min-h-0 overflow-y-auto divide-y divide-neutral-800 ${
            bin.rootDropActive ? 'ring-1 ring-inset ring-indigo-400' : ''
          }`}
        >
          {rows.map(row => row.type === 'folder' ? (
            <BinFolderRow
              key={`folder:${row.name}`}
              row={row}
              bin={bin}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ position: { x: e.clientX, y: e.clientY }, name: row.name, kind: 'folder' }) }}
            />
          ) : (
            <li
              key={`file:${row.folder ?? ''}/${row.file.name}`}
              onContextMenu={e => handleContextMenu(e, row.file.name)}
              // Drag to file away; a file row reports its own container, so
              // dropping onto a file inside a folder means that folder.
              draggable
              onDragStart={e => bin.handleFileDragStart(e, row.file.name, row.folder)}
              // Fires even on an abandoned drag (Esc, or a drop outside the
              // list), which is what clears the indicator.
              onDragEnd={bin.endDrag}
              onDragOver={e => bin.handleRowDragOver(e, row.folder)}
              onDrop={e => bin.handleRowDrop(e, row.folder)}
              style={{ paddingLeft: rowPad(row.depth) }}
              className={`flex items-start gap-1.5 pr-2 py-1 text-[11px] cursor-pointer ${
                bin.dragFiles.includes(row.file.name) ? 'opacity-40' : ''
              } ${row.file.name === selectedName ? 'bg-indigo-900/40 text-indigo-300' : 'text-neutral-300 hover:bg-neutral-800/70'}`}
            >
              <button
                onClick={e => { e.stopPropagation(); handleToggleFavorite(row.file.name) }}
                title="Favorite"
                className={`shrink-0 text-[11px] ${favorites.has(row.file.name) ? 'text-amber-400' : 'text-neutral-600 hover:text-neutral-400'}`}
              >★</button>
              <div className="flex-1 min-w-0 truncate" onClick={() => loadOutput(row.file.name)}>
                <div className="truncate text-[9px]">{row.file.name}</div>
                {row.file.modified && (
                  <div className="text-[9px] text-neutral-500">{new Date(row.file.modified * 1000).toLocaleString()}</div>
                )}
              </div>
            </li>
          ))}
          {/* Counts files, not rows — an empty folder is a row, but the bin is
              still empty and should say so. */}
          {visible.length === 0 && <li className="px-2 py-2 text-[11px] text-neutral-600 text-center">{files.length === 0 ? 'Export Bin is empty' : 'No matches'}</li>}
        </ul>
      </div>

      {/* Same three kinds of menu the Media Bin offers, built through the shared
          ContextMenu: a file row, a folder row, and the blank space below the
          list (which can only make a folder). "New Folder" is on all three. */}
      {contextMenu && (
        <ContextMenu
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          items={[
            ...(contextMenu.kind === 'file' ? [
              { label: 'Rename', onClick: () => handleRename(contextMenu.name) },
              { label: 'Show destination', onClick: () => handleShowDestination(contextMenu.name) },
              // The menu way out of a folder, so a mis-drop doesn't need a second
              // precise drag to undo.
              ...(bin.fileFolder(contextMenu.name) ? [
                { label: 'Move out of folder', onClick: () => bin.moveFiles([contextMenu.name], null) },
              ] : []),
            ] : []),
            ...(contextMenu.kind === 'folder' ? [
              { label: 'Rename folder', onClick: () => bin.setEditingFolder(contextMenu.name) },
              { label: 'New folder inside', onClick: () => bin.newFolder(contextMenu.name) },
            ] : []),
            { label: 'New Folder', onClick: () => bin.newFolder(null) },
            // Not red: this removes the grouping and nothing else — the files stay
            // in output/ and reappear one level up.
            ...(contextMenu.kind === 'folder' ? [
              { label: 'Remove folder', onClick: () => bin.removeFolder(contextMenu.name), separatorBefore: true },
            ] : []),
            ...(contextMenu.kind === 'file' ? [
              { label: 'Delete', onClick: () => handleDelete(contextMenu.name), danger: true, separatorBefore: true },
            ] : []),
          ]}
        />
      )}
    </div>
  )
}
