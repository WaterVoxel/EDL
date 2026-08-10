import { useEffect, useRef } from 'react'

// A minimal right-click context menu. `position` is {x, y} in viewport
// coordinates (from the triggering MouseEvent); `items` is
// [{label, onClick, disabled?}]. Closes on outside click, Escape, or scroll.
export default function ContextMenu({ position, items, onClose }) {
  const menuRef = useRef(null)

  useEffect(() => {
    function handlePointerDown(e) {
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
  }, [onClose])

  if (!position) return null

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 100 }}
      className="min-w-[140px] py-1 rounded-md bg-neutral-800 border border-neutral-700 shadow-xl"
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => { item.onClick(); onClose() }}
          disabled={item.disabled}
          className="block w-full text-left px-3 py-1.5 text-[11px] text-neutral-200 hover:bg-neutral-700 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
