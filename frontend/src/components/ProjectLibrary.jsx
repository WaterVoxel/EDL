import { useState, useEffect, useMemo } from 'react'
import { listProjects, loadProject, deleteProject, renameProject } from '../api'
import { filterFiles, sortFiles } from '../fileList'
import SortFilterBar from './SortFilterBar'
import ContextMenu from './ContextMenu'

// Projects can't be favorited, but sortFiles takes a favorites Set to float
// them to the top. One frozen empty Set rather than a fresh `new Set()` per
// render, so the memo below isn't invalidated on every keystroke.
const NO_FAVORITES = new Set()

export default function ProjectLibrary({ onOpen, onRenamed, onClose }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  // Same defaults as the Export Bin: newest first, which is what this dialog
  // did unconditionally before the bar existed.
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState('desc')

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

  // `filterFiles` + `sortFiles` are the same two helpers the Media Bin and the
  // Export Bin sort with — a project entry is `{name, modified}`, the shape
  // they already expect, so the three lists can't drift in behaviour.
  const visible = useMemo(
    () => sortFiles(filterFiles(projects, query), NO_FAVORITES, sortBy, sortDir),
    [projects, query, sortBy, sortDir],
  )

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
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-white hover:bg-neutral-700 text-[12px]"
          >×</button>
        </div>

        {error && <p className="text-[10px] text-red-400">{error}</p>}

        <div className="border border-neutral-800 rounded flex-1 min-h-0 flex flex-col">
          {/* Hidden while loading and while there is nothing saved at all — a
              filter over an empty list is just a control that can't do
              anything. It stays put once a filter has emptied the list, so
              there is always a way to clear the query. */}
          {!loading && projects.length > 0 && (
            <SortFilterBar
              query={query} onQueryChange={setQuery}
              sortBy={sortBy} onSortByChange={setSortBy}
              sortDir={sortDir} onSortDirChange={setSortDir}
            />
          )}

          <ul className="flex-1 overflow-y-auto divide-y divide-neutral-800">
            {loading ? (
              <li className="px-3 py-3 text-[11px] text-neutral-600 text-center">Loading…</li>
            ) : projects.length === 0 ? (
              <li className="px-3 py-3 text-[11px] text-neutral-600 text-center">
                No saved projects yet — press Save to add the current timeline here.
              </li>
            ) : visible.length === 0 ? (
              <li className="px-3 py-3 text-[11px] text-neutral-600 text-center">
                No project matches “{query}”.
              </li>
            ) : (
              visible.map(p => (
                <li
                  key={p.name}
                  onContextMenu={e => {
                    e.preventDefault()
                    setContextMenu({ position: { x: e.clientX, y: e.clientY }, name: p.name })
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800/70 group"
                >
                  <button
                    onClick={() => handleOpen(p.name)}
                    className="flex-1 min-w-0 text-left"
                    title="Open this project"
                  >
                    <div className="text-[11px] text-neutral-200 truncate">{p.name}</div>
                    <div className="text-[9px] text-neutral-500">{new Date(p.modified * 1000).toLocaleString()}</div>
                  </button>
                  <button
                    onClick={() => handleDelete(p.name)}
                    title="Delete project"
                    className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-neutral-600 hover:text-white hover:bg-red-600 text-[10px] opacity-0 group-hover:opacity-100"
                  >×</button>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Rendered inside the dialog (which stops click propagation) so that
            clicking a menu item can't also reach the backdrop's onClose and
            shut the library out from under the prompt. */}
        {contextMenu && (
          <ContextMenu
            position={contextMenu.position}
            onClose={() => setContextMenu(null)}
            items={[
              { label: 'Rename…', onClick: () => handleRename(contextMenu.name) },
              { label: 'Delete', danger: true, separatorBefore: true, onClick: () => handleDelete(contextMenu.name) },
            ]}
          />
        )}
      </div>
    </div>
  )
}
