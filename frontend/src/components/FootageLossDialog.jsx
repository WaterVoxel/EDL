import { useState, useEffect, useRef } from 'react'

// Shown once per session the first time a V1 edit removes source footage, to
// say plainly what that costs later: V2's Reconstruct can only rebuild what a
// V1 render actually CONTAINS, so trimmed and deleted frames have nothing to be
// restored from. Informational, not a confirmation — the edit has already
// applied and Cmd+Z is the way back, so a Cancel button here would only
// duplicate undo with more machinery (it would have to unwind a coalesced
// multi-update drag).
//
// `onClose` receives the checkbox value, so the caller owns persistence.
export default function FootageLossDialog({ lostSec, sourceName, onClose }) {
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const okRef = useRef(null)

  // Focus OK so Return/Space dismisses without reaching for the mouse.
  useEffect(() => { okRef.current?.focus() }, [])

  // Escape closes; Delete/Backspace is SWALLOWED. Timeline's own keydown
  // handler is bound to `document` and only skips INPUT/TEXTAREA, so with the
  // OK button focused a stray Delete would fall through and remove another
  // clip behind this dialog — firing the very loss this popup is describing.
  // Capture phase on document is what stops that: a capture listener on the
  // document runs before the same document's bubble listeners, so
  // stopPropagation here keeps the event from ever reaching Timeline's.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const dontShowRef = useRef(dontShowAgain)
  dontShowRef.current = dontShowAgain
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current(dontShowRef.current)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => onClose(dontShowAgain)}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-neutral-900 border border-amber-700/60 rounded-lg shadow-xl p-4 w-96 flex flex-col gap-3"
      >
        <h3 className="text-sm font-semibold text-amber-400">This footage won't come back</h3>

        <p className="text-xs text-neutral-300">
          You removed <span className="font-mono text-amber-300">{lostSec.toFixed(2)}s</span>
          {sourceName ? <> of <span className="font-mono text-neutral-200">{sourceName}</span></> : null} from V1.
        </p>

        <p className="text-xs text-neutral-400 leading-relaxed">
          <span className="text-teal-400">Reconstruct</span> on V2 can only rebuild what a V1 render
          actually contains. Trimmed and deleted footage is never written to the file, so there is
          nothing for it to restore from — it can un-apply cuts, moves and holds, but it cannot bring
          back frames that were left out.
        </p>

        <p className="text-xs text-neutral-500">
          <span className="font-mono text-neutral-400">Cmd+Z</span> restores it if you didn't mean to.
        </p>

        <div className="flex items-center justify-between gap-3 pt-1">
          <label className="flex items-center gap-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 cursor-pointer">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={e => setDontShowAgain(e.target.checked)}
              className="accent-amber-500"
            />
            Don't show this again
          </label>
          <button
            ref={okRef}
            onClick={() => onClose(dontShowAgain)}
            className="px-3 py-1 text-[11px] rounded bg-amber-600 text-white hover:bg-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
