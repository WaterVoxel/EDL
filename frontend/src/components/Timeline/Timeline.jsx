import { useRef, useMemo, useEffect, useState } from 'react'
import TimelineClip from './TimelineClip'
import Playhead from './Playhead'
import Ruler from './Ruler'
import EdlTable from './EdlTable'
import { useMedia } from '../../context/MediaContext'
import { probe } from '../../api'
import { parseTimecode } from '../../timecode'
import { clipTotalSec, clipTotalPx, clipBaseSec, roundUpAmount, sanitizeHoldPlacement, GAP_PX } from '../../clipMath'

const PPS = 60

export default function Timeline({ clips, setClips, selectedId, onSelectId, hasDirty }) {
  const { currentTime, seekTo, videoRef, setActivePreview } = useMedia()
  const trackRef = useRef(null)
  const dragFromRef = useRef(null)
  const [timeInput, setTimeInput] = useState('')

  const selectedClip = clips.find(c => c.id === selectedId)
  const totalDuration = clips.reduce((sum, c) => sum + clipTotalSec(c), 0)

  function handleSelect(clip) {
    onSelectId(clip.id)
    const url = `/input/${encodeURIComponent(clip.sourceName)}`
    if (videoRef.current) {
      videoRef.current.src = url
      videoRef.current.currentTime = clip.inSec
    }
    probe(clip.sourceName, 'input').then(info => {
      setActivePreview({ name: clip.sourceName, dir: 'input', info })
    })
  }

  function handleTrim(id, inSec, outSec) {
    setClips(prev => prev.map(c => c.id === id ? { ...c, inSec, outSec, dirty: true } : c))
  }

  function handleDelete(id) {
    // Removing a clip changes the rendered sequence even though the
    // remaining clips themselves are unedited, so mark them dirty too.
    setClips(prev => sanitizeHoldPlacement(
      prev.filter(c => c.id !== id).map(c => ({ ...c, dirty: true }))
    ))
    if (id === selectedId) onSelectId(null)
  }

  // Delete/Backspace removes the selected clip, as long as focus isn't in a
  // text input (so typing in Trim's in/out fields etc. isn't hijacked).
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || !selectedId) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      handleDelete(selectedId)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedId])

  function handleDragStart(idx) { dragFromRef.current = idx }
  function handleDragOver(idx) {}
  function handleDrop(targetIdx) {
    if (dragFromRef.current == null || dragFromRef.current === targetIdx) return
    setClips(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragFromRef.current, 1)
      next.splice(targetIdx, 0, moved)
      // Reordering changes the rendered sequence, and can move a clip that
      // held a head/tail/round segment away from the sequence's outer
      // edge, so re-anchor those segments and mark everything dirty.
      return sanitizeHoldPlacement(next.map(c => ({ ...c, dirty: true })))
    })
    dragFromRef.current = null
  }

  // The playhead maps to a position within the *source clip's* native time
  // domain (0..sourceDurationSec, since the <video> always plays the raw
  // source), while its on-screen position must additionally skip over the
  // clip's own head-hold segment (which has no corresponding video time —
  // it's a still frame, not part of the source's playable range).
  const playheadPx = useMemo(() => {
    if (!selectedClip) return null
    let offset = 0
    for (const c of clips) {
      if (c.id === selectedClip.id) break
      offset += clipTotalPx(c, PPS) + GAP_PX
    }
    const headPx = (selectedClip.headHoldSec || 0) * PPS
    const clampedTime = Math.max(selectedClip.inSec, Math.min(currentTime, selectedClip.outSec))
    return offset + headPx + (clampedTime - selectedClip.inSec) * PPS
  }, [selectedClip, currentTime, clips])

  function clientXToSeekTime(clientX) {
    if (!selectedClip || !trackRef.current) return null
    const rect = trackRef.current.getBoundingClientRect()
    const clickX = clientX - rect.left
    let offset = 0
    for (const c of clips) {
      const w = clipTotalPx(c, PPS)
      if (c.id === selectedClip.id) {
        const headPx = (c.headHoldSec || 0) * PPS
        const mainPx = (c.outSec - c.inSec) * PPS
        const withinClip = clickX - offset
        // Clicking inside the head/tail/round hold segments seeks to the
        // nearest edge of the main body, since those segments are a still
        // frame with no independent timeline of their own.
        if (withinClip < headPx) return c.inSec
        if (withinClip > headPx + mainPx) return c.outSec
        return c.inSec + Math.max(0, Math.min(withinClip - headPx, mainPx)) / PPS
      }
      offset += w + GAP_PX
    }
    return null
  }

  function handleTrackClick(e) {
    const t = clientXToSeekTime(e.clientX)
    if (t != null) seekTo(t)
  }

  function handlePlayheadDrag(clientX) {
    const t = clientXToSeekTime(clientX)
    if (t != null) seekTo(t)
  }

  function handleTimeInputSubmit(e) {
    e.preventDefault()
    if (!selectedClip) return
    const parsed = parseTimecode(timeInput, selectedClip.fps || 30)
    if (parsed == null) return
    const clamped = Math.max(selectedClip.inSec, Math.min(parsed, selectedClip.outSec))
    seekTo(clamped)
  }

  return (
    <div className="rounded-md bg-neutral-900 border border-neutral-800 flex flex-col">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-neutral-800">
        <h2 className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Timeline</h2>
        <div className="flex items-center gap-2">
          <form onSubmit={handleTimeInputSubmit} className="flex items-center gap-1">
            <input
              value={timeInput}
              onChange={e => setTimeInput(e.target.value)}
              disabled={!selectedClip}
              placeholder="00:00:00:00"
              title="Enter seconds (12.5) or timecode (HH:MM:SS:FF) and press Go"
              className="w-20 px-1.5 py-0.5 text-[10px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-300 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!selectedClip}
              className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              Go
            </button>
          </form>
          <span className="text-[9px] text-neutral-600">
            {clips.length} clip(s) · {totalDuration.toFixed(2)}s total
            {selectedId && <span className="ml-2 text-neutral-700">Del/Backspace to remove selected clip</span>}
          </span>
        </div>
      </div>

      {clips.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-[11px] text-neutral-600">
          Add clips from the Media Bin to start editing
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <Ruler clips={clips} pps={PPS} />
            <div
              ref={trackRef}
              className="flex items-stretch gap-0.5 bg-neutral-950 px-2 py-1.5 h-16 relative"
              onClick={handleTrackClick}
            >
              <Playhead leftPx={playheadPx} onDrag={handlePlayheadDrag} />
              {clips.map((clip, i) => (
                <TimelineClip
                  key={clip.id}
                  clip={clip}
                  pps={PPS}
                  index={i}
                  selected={clip.id === selectedId}
                  onSelect={handleSelect}
                  onTrim={handleTrim}
                  onDelete={handleDelete}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <StatusRow clips={clips} hasDirty={hasDirty} />

      <EdlTable clips={clips} selectedId={selectedId} onSelect={handleSelect} onDelete={handleDelete} />
    </div>
  )
}

function StatusRow({ clips, hasDirty }) {
  const nonRound = clips
    .filter(c => !(c.roundHoldSec > 0))
    .map(c => ({ clip: c, base: clipBaseSec(c), amount: roundUpAmount(clipBaseSec(c)) }))
    .filter(({ amount }) => amount > 0)

  if (nonRound.length === 0 && !hasDirty) return null

  return (
    <div className="border-t border-neutral-800">
      {nonRound.map(({ clip, base, amount }) => (
        <p key={clip.id} className="px-2.5 py-1 text-[9px] text-amber-400">
          ⚠ "{clip.displayName || clip.sourceName}" duration is not rounded up ({base.toFixed(1)}s) — use Raise to round to {(base + amount).toFixed(0)}s
        </p>
      ))}
      {hasDirty && (
        <p className="px-2.5 py-1 text-[9px] text-amber-400">
          ● Unrendered edits — click Render to apply
        </p>
      )}
    </div>
  )
}
