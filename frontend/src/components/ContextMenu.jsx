import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// A minimal menu, used two ways: as a right-click context menu (`position` from
// the triggering MouseEvent) and as a button's drop-down (`position` from the
// trigger's own getBoundingClientRect, plus `ignoreRef`). `items` is
// [{label, onClick, disabled?, danger?, separatorBefore?}] — `label` may be a
// node, not just a string, which is how an item carries a status marker;
// `danger` draws the item in red and `separatorBefore` rules a line above it,
// the two things an irreversible action (Delete) needs to not sit flush with the
// harmless ones. Closes on outside click, Escape, or scroll.
//
// `ignoreRef` is the element whose click OPENED the menu, and it exists because
// that element is by definition outside the menu: without it the trigger's own
// pointerdown closes the menu a moment before its click reopens it, so the
// button could never be used to toggle the thing shut.
export default function ContextMenu({ position, items, onClose, ignoreRef = null }) {
  const menuRef = useRef(null)

  useEffect(() => {
    function handlePointerDown(e) {
      if (ignoreRef?.current?.contains(e.target)) return
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', onClose, true)
    }
  }, [onClose, ignoreRef])

  // Nudged back inside the viewport AFTER it renders, because the menu's width
  // is its longest label's — not knowable before the paint, so a caller can't
  // right-align it by arithmetic. Matters most for a drop-down hung off a button
  // near the right edge of the window, which is where the top bar's are.
  const [shift, setShift] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!position || !menuRef.current) return
    const r = menuRef.current.getBoundingClientRect()
    const MARGIN = 8
    const x = Math.min(0, window.innerWidth - MARGIN - (position.x + r.width))
    const y = Math.min(0, window.innerHeight - MARGIN - (position.y + r.height))
    // Returns the SAME object when nothing moved, which is what stops this
    // becoming an infinite loop: `items` is an inline array at every call site,
    // so a fresh identity arrives on every render and re-runs the effect.
    setShift(prev => (prev.x === x && prev.y === y ? prev : { x, y }))
  }, [position, items])

  if (!position) return null

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: position.x + shift.x, top: position.y + shift.y, zIndex: 100 }}
      className="min-w-[140px] py-1 rounded-md bg-neutral-800 border border-neutral-700 shadow-xl"
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separatorBefore && <div className="my-1 border-t border-neutral-700" />}
          <button
            onClick={() => { item.onClick(); onClose() }}
            disabled={item.disabled}
            className={`block w-full text-left px-3 py-1.5 text-[11px] disabled:opacity-40 disabled:hover:bg-transparent ${
              item.danger
                ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                : 'text-neutral-200 hover:bg-neutral-700'
            }`}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}
