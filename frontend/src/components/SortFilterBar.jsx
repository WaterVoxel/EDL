export default function SortFilterBar({ query, onQueryChange, sortBy, onSortByChange, sortDir, onSortDirChange }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-neutral-800">
      <input
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        placeholder="Filter…"
        className="flex-1 min-w-0 px-1.5 py-0.5 text-[10px] rounded bg-neutral-950 border border-neutral-700 text-neutral-300 placeholder:text-neutral-600"
      />
      <select
        value={sortBy}
        onChange={e => onSortByChange(e.target.value)}
        className="text-[10px] rounded bg-neutral-950 border border-neutral-700 text-neutral-300 px-1 py-0.5"
      >
        <option value="name">Name</option>
        <option value="date">Date</option>
      </select>
      <button
        onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
        title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
        className="w-5 h-5 flex items-center justify-center text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200"
      >
        {sortDir === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  )
}
