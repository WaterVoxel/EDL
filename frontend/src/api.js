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
export const trim = (input, start, end, output) => postJSON('/api/trim', { input, start, end, output })
export const splice = (inputs, output) => postJSON('/api/splice', { inputs, output })
export const holdFrame = (input, time, duration, output) => postJSON('/api/hold_frame', { input, time, duration, output })
export const reverse = (input, confirm) => postJSON('/api/reverse', { input, confirm })
export const chat = (message, session_id) => postJSON('/api/chat', { message, session_id })
export const execute = (command) => postJSON('/api/execute', { command })

export const promoteOutputToInput = async (outputName) => {
  const blob = await fetch(`/output/${encodeURIComponent(outputName)}`).then(r => r.blob())
  return upload(new File([blob], outputName, { type: blob.type }))
}
