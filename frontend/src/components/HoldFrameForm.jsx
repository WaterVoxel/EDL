import { useState } from 'react'
import NumericStepper from './NumericStepper'

// Head/tail holds always attach to the sequence's outer edges — the first
// clip's head, the last clip's tail — never to a boundary between clips,
// so which clip is "selected" doesn't matter here.
export default function HoldFrameForm({ clips, setClips }) {
  const [duration, setDuration] = useState('1')

  const firstClip = clips[0] || null
  const lastClip = clips[clips.length - 1] || null

  function apply(which) {
    const dur = parseFloat(duration)
    if (Number.isNaN(dur) || dur < 0) return
    const target = which === 'head' ? firstClip : lastClip
    if (!target) return
    const field = which === 'head' ? 'headHoldSec' : 'tailHoldSec'
    // A duration of 0 removes any existing hold on that edge and restores
    // the clip to its original (un-extended) length.
    setClips(prev => prev.map(c =>
      c.id === target.id ? { ...c, [field]: dur, dirty: true } : c
    ))
  }

  const disabled = clips.length === 0

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">Hold</span>
      <NumericStepper
        value={duration}
        onChange={setDuration}
        step={0.1}
        min={0}
        disabled={disabled}
      />
      <button
        onClick={() => apply('head')}
        disabled={disabled}
        title="Freeze the first frame of the sequence"
        className="px-1.5 py-0.5 text-[8px] rounded bg-fuchsia-700 text-white hover:bg-fuchsia-600 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Head
      </button>
      <button
        onClick={() => apply('tail')}
        disabled={disabled}
        title="Freeze the last frame of the sequence"
        className="px-1.5 py-0.5 text-[8px] rounded bg-fuchsia-700 text-white hover:bg-fuchsia-600 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        Tail
      </button>
    </div>
  )
}
