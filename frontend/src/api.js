// Thrown when the server's reply cannot be read as JSON at all, or when the
// request never completed. `status` is the HTTP status, or 0 when nothing came
// back. Typed so a call site can tell "the backend is down" (status 0) from "the
// backend answered with something unreadable" — they need different advice.
export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// Every call in this file goes through here. It has exactly two jobs.
//
// 1. A JSON body is returned AS-IS, success or failure alike. This is load-
//    bearing: every call site already reads `result.error` (and Save reads
//    `result.exists` off a 409), so an error the server described on purpose
//    must keep arriving as a parsed object, NOT as a thrown exception. Adding a
//    bare `r.ok` check here would have broken all of that.
// 2. A body that is NOT JSON becomes a thrown ApiError. This is the fix: Flask
//    answers anything unplanned with an HTML page, `r.json()` rejects on it, and
//    with no .catch anywhere the rejection went nowhere — the spinner cleared,
//    no alert fired, and the user was left with a UI that had simply stopped.
//    The backend now returns JSON for those cases too, so this is the second
//    line of defence: a dev-server proxy error, a truncated reply, or a route
//    added later that forgets the shape.
async function apiFetch(path, init) {
  let r
  try {
    r = await fetch(path, init)
  } catch {
    // fetch rejects only when the request never completed: backend not running,
    // Flask restarting mid-call (the reloader does this on every save), or the
    // connection dropped. The browser's own text for this is "Failed to fetch",
    // which tells the user nothing they can act on.
    throw new ApiError('cannot reach the backend — is the server on 127.0.0.1:5001 running?', 0)
  }
  const text = await r.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError(
      r.status >= 400
        ? `server error ${r.status}${r.statusText ? ' ' + r.statusText : ''}`
        : `unreadable reply from the server (HTTP ${r.status})`,
      r.status,
    )
  }
}

function postJSON(path, body) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const listFiles = () => apiFetch('/api/files')
export const listOutputs = () => apiFetch('/api/outputs')
export const probe = (name, dir = 'input') =>
  apiFetch(`/api/probe/${encodeURIComponent(name)}?dir=${dir}`)
export const upload = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return apiFetch('/api/upload', { method: 'POST', body: fd })
}
export const clearInput = () => apiFetch('/api/clear_input', { method: 'POST' })
export const deleteInputFile = (name) => apiFetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' })
export const clearOutput = () => apiFetch('/api/clear_output', { method: 'POST' })
export const deleteOutputFile = (name) => apiFetch(`/api/outputs/${encodeURIComponent(name)}`, { method: 'DELETE' })
// audioBeds is the A1 lane in lane order — the order the clips play in, which
// is the order the server concatenates them in.
// fillNoise is a plain boolean: the server owns the asset path, so there is
// nothing for the client to name.
// `settings` is the open-ended tail for render-wide knobs (today: noiseGainDb),
// spread flat into the body. Positional parameters ran out at five, and each new
// one made the call sites read as a row of anonymous booleans; a named object
// also lets a caller omit a knob entirely, which is what makes the server's
// "key absent → the graph an older client always got" default reachable.
export const renderTimeline = (clips, output, noAudio = false, audioBeds = [], fillNoise = false, settings = {}) =>
  postJSON('/api/render_timeline', { clips, output, noAudio, audioBeds, fillNoise, ...settings })
// Render the A1 track alone to a .wav (the A1 Render button). Takes the SAME clip payload a V1 render does — the
// server reads only the timing keys off it, but sending the whole thing keeps
// the two calls interchangeable at the call site. The extension is the server's
// to decide, so `output` is a base name.
export const renderA1 = (clips, output, audioBeds = [], fillNoise = false, settings = {}) =>
  postJSON('/api/render_a1', { clips, output, audioBeds, fillNoise, ...settings })
export const reformat = (input, dir, resolution, ratio, output) => postJSON('/api/reformat', { input, dir, resolution, ratio, output })
export const listProjects = () => apiFetch('/api/projects')
// `overwrite` defaults to false so a save can never silently replace an existing
// project: the server answers 409 with {exists} and the caller asks the user
// first. Pass true only after that confirmation, or when saving the project
// already open (where replacing the file is the whole point).
export const saveProject = (name, project, overwrite = false) =>
  postJSON('/api/projects', { name, project, overwrite })
export const loadProject = (name) => apiFetch(`/api/projects/${encodeURIComponent(name)}`)
export const deleteProject = (name) => apiFetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' })
// `newName` may be given with or without `.nara` — the server supplies the
// extension, same as renameFile below. It refuses an existing target (409)
// rather than replacing it, so the reply's `error` is the thing to surface.
export const renameProject = (name, newName) =>
  postJSON(`/api/projects/${encodeURIComponent(name)}/rename`, { newName })
export const getExportSettings = () => apiFetch('/api/export_settings')
export const setExportSettings = (settings) => postJSON('/api/export_settings', settings)
export const browseDirectory = (initial) => postJSON('/api/browse_directory', { initial })
// Both take the bin they act on, same 'input'|'output' vocabulary probe() uses,
// defaulting to the Export Bin since that's where they started.
export const revealFile = (name, dir = 'output') => postJSON('/api/reveal_file', { name, dir })
export const renameFile = (name, newName, dir = 'output') => postJSON('/api/rename_file', { name, newName, dir })
export const chat = (message, session_id, selected_clip) => postJSON('/api/chat', { message, session_id, selected_clip })
export const execute = (command) => postJSON('/api/execute', { command })
// What the BACKEND booted with. The bundle already knows its own version
// (`import.meta.env.VITE_APP_VERSION`, fed from the same VERSION file by
// vite.config), so this exists only to catch the two disagreeing — a browser
// holding a stale bundle against a restarted server. Resolves to `{}` rather
// than rejecting: the version readout is metadata, and it must never be the
// thing that breaks a mount if the backend is down.
export const getVersion = () => apiFetch('/api/version').catch(() => ({}))
