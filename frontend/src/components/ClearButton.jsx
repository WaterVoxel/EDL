export default function ClearButton({ label, confirmText, onClear }) {
  function handleClick() {
    if (!confirm(confirmText)) return
    onClear()
  }

  return (
    <button
      onClick={handleClick}
      className="px-1.5 py-0.5 text-[9px] rounded border border-neutral-700 text-neutral-500 hover:text-red-400 hover:border-red-500"
    >
      {label || 'Clear'}
    </button>
  )
}
