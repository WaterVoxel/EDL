import { clipTotalSec } from '../../clipMath'

export default function Ruler({ clips, pps }) {
  const totalDuration = clips.reduce((sum, c) => sum + clipTotalSec(c), 0)
  const totalWidth = totalDuration * pps + clips.length * 2

  // one tick per second, labeled every 5s to stay readable at typical zoom
  const tickCount = Math.ceil(totalDuration)
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i)

  return (
    <div className="relative h-5 bg-neutral-900 border-b border-neutral-800" style={{ width: Math.max(totalWidth, 1), minWidth: '100%' }}>
      {ticks.map(t => (
        <div key={t} className="absolute top-0 bottom-0" style={{ left: t * pps }}>
          <div className={`w-px bg-neutral-700 ${t % 5 === 0 ? 'h-2.5' : 'h-1.5'}`} />
          {t % 5 === 0 && (
            <span className="absolute left-1 top-0 text-[9px] text-neutral-500 leading-none">{t}s</span>
          )}
        </div>
      ))}
    </div>
  )
}
