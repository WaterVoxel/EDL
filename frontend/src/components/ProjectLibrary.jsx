import { useState, useEffect } from 'react'
import { listProjects, loadProject, deleteProject, renameProject } from '../api'
import SortFilterBar from './SortFilterBar'
import ContextMenu from './ContextMenu'
import BinFolderRow, { FolderIcon, rowPad } from './BinFolderRow'
import useBinFolders from '../hooks/useBinFolders'

// Projects can't be favorited, but the row builder takes a favorites Set to
// float them to the top. One frozen empty Set rather than a fresh `new Set()`
// per render, so the rows aren't rebuilt from scratch on every keystroke.
const NO_FAVORITES = new Set()

export default function ProjectLibrary({ onOpen, onRenamed, onClose }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // {position, name, kind}. `kind` is 'file' | 'folder' | 'empty' as in the two
  // bins — a folder row and the blank space below the list need different items.
  const [contextMenu, setContextMenu] = useState(null)
  // Same defaults as the Export Bin: newest first, which is what this dialog
  // did unconditionally before the bar existed.
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState('desc')

  // The same folder machinery the two bins run, over projects/ instead of
  // input/ or output/: a grouping that lets a long list of saved timelines be
  // filed by job, cut or client. Virtual, like the bins' — nothing moves on
  // disk, so a project's filename (what Save writes back to, and what
  // `onRenamed` follows upstream) is untouched by filing it.
  const bin = useBinFolders({
    scope: 'projects',
    dirLabel: 'projects/',
    files: projects,
    favorites: NO_FAVORITES,
    query, sortBy, sortDir,
  })
  const { rows } = bin
  // File rows only, in display order — the two empty states below count
  // projects, not rows, since an empty folder is a row.
  const visible = bin.visibleFiles

  // setLoading(false) lived inside the .then, so a failed listing left the dialog
  // reading "Loading…" forever with the error state never set — the library
  // looked like it was still working when it had already given up. The catch puts
  // the reason in the banner this component already renders and stops the spin.
  function refresh() {
    setLoading(true)
    listProjects().then(items => {
      // Stored unsorted — ordering is the sort bar's job now, so that a
      // refresh (after a delete) can't fight the order the user picked.
      setProjects(items)
      setLoading(false)
    }).catch(e => {
      setError(e.message)
      setLoading(false)
    })
  }

  useEffect(() => { refresh() }, [])

  // The try/catch is the backstop for a reply that is not JSON at all: r.json()
  // REJECTS on one, and with nothing catching it the click did literally nothing
  // — no error, no open, no clue. The server now answers a corrupt .nara with a
  // JSON 400, so project.error covers that case; this covers the rest (backend
  // down mid-session, an HTML error page from anything else).
  async function handleOpen(name) {
    let project
    try {
      project = await loadProject(name)
    } catch (e) {
      setError(`Could not open "${name}": ${e.message}`)
      return
    }
    if (project.error) { setError(project.error); return }
    onOpen(name, project)
  }

  async function handleDelete(name) {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return
    const result = await deleteProject(name)
    if (result.error) { setError(result.error); return }
    refresh()
  }

  // Prompt seeded with the stem, not the whole filename — the server owns the
  // `.nara` extension (typing over it is how you'd accidentally save a project
  // the library can no longer see), and it's the same prompt the two media bins
  // put up for their own Rename.
  async function handleRename(name) {
    const stem = name.replace(/\.nara$/i, '')
    const input = window.prompt('Rename project to:', stem)
    if (input == null) return
    const trimmed = input.trim()
    if (!trimmed || trimmed === stem) return
    const result = await renameProject(name, trimmed)
    if (result.error) { setError(result.error); return }
    // The open project is tracked by filename upstream (it's what Save writes
    // back to), so tell App or the next Save would recreate the old file
    // alongside the renamed one.
    onRenamed?.(name, result.name)
    // The folder assignment is keyed by filename too, so carry it over or a
    // rename kicks the project back out to the top level.
    bin.carryRenamedFile(name, result.name)
    setError(null)
    refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-4 w-[28rem] max-h-[70vh] flex flex-col gap-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-200">Project Library</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setContextMenu(null); bin.newFolder(null) }}
              title="New folder — groups projects in the library. Nothing moves in projects/. Drop a folder on another to nest it."
              className="px-1 py-0.5 rounded border border-neutral-700 text-neutral-500 hover:text-indigo-300 hover:border-indigo-500 flex items-center"
            >
              <FolderIcon plus />
            </button>
            <button
              onClick={onClose}
              className="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-white hover:bg-neutral-700 text-[12px]"
            >×</button>
          </div>
        </div>

        {error && <p className="text-[10px] text-red-400">{error}</p>}

        <div className="border border-neutral-800 rounded flex-1 min-h-0 flex flex-col">
          {/* Hidden while loading and while there is nothing saved at all — a
              filter over an empty list is just a control that can't do
              anything. It stays put once a filter has emptied the list, so
              there is always a way to clear the query.
              `|| query` is what makes that last promise true now that folders
              exist. This bar is the ONLY caller of setQuery, so if it unmounts
              with a query still set, that query is stranded — and a stranded
              query means `filtering`, which culls every folder whose subtree has
              no match (fileList.buildBinRows). Deleting the last project that
              matched an active filter would therefore hide the whole folder tree
              behind a filter with no input left to clear it, and make the New
              Folder button look broken (a folder is exempt from the cull only
              while it's being named, so it would vanish the moment it was). */}
          {!loading && (projects.length > 0 || Boolean(query)) && (
            <SortFilterBar
              query={query} onQueryChange={setQuery}
              sortBy={sortBy} onSortByChange={setSortBy}
              sortDir={sortDir} onSortDirChange={setSortDir}
            />
          )}

          {/* The list itself is the top-level drop target, exactly as in the two
              bins: folder and project rows stop propagation so whichever row is
              under the cursor wins, and anything else — including the empty
              stretch below the last row — falls through to here and means "out
              of every folder". */}
          <ul
            onContextMenu={e => { e.preventDefault(); setContextMenu({ position: { x: e.clientX, y: e.clientY }, name: null, kind: 'empty' }) }}
            onDragOver={e => bin.handleRowDragOver(e, null)}
            onDrop={e => bin.handleRowDrop(e, null)}
            className={`flex-1 overflow-y-auto divide-y divide-neutral-800 ${
              bin.rootDropActive ? 'ring-1 ring-inset ring-indigo-400' : ''
            }`}
          >
            {loading ? (
              <li className="px-3 py-3 text-[11px] text-neutral-600 text-center">Loading…</li>
            ) : (
              <>
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
                    onContextMenu={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setContextMenu({ position: { x: e.clientX, y: e.clientY }, name: row.file.name, kind: 'file' })
                    }}
                    // Drag to file a project away; a row reports its own
                    // container, so dropping onto a project inside a folder
                    // means that folder.
                    draggable
                    onDragStart={e => bin.handleFileDragStart(e, row.file.name, row.folder)}
                    // Fires even on an abandoned drag (Esc, or a drop outside
                    // the list), which is what clears the indicator.
                    onDragEnd={bin.endDrag}
                    onDragOver={e => bin.handleRowDragOver(e, row.folder)}
                    onDrop={e => bin.handleRowDrop(e, row.folder)}
                    style={{ paddingLeft: rowPad(row.depth) }}
                    className={`flex items-center gap-2 pr-3 py-1.5 hover:bg-neutral-800/70 group ${
                      bin.dragFiles.includes(row.file.name) ? 'opacity-40' : ''
                    }`}
                  >
                    <button
                      onClick={() => handleOpen(row.file.name)}
                      className="flex-1 min-w-0 text-left"
                      title="Open this project"
                    >
                      <div className="text-[11px] text-neutral-200 truncate">{row.file.name}</div>
                      <div className="text-[9px] text-neutral-500">{new Date(row.file.modified * 1000).toLocaleString()}</div>
                    </button>
                    <button
                      onClick={() => handleDelete(row.file.name)}
                      title="Delete project"
                      className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-neutral-600 hover:text-white hover:bg-red-600 text-[10px] opacity-0 group-hover:opacity-100"
                    >×</button>
                  </li>
                ))}
                {/* Counts projects, not rows: an empty folder is a row, but the
                    library still has nothing saved in it. Both lines sit BELOW
                    any folder rows rather than replacing them, so a folder made
                    before the first Save is still there to file into. The
                    "no match" line is gated on there being a query — with none,
                    an empty file list just means everything is inside a
                    collapsed folder, which the folder rows already say. */}
                {visible.length === 0 && (projects.length === 0 ? (
                  <li className="px-3 py-3 text-[11px] text-neutral-600 text-center">
                    No saved projects yet — press Save to add the current timeline here.
                  </li>
                ) : query ? (
                  <li className="px-3 py-3 text-[11px] text-neutral-600 text-center">
                    No project matches “{query}”.
                  </li>
                ) : null)}
              </>
            )}
          </ul>
        </div>

        {/* Rendered inside the dialog (which stops click propagation) so that
            clicking a menu item can't also reach the backdrop's onClose and
            shut the library out from under the prompt. Same three kinds of menu
            the two bins offer: a project row, a folder row, and the blank space
            below the list (which can only make a folder). */}
        {contextMenu && (
          <ContextMenu
            position={contextMenu.position}
            onClose={() => setContextMenu(null)}
            items={[
              ...(contextMenu.kind === 'file' ? [
                { label: 'Rename…', onClick: () => handleRename(contextMenu.name) },
                // The menu way out of a folder, so a mis-drop doesn't need a
                // second precise drag to undo.
                ...(bin.fileFolder(contextMenu.name) ? [
                  { label: 'Move out of folder', onClick: () => bin.moveFiles([contextMenu.name], null) },
                ] : []),
              ] : []),
              ...(contextMenu.kind === 'folder' ? [
                { label: 'Rename folder', onClick: () => bin.setEditingFolder(contextMenu.name) },
                { label: 'New folder inside', onClick: () => bin.newFolder(contextMenu.name) },
              ] : []),
              { label: 'New Folder', onClick: () => bin.newFolder(null) },
              // Not red: this removes the grouping and nothing else — the
              // projects stay in projects/ and reappear one level up.
              ...(contextMenu.kind === 'folder' ? [
                { label: 'Remove folder', onClick: () => bin.removeFolder(contextMenu.name), separatorBefore: true },
              ] : []),
              ...(contextMenu.kind === 'file' ? [
                { label: 'Delete', danger: true, separatorBefore: true, onClick: () => handleDelete(contextMenu.name) },
              ] : []),
            ]}
          />
        )}
      </div>
    </div>
  )
}
