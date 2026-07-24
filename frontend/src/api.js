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
export const clearOutput = () => fetch('/api/clear_output', { method: 'POST' }).then(r => r.json())
export const renderTimeline = (clips, output) => postJSON('/api/render_timeline', { clips, output })
export const reverse = (input, confirm) => postJSON('/api/reverse', { input, confirm })
export const chat = (message, session_id) => postJSON('/api/chat', { message, session_id })
export const execute = (command) => postJSON('/api/execute', { command })
