import { useState, useEffect } from 'react'
import { formatTimecode, parseTimecode } from '../../timecode'

export default function TransportBar({
  playing, looping, timelinePos, totalDuration, fps,
  onPlay, onStop, onGoToStart, onGoToEnd, onStepFrames, onToggleLoop, onSeekTimeline,
  displayMode, onToggleDisplayMode,
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const currentFrame = Math.round(timelinePos * fps)
  const totalFrames = Math.round(totalDuration * fps)

  const displayValue = displayMode === 'timecode'
    ? formatTimecode(timelinePos, fps)
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
        / {displayMode === 'timecode' ? formatTimecode(totalDuration, fps) : totalFrames}
      </span>
    </div>
  )
}
