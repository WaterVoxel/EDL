import { useState, useEffect, useRef } from 'react'
import { withDefaultExt, shotOutputNames } from '../renderNames'

// `shotCount` > 0 means this render writes one file PER CUT (Render V2's 1+
// mode) rather than one file: the dialog then previews the actual series the
// typed name expands to, live as it's typed, since "one name in, N files out"
// is not something a single filename field can otherwise convey.
export default function RenderDialog({ defaultName, showNoAudioOption = false, shotCount = 0, onConfirm, onCancel }) {
  const [name, setName] = useState(defaultName)
  const [noAudio, setNoAudio] = useState(false)
  const inputRef = useRef(null)
  const shots = shotCount > 0 ? shotOutputNames(name, shotCount) : []

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
    // Ensure it has an extension (withDefaultExt returns '' for a blank name,
    // which is the same nothing-to-render case as before)
    const final = withDefaultExt(name)
    if (!final) return
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
        {/* What 1+ is about to write. Teal, the V2 color, because only a
            Render V2 can be split this way. The middle of a long series is
            elided rather than listed — the first, the last and the count are
            what identify a series; every name in between is the same string
            with a different number. */}
        {shots.length > 0 && (
          <div className="flex flex-col gap-1 -mt-1">
            <span className="text-[10px] text-teal-400">
              {shots.length} {shots.length === 1 ? 'shot' : 'shots'} — one file per cut:
            </span>
            <span className="text-[10px] font-mono text-neutral-400 break-all">
              {shots.length <= 3
                ? shots.join(', ')
                : `${shots[0]}, ${shots[1]}, … ${shots[shots.length - 1]}`}
            </span>
            <span className="text-[9px] text-neutral-500 leading-snug">
              Each shot is its own render pass, so it keeps its own resolution and frame rate
              instead of matching the largest clip on the track — and, in a size-capped quality
              mode, gets its own size budget.
            </span>
          </div>
        )}
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
