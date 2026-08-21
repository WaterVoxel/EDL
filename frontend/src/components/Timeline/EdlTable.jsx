import { formatTimecode } from '../../timecode'
import { clipTotalSec } from '../../clipMath'

// `onMove(clipId, delta)` reorders by one slot. Worth having here and not only on
// the timeline: these rows are full width whatever a clip's duration is, so they
// stay easy to hit for the short pieces a Split leaves behind — and this list IS
// the order that V2 Analyzer / Batch Analyzer / Reconstruct read off V1, so it's
// the natural place to correct it.
export default function EdlTable({ clips, selectedId, onSelect, onDelete, onMove }) {
  if (clips.length === 0) return null

  let recordIn = 0
  const rows = clips.map((clip, i) => {
    const totalDur = clipTotalSec(clip)
    const row = {
      clip,
      index: i,
      event: String(i + 1).padStart(3, '0'),
      reel: clip.displayName || clip.sourceName,
      srcIn: clip.inSec,
      srcOut: clip.outSec,
      recIn: recordIn,
      recOut: recordIn + totalDur,
      headHoldSec: clip.headHoldSec || 0,
      tailHoldSec: clip.tailHoldSec || 0,
    }
    recordIn += totalDur
    return row
  })

  return (
    <div className="border-t border-neutral-800">
      <div className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
        Edit Decision List
      </div>
      {/* Fixed height (not max-height) — holds exactly the header + 4 EVT
          rows and never resizes as clips are added/removed/split; a 5th
          row scrolls within this same box instead of growing it. */}
      <div className="h-[90px] overflow-y-auto">
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="text-neutral-500 border-b border-neutral-800">
            <th className="text-left font-normal px-2.5 py-0.5">EVT</th>
            <th className="text-left font-normal px-1.5 py-0.5">REEL</th>
            <th className="text-left font-normal px-1.5 py-0.5">SRC IN</th>
            <th className="text-left font-normal px-1.5 py-0.5">SRC OUT</th>
            <th className="text-left font-normal px-1.5 py-0.5">REC IN</th>
            <th className="text-left font-normal px-1.5 py-0.5">REC OUT</th>
            <th className="text-left font-normal px-1.5 py-0.5">HOLD H/T</th>
            <th className="text-left font-normal px-1.5 py-0.5">STATUS</th>
            <th className="w-16"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.clip.id}
              onClick={() => onSelect(row.clip)}
              className={`cursor-pointer border-b border-neutral-900 group ${row.clip.id === selectedId ? 'bg-indigo-900/30' : 'hover:bg-neutral-800/50'}`}
            >
              <td className="px-2.5 py-0.5 text-neutral-400">{row.event}</td>
              <td className="px-1.5 py-0.5 text-neutral-300 truncate max-w-[140px]">
                {row.clip.isDuplicate && <span title="Duplicate of another clip on this track">⧉ </span>}
                {row.clip.reversed && <span title="Reversed">◀ </span>}
                {row.reel}
              </td>
              <td className="px-1.5 py-0.5 text-neutral-400">{formatTimecode(row.srcIn, row.clip.fps || 30)}</td>
              <td className="px-1.5 py-0.5 text-neutral-400">{formatTimecode(row.srcOut, row.clip.fps || 30)}</td>
              <td className="px-1.5 py-0.5 text-neutral-400">{formatTimecode(row.recIn, row.clip.fps || 30)}</td>
              <td className="px-1.5 py-0.5 text-neutral-400">{formatTimecode(row.recOut, row.clip.fps || 30)}</td>
              <td className="px-1.5 py-0.5 text-fuchsia-400">
                {row.headHoldSec > 0 || row.tailHoldSec > 0
                  ? `${row.headHoldSec.toFixed(1)}s / ${row.tailHoldSec.toFixed(1)}s`
                  : <span className="text-neutral-600">—</span>}
              </td>
              <td className="px-1.5 py-0.5">
                {row.clip.dirty
                  ? <span className="text-amber-400">pending</span>
                  : <span className="text-emerald-400">rendered</span>}
              </td>
              <td className="px-1.5 py-0.5">
                {/* Every button here stops propagation, or the row's own onClick
                    would also fire and re-select the clip mid-action. ▲/▼ are
                    earlier/later in the sequence — the list runs top to bottom
                    where the timeline runs left to right. */}
                <div className="flex items-center gap-0.5">
                  {onMove && (
                    <>
                      <button
                        onClick={e => { e.stopPropagation(); onMove(row.clip.id, -1) }}
                        disabled={row.index === 0}
                        title="Move this clip one slot earlier (⌥←)"
                        className="w-4 h-4 flex items-center justify-center rounded text-neutral-600 hover:text-white hover:bg-teal-600 disabled:opacity-0 opacity-0 group-hover:opacity-100 text-[9px] leading-none"
                      >
                        ▲
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); onMove(row.clip.id, 1) }}
                        disabled={row.index === clips.length - 1}
                        title="Move this clip one slot later (⌥→)"
                        className="w-4 h-4 flex items-center justify-center rounded text-neutral-600 hover:text-white hover:bg-teal-600 disabled:opacity-0 opacity-0 group-hover:opacity-100 text-[9px] leading-none"
                      >
                        ▼
                      </button>
                    </>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(row.clip.id) }}
                    title="Delete clip"
                    className="w-4 h-4 flex items-center justify-center rounded text-neutral-600 hover:text-white hover:bg-red-600 opacity-0 group-hover:opacity-100 text-[10px] leading-none"
                  >
                    ×
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
