import { useState, useEffect } from 'react'
import { formatTimecode, parseTimecode } from '../../timecode'
import { roundFrames } from '../../clipMath'

// This bar is the app's headline program length, so both halves of it are
// measured on the RENDER's frame grid (Timeline.jsx hands down `fps` =
// sequenceTargetFps and `totalFrames` = sequenceRenderFrames). `totalDuration`
// is the raw playback domain and is used for nothing but clamping a seek — the
// two are deliberately different, see the comment on renderFps in Timeline.jsx.
export default function TransportBar({
  playing, looping, timelinePos, totalDuration, totalFrames, fps,
  onPlay, onStop, onGoToStart, onGoToEnd, onStepFrames, onToggleLoop, onSeekTimeline,
  displayMode, onToggleDisplayMode,
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  // Frames are numbered 0..totalFrames-1, so the LAST frame is one less than the
  // length: on a 14.000s / 336-frame render, "go to last frame" reads
  // 00:00:13:23 against a total of 00:00:14:00 — a position against a duration,
  // the ordinary NLE reading, not two answers to one question.
  //
  // The clamp is what enforces that. The playhead lives in the raw domain, which
  // runs a fraction of a frame either side of the render's own length and
  // accumulates per clip, so without it the end of a long mixed-fps sequence
  // could name a frame past the end of the file (337 of 336). roundFrames, not
  // Math.round, for the reason the whole frame mirror uses it (clipMath).
  const lastFrame = Math.max(totalFrames - 1, 0)
  const currentFrame = Math.min(roundFrames(timelinePos * fps), lastFrame)
  const totalSec = totalFrames / fps

  // Both display modes are derived from the SAME frame number, so TC and FR can
  // never name two different instants — and feeding formatTimecode an exact
  // frame multiple means its own internal Math.round has no tie to get wrong.
  const displayValue = displayMode === 'timecode'
    ? formatTimecode(currentFrame / fps, fps)
    : `${currentFrame}`

  useEffect(() => {
    if (!editing) {
      setEditValue(displayValue)
    }
  }, [displayValue, editing])

  function handleEditSubmit(e) {
    e.preventDefault()
    setEditing(false)
    const trimmed = editValue.trim()
    if (!trimmed) return

    if (displayMode === 'frames') {
      const f = parseInt(trimmed, 10)
      if (!Number.isNaN(f)) {
        onSeekTimeline(Math.max(0, Math.min(f / fps, totalDuration)))
      }
    } else {
      const parsed = parseTimecode(trimmed, fps)
      if (parsed != null) {
        onSeekTimeline(Math.max(0, Math.min(parsed, totalDuration)))
      }
    }
  }

  function handleStep(dir) {
    onStepFrames(dir)
  }

  const disabled = totalDuration === 0

  return (
    <div className="flex items-center gap-1.5">
      {/* Go to start */}
      <button
        onClick={onGoToStart}
        disabled={disabled}
        title="Go to first frame"
        className="w-5 h-5 flex items-center justify-center rounded text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-700 disabled:opacity-40"
      >⏮</button>

      {/* Step backward */}
      <button
        onClick={() => handleStep(-1)}
        disabled={disabled}
        title="Step one frame back"
        className="w-5 h-5 flex items-center justify-center rounded text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-700 disabled:opacity-40"
      >◁</button>

      {/* Play / Stop */}
      <button
        onClick={playing ? onStop : onPlay}
        disabled={disabled}
        title={playing ? 'Stop' : 'Play'}
        className={`w-6 h-5 flex items-center justify-center rounded text-[11px] ${
          playing ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-emerald-600 text-white hover:bg-emerald-500'
        } disabled:opacity-40`}
      >{playing ? '■' : '▶'}</button>

      {/* Step forward */}
      <button
        onClick={() => handleStep(1)}
        disabled={disabled}
        title="Step one frame forward"
        className="w-5 h-5 flex items-center justify-center rounded text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-700 disabled:opacity-40"
      >▷</button>

      {/* Go to end */}
      <button
        onClick={onGoToEnd}
        disabled={disabled}
        title="Go to last frame"
        className="w-5 h-5 flex items-center justify-center rounded text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-700 disabled:opacity-40"
      >⏭</button>

      {/* Loop toggle */}
      <button
        onClick={onToggleLoop}
        disabled={disabled}
        title={looping ? 'Loop ON' : 'Loop OFF'}
        className={`w-5 h-5 flex items-center justify-center rounded text-[11px] ${
          looping ? 'text-indigo-400 bg-indigo-900/50' : 'text-neutral-500 hover:text-white hover:bg-neutral-700'
        } disabled:opacity-40`}
      >⟳</button>

      <div className="w-px h-3.5 bg-neutral-700 mx-0.5" />

      {/* Timecode / Frame display with numeric stepping */}
      <div className="flex items-center gap-0.5">
        {editing ? (
          <form onSubmit={handleEditSubmit} className="flex items-center">
            <input
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
              className="w-[88px] px-1 py-0.5 text-[10px] font-mono rounded bg-neutral-950 border border-indigo-500 text-neutral-200"
            />
          </form>
        ) : (
          <button
            onClick={() => setEditing(true)}
            disabled={disabled}
            title="Click to edit position"
            className="w-[88px] px-1 py-0.5 text-[10px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-200 text-left hover:border-neutral-500 disabled:opacity-40"
          >
            {disabled ? '--:--:--:--' : displayValue}
          </button>
        )}

        {/* Numeric up/down steppers */}
        <div className="flex flex-col">
          <button
            onClick={() => handleStep(1)}
            disabled={disabled}
            className="w-3 h-2.5 flex items-center justify-center text-[7px] text-neutral-500 hover:text-white disabled:opacity-40"
          >▲</button>
          <button
            onClick={() => handleStep(-1)}
            disabled={disabled}
            className="w-3 h-2.5 flex items-center justify-center text-[7px] text-neutral-500 hover:text-white disabled:opacity-40"
          >▼</button>
        </div>
      </div>

      {/* Mode toggle: timecode vs frames */}
      <button
        onClick={onToggleDisplayMode}
        disabled={disabled}
        title={displayMode === 'timecode' ? 'Switch to frame count' : 'Switch to timecode'}
        className="px-1 py-0.5 text-[9px] rounded border border-neutral-700 text-neutral-500 hover:text-neutral-300 disabled:opacity-40"
      >
        {displayMode === 'timecode' ? 'TC' : 'FR'}
      </button>

      {/* Total duration / frames */}
      <span className="text-[9px] text-neutral-600 font-mono ml-0.5">
        / {displayMode === 'timecode' ? formatTimecode(totalSec, fps) : totalFrames}
      </span>
    </div>
  )
}
