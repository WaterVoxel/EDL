function postJSON(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json())
}

export const listFiles = () => fetch('/api/files').then(r => r.json())
export const listOutputs = () => fetch('/api/outputs').then(r => r.json())
export const probe = (name, dir = 'input') =>
  fetch(`/api/probe/${encodeURIComponent(name)}?dir=${dir}`).then(r => r.json())
export const upload = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json())
}
export const clearInput = () => fetch('/api/clear_input', { method: 'POST' }).then(r => r.json())
export const deleteInputFile = (name) => fetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(r => r.json())
export const clearOutput = () => fetch('/api/clear_output', { method: 'POST' }).then(r => r.json())
export const deleteOutputFile = (name) => fetch(`/api/outputs/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(r => r.json())
// fillNoise is a plain boolean: the server owns the asset path, so there is
// nothing for the client to name.
export const renderTimeline = (clips, output, noAudio = false, audioBed = null, fillNoise = false) =>
  postJSON('/api/render_timeline', { clips, output, noAudio, audioBed, fillNoise })
// Render A1 alone to a .wav. Takes the SAME clip payload a V1 render does — the
// server reads only the timing keys off it, but sending the whole thing keeps
// the two calls interchangeable at the call site. The extension is the server's
// to decide, so `output` is a base name.
export const renderA1 = (clips, output, audioBed = null, fillNoise = false) =>
  postJSON('/api/render_a1', { clips, output, audioBed, fillNoise })
export const reformat = (input, dir, resolution, ratio, output) => postJSON('/api/reformat', { input, dir, resolution, ratio, output })
export const listProjects = () => fetch('/api/projects').then(r => r.json())
export const saveProject = (name, project) => postJSON('/api/projects', { name, project })
export const loadProject = (name) => fetch(`/api/projects/${encodeURIComponent(name)}`).then(r => r.json())
export const deleteProject = (name) => fetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(r => r.json())
export const getExportSettings = () => fetch('/api/export_settings').then(r => r.json())
export const setExportSettings = (settings) => postJSON('/api/export_settings', settings)
export const browseDirectory = (initial) => postJSON('/api/browse_directory', { initial })
// Both take the bin they act on, same 'input'|'output' vocabulary probe() uses,
// defaulting to the Export Bin since that's where they started.
export const revealFile = (name, dir = 'output') => postJSON('/api/reveal_file', { name, dir })
export const renameFile = (name, newName, dir = 'output') => postJSON('/api/rename_file', { name, newName, dir })
export const chat = (message, session_id, selected_clip) => postJSON('/api/chat', { message, session_id, selected_clip })
export const execute = (command) => postJSON('/api/execute', { command })
