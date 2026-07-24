import { formatTimecode } from '../../timecode'

export default function EdlTable({ clips, selectedId, onSelect }) {
  if (clips.length === 0) return null

  let recordIn = 0
  const rows = clips.map((clip, i) => {
    const clipDur = clip.outSec - clip.inSec
    const row = {
      clip,
      event: String(i + 1).padStart(3, '0'),
      reel: clip.sourceName,
      srcIn: clip.inSec,
      srcOut: clip.outSec,
      recIn: recordIn,
      recOut: recordIn + clipDur,
    }
    recordIn += clipDur
    return row
  })

  return (
    <div className="border-t border-neutral-800">
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Edit Decision List
      </div>
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-neutral-500 border-b border-neutral-800">
            <th className="text-left font-normal px-3 py-1">EVT</th>
            <th className="text-left font-normal px-2 py-1">REEL</th>
            <th className="text-left font-normal px-2 py-1">SRC IN</th>
            <th className="text-left font-normal px-2 py-1">SRC OUT</th>
            <th className="text-left font-normal px-2 py-1">REC IN</th>
            <th className="text-left font-normal px-2 py-1">REC OUT</th>
            <th className="text-left font-normal px-2 py-1">STATUS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.clip.id}
              onClick={() => onSelect(row.clip)}
              className={`cursor-pointer border-b border-neutral-900 ${row.clip.id === selectedId ? 'bg-indigo-900/30' : 'hover:bg-neutral-800/50'}`}
            >
              <td className="px-3 py-1 text-neutral-400">{row.event}</td>
              <td className="px-2 py-1 text-neutral-300 truncate max-w-[160px]">{row.reel}</td>
              <td className="px-2 py-1 text-neutral-400">{formatTimecode(row.srcIn, row.clip.fps || 30)}</td>
              <td className="px-2 py-1 text-neutral-400">{formatTimecode(row.srcOut, row.clip.fps || 30)}</td>
              <td className="px-2 py-1 text-neutral-400">{formatTimecode(row.recIn, row.clip.fps || 30)}</td>
              <td className="px-2 py-1 text-neutral-400">{formatTimecode(row.recOut, row.clip.fps || 30)}</td>
              <td className="px-2 py-1">
                {row.clip.dirty
                  ? <span className="text-amber-400">pending</span>
                  : row.clip.renderedInputName
                    ? <span className="text-emerald-400">rendered</span>
                    : <span className="text-neutral-600">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
