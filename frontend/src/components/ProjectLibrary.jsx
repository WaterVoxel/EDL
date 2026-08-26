import { useState, useEffect } from 'react'
import { listProjects, loadProject, deleteProject } from '../api'

export default function ProjectLibrary({ onOpen, onClose }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // setLoading(false) lived inside the .then, so a failed listing left the dialog
  // reading "Loading…" forever with the error state never set — the library
  // looked like it was still working when it had already given up. The catch puts
  // the reason in the banner this component already renders and stops the spin.
  function refresh() {
    setLoading(true)
    listProjects().then(items => {
      setProjects([...items].sort((a, b) => b.modified - a.modified))
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

        <ul className="flex-1 overflow-y-auto divide-y divide-neutral-800 border border-neutral-800 rounded">
          {loading ? (
            <li className="px-3 py-3 text-[11px] text-neutral-600 text-center">Loading…</li>
          ) : projects.length === 0 ? (
            <li className="px-3 py-3 text-[11px] text-neutral-600 text-center">
              No saved projects yet — press Save to add the current timeline here.
            </li>
          ) : (
            projects.map(p => (
              <li key={p.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800/70 group">
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
    </div>
  )
}
