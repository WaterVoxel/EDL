import { useState, useEffect, useRef } from 'react'
import NumericStepper from './NumericStepper'
import { holdFrames, sequenceTargetFps } from '../clipMath'

// Head/tail holds always attach to the sequence's outer edges — the first
// clip's head, the last clip's tail — never to a boundary between clips,
// so which clip is "selected" doesn't matter here.
//
// `displayMode` is the shared timecode/frames toggle in the transport bar, the
// same one Trim follows: in 'frames' the field counts frames instead of seconds,
// so a hold can be asked for in the same unit the clock is showing.
export default function HoldFrameForm({ clips, setClips, displayMode = 'timecode' }) {
  const [duration, setDuration] = useState('1')

  const firstClip = clips[0] || null
  const lastClip = clips[clips.length - 1] || null

  // The hold is ALWAYS stored in seconds (headHoldSec/tailHoldSec); fps here is
  // only the unit the field is read and written in. It's the sequence's render
  // grid — what the transport clock and Round Up count on — rather than the
  // first/last clip's own rate, so a frame typed here means a frame of the
  // finished render, the only frame count shown anywhere else. (Identical on a
  // single-fps sequence, which is all of them so far; the render still
  // re-quantizes the hold on its clip's own fps, per clipRenderFrames.)
  const fps = sequenceTargetFps(clips)

  // Unlike Trim's fields this value isn't derived from a clip — it's the user's
  // own standing entry, kept across a toggle — so flipping TC/FR has to convert
  // it in place. Left alone, "1" second would silently become "1" frame and the
  // next Head press would apply a 42ms hold instead of a 1s one.
  const modeRef = useRef(displayMode)
  useEffect(() => {
    if (modeRef.current === displayMode) return
    const from = modeRef.current
    modeRef.current = displayMode
    setDuration(prev => {
      const n = parseFloat(prev)
      if (Number.isNaN(n) || n < 0) return prev
      // holdFrames is the render's own hold quantization (round half-to-even),
      // not Math.round — see clipMath's note on why that difference is real.
      return from === 'frames' ? String(parseFloat((n / fps).toFixed(4))) : String(holdFrames(n, fps))
    })
  }, [displayMode, fps])

  function apply(which) {
    const typed = parseFloat(duration)
    if (Number.isNaN(typed) || typed < 0) return
    const dur = displayMode === 'frames' ? typed / fps : typed
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
        step={displayMode === 'frames' ? 1 : 0.1}
        min={0}
        disabled={disabled}
      />
      <button
        onClick={() => apply('head')}
        disabled={disabled}
        title="Freeze the first frame of the sequence"
        className="px-1.5 py-0.5 text-[8px] rounded bg-fuchsia-300/15 border border-fuchsia-300/50 text-fuchsia-200 hover:bg-fuchsia-300/25 disabled:bg-transparent disabled:border-neutral-700 disabled:text-neutral-600"
      >
        Head
      </button>
      <button
        onClick={() => apply('tail')}
        disabled={disabled}
        title="Freeze the last frame of the sequence"
        className="px-1.5 py-0.5 text-[8px] rounded bg-fuchsia-300/15 border border-fuchsia-300/50 text-fuchsia-200 hover:bg-fuchsia-300/25 disabled:bg-transparent disabled:border-neutral-700 disabled:text-neutral-600"
      >
        Tail
      </button>
    </div>
  )
}
