import { useState, useEffect, useRef } from 'react'

export default function RenderDialog({ defaultName, showNoAudioOption = false, onConfirm, onCancel }) {
  const [name, setName] = useState(defaultName)
  const [noAudio, setNoAudio] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    // Select just the filename (not extension) for easy renaming
    if (inputRef.current) {
      const dotIdx = defaultName.lastIndexOf('.')
      inputRef.current.focus()
      inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : defaultName.length)
    }
  }, [])

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    // Ensure it has an extension
    const final = trimmed.includes('.') ? trimmed : trimmed + '.mp4'
    onConfirm(final, noAudio)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={handleSubmit}
        className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-4 w-80 flex flex-col gap-3"
      >
        <h3 className="text-sm font-semibold text-neutral-200">Render Timeline</h3>
        <label className="text-[10px] text-neutral-400">Output filename</label>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
          className="px-2.5 py-1.5 text-[12px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
        />
        {showNoAudioOption && (
          <label className="flex items-center gap-1.5 text-[10px] text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={noAudio}
              onChange={e => setNoAudio(e.target.checked)}
              className="accent-indigo-500"
            />
            Render without audio
          </label>
        )}
        <div className="flex justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-[11px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 text-[11px] rounded bg-emerald-600 text-white hover:bg-emerald-500 font-medium"
          >
            Render
          </button>
        </div>
      </form>
    </div>
  )
}
