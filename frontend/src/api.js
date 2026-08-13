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
export const renderTimeline = (clips, output, noAudio = false, audioBed = null) =>
  postJSON('/api/render_timeline', { clips, output, noAudio, audioBed })
export const reformat = (input, dir, resolution, ratio, output) => postJSON('/api/reformat', { input, dir, resolution, ratio, output })
export const listProjects = () => fetch('/api/projects').then(r => r.json())
export const saveProject = (name, project) => postJSON('/api/projects', { name, project })
export const loadProject = (name) => fetch(`/api/projects/${encodeURIComponent(name)}`).then(r => r.json())
export const deleteProject = (name) => fetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(r => r.json())
export const getExportSettings = () => fetch('/api/export_settings').then(r => r.json())
export const setExportSettings = (settings) => postJSON('/api/export_settings', settings)
export const browseDirectory = (initial) => postJSON('/api/browse_directory', { initial })
export const revealFile = (name) => postJSON('/api/reveal_file', { name })
export const renameOutput = (name, newName) => postJSON('/api/rename_output', { name, newName })
export const chat = (message, session_id, selected_clip) => postJSON('/api/chat', { message, session_id, selected_clip })
export const execute = (command) => postJSON('/api/execute', { command })
