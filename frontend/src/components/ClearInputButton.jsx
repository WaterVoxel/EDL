import { clearInput } from '../api'

export default function ClearInputButton({ onCleared }) {
  function handleClick() {
    if (!confirm('Delete all files in input/? This cannot be undone.')) return
    clearInput().then(() => onCleared())
  }

  return (
    <button
      onClick={handleClick}
      className="px-1.5 py-0.5 text-[9px] rounded border border-neutral-700 text-neutral-500 hover:text-red-400 hover:border-red-500"
    >
      Clear All
    </button>
  )
}
