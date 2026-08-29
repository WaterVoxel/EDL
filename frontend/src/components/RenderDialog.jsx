import { useState, useEffect, useRef } from 'react'
import { withDefaultExt, shotOutputNames } from '../renderNames'

// `shotCount` > 0 means this render writes one file PER CUT (V2 Render's 1+
// mode) rather than one file: the dialog then previews the actual series the
// typed name expands to, live as it's typed, since "one name in, N files out"
// is not something a single filename field can otherwise convey.
//
// `shotStems` is that series' clip names, one per shot in cut order — what the
// **V1 name** box uses, and the reason the three naming controls appear only on
// a batch: a single render already gets its whole name typed into the field, so
// there is nothing there for a per-clip name or an affix to add. One shot's
// stems in, the same `shotOutputNames` the render itself calls, so the names
// previewed here are the names written.
export default function RenderDialog({ defaultName, showNoAudioOption = false, shotCount = 0, shotStems = [], onConfirm, onCancel }) {
  const [name, setName] = useState(defaultName)
  const [noAudio, setNoAudio] = useState(false)
  // On by default, as the feature was asked for: a batch is normally wanted
  // named after its clips, and the typed name is the fallback rather than the
  // rule. Only offered when the caller actually handed over one stem per shot —
  // a mismatch would preview names the render can't reproduce.
  const clipNamesOffered = shotCount > 0 && shotStems.length === shotCount
  const [useClipNames, setUseClipNames] = useState(true)
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const inputRef = useRef(null)
  const byClip = clipNamesOffered && useClipNames
  const shots = shotCount > 0
    ? shotOutputNames(name, shotCount, { stems: byClip ? shotStems : null, prefix, suffix })
    : []

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
    // The naming choices go out as the choices, not as the finished names: the
    // render loop already walks the same cuts in the same order and calls the
    // same shotOutputNames, so handing it the flags keeps one function deciding
    // what a series is called. A non-batch render passes them too and ignores
    // them — there is no series to name.
    onConfirm(final, noAudio, { useClipNames: byClip, prefix, suffix })
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
        {/* How the series is named — only on a batch (see the shotStems note
            above). The three controls sit between the typed name and the
            preview of the series below, so the list reads as the result of
            everything above it. */}
        {shotCount > 0 && (
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-1.5 text-[10px] text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={byClip}
                disabled={!clipNamesOffered}
                onChange={e => setUseClipNames(e.target.checked)}
                className="accent-indigo-500 mt-0.5"
              />
              <span>
                <span className="text-neutral-300">V1 name</span> — name each file after the clip
                it renders. The typed name then only supplies the extension, and cuts that share a
                clip name are numbered in cut order.
              </span>
            </label>
            {/* `min-w-0` on the LABELS and `w-full` on the inputs are what keep
                this row inside the dialog. `flex-1` alone does not: a flex
                item's min-width is `auto`, i.e. its content's min-content width,
                and an `<input>` with no width of its own asks for ~161px here
                (the `size=20` default) — two of those plus the gap overflowed
                this 320px dialog's 288px content box by a measured 44px, with
                the Suffix field hanging out past the right edge. Either class
                cures it on its own (measured: 139px each, both edges inside);
                both are set so that neither an input losing `w-full` nor a
                wrapper losing `min-w-0` brings the overflow back. Any field put
                side by side in here needs the same pair. */}
            <div className="flex gap-2">
              <label className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="text-[10px] text-neutral-400">Prefix</span>
                <input
                  value={prefix}
                  onChange={e => setPrefix(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
                  className="w-full min-w-0 px-2 py-1 text-[11px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                />
              </label>
              <label className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="text-[10px] text-neutral-400">Suffix</span>
                <input
                  value={suffix}
                  onChange={e => setSuffix(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
                  className="w-full min-w-0 px-2 py-1 text-[11px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                />
              </label>
            </div>
          </div>
        )}
        {/* What 1+ is about to write. Teal, the V2 color, because only a
            V2 Render can be split this way. The middle of a long series is
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
