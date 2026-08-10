// Clip-activity log: round-up warnings, unrendered-edit notices, etc.
// Fills its container's height (matches ChatPanel, its tab-dock sibling)
// instead of a fixed height, so Actions/Assistant don't jump in size when
// toggled.
export default function LogPanel({ messages }) {
  return (
    <div className="rounded-md bg-neutral-900 border border-neutral-800 flex flex-col flex-1 min-h-0">
      <div className="px-2 py-1 border-b border-neutral-800 text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
        Actions
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
        {messages.length === 0 ? (
          <p className="text-[9px] text-neutral-600">No activity.</p>
        ) : (
          messages.map((m, i) => (
            <p key={i} className={`text-[9px] leading-snug ${m.kind === 'warn' ? 'text-amber-400' : m.kind === 'info' ? 'text-amber-400' : 'text-neutral-400'}`}>
              {m.text}
            </p>
          ))
        )}
      </div>
    </div>
  )
}
