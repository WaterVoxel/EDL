import { useState, useRef } from 'react'
import { chat, execute } from '../api'

export default function ChatPanel({ onResult }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [loading, setLoading] = useState(false)
  const logRef = useRef(null)

  function scrollBottom() {
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, 50)
  }

  async function handleSend() {
    const msg = input.trim()
    if (!msg) return
    setInput('')
    const entry = { role: 'user', text: msg }
    setMessages(prev => [...prev, entry])
    setLoading(true)
    scrollBottom()

    const data = await chat(msg, sessionId)
    setLoading(false)
    if (data.session_id) setSessionId(data.session_id)

    if (data.error) {
      setMessages(prev => [...prev, { role: 'error', text: data.error + (data.detail ? ' — ' + data.detail : '') }])
    } else if (data.needs_clarification) {
      setMessages(prev => [...prev, { role: 'assistant', text: data.explanation, clarification: true }])
    } else if (!data.valid) {
      setMessages(prev => [...prev, { role: 'assistant', text: data.explanation, command: data.ffmpeg_command, rejected: data.validation_error }])
    } else {
      setMessages(prev => [...prev, { role: 'assistant', text: data.explanation, command: data.ffmpeg_command, runnable: true }])
    }
    scrollBottom()
  }

  async function handleRun(command, idx) {
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, running: true } : m))
    const res = await execute(command)
    if (res.error) {
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, running: false, execError: res.error + (res.detail ? ' — ' + res.detail : '') } : m))
    } else {
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, running: false, done: true } : m))
      onResult()
    }
  }

  function handleNew() {
    setSessionId(null)
    setMessages([])
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-neutral-300">Chat</h2>
        <button onClick={handleNew} className="px-2 py-0.5 text-[10px] rounded border border-neutral-600 text-neutral-400 hover:text-neutral-200">New</button>
      </div>
      <div ref={logRef} className="flex-1 min-h-[120px] max-h-60 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-900 p-2 text-xs space-y-2">
        {messages.map((m, i) => (
          <div key={i}>
            {m.role === 'user' && <p className="text-neutral-400"><span className="text-neutral-200 font-medium">You:</span> {m.text}</p>}
            {m.role === 'error' && <p className="text-red-400">{m.text}</p>}
            {m.role === 'assistant' && (
              <div>
                <p className="text-neutral-300">{m.text}</p>
                {m.command && <pre className="mt-1 p-2 rounded bg-neutral-800 text-neutral-400 overflow-x-auto whitespace-pre-wrap">{m.command}</pre>}
                {m.rejected && <p className="text-amber-400 mt-1">Rejected: {m.rejected}</p>}
                {m.clarification && <p className="text-neutral-500 mt-1">Reply below to answer — I'll remember this conversation.</p>}
                {m.runnable && !m.done && !m.running && !m.execError && (
                  <div className="mt-1 space-x-2">
                    <button onClick={() => handleRun(m.command, i)} className="px-2 py-0.5 rounded bg-green-700 text-white hover:bg-green-600">Run</button>
                    <button onClick={() => setMessages(prev => prev.map((x, j) => j === i ? { ...x, runnable: false, cancelled: true } : x))} className="px-2 py-0.5 rounded border border-neutral-600 text-neutral-400 hover:text-neutral-200">Cancel</button>
                  </div>
                )}
                {m.running && <p className="text-neutral-500 mt-1">Running...</p>}
                {m.done && <p className="text-green-400 mt-1">Done.</p>}
                {m.cancelled && <p className="text-neutral-500 mt-1">Cancelled.</p>}
                {m.execError && <p className="text-red-400 mt-1">Failed: {m.execError}</p>}
              </div>
            )}
          </div>
        ))}
        {loading && <p className="text-neutral-500">Thinking...</p>}
      </div>
      <div className="flex mt-2 gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
          placeholder="e.g. cut the first 3 seconds and reverse it"
          className="flex-1 px-2 py-1.5 text-xs rounded bg-neutral-900 border border-neutral-600 text-neutral-300 placeholder:text-neutral-600"
        />
        <button onClick={handleSend} disabled={loading} className="px-3 py-1.5 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-600">Send</button>
      </div>
    </div>
  )
}
