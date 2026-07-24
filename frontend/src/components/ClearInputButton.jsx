import { clearInput } from '../api'

export default function ClearInputButton({ onCleared }) {
  function handleClick() {
    if (!confirm('Delete all files in input/? This cannot be undone.')) return
    clearInput().then(() => onCleared())
  }

  return (
    <button
      onClick={handleClick}
      className="px-2 py-1 text-[10px] rounded border border-neutral-600 text-neutral-400 hover:text-red-400 hover:border-red-500"
    >
      Clear All
    </button>
  )
}
