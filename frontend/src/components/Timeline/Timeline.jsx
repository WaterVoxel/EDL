import { useRef, useMemo } from 'react'
import TimelineClip from './TimelineClip'
import Playhead from './Playhead'
import Ruler from './Ruler'
import EdlTable from './EdlTable'
import { useMedia } from '../../context/MediaContext'
import { probe } from '../../api'
import { clipTotalSec, clipTotalPx, clipBaseSec, roundUpAmount, sanitizeHoldPlacement, GAP_PX } from '../../clipMath'

const PPS = 60

export default function Timeline({ clips, setClips, selectedId, onSelectId, hasDirty }) {
  const { currentTime, seekTo, videoRef, setActivePreview } = useMedia()
  const trackRef = useRef(null)
  const dragFromRef = useRef(null)

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

  function handleDragStart(idx) { dragFromRef.current = idx }
  function handleDragOver(idx) {}
  function handleDrop(targetIdx) {
    if (dragFromRef.current == null || dragFromRef.current === targetIdx) return
    setClips(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragFromRef.current, 1)
      next.splice(targetIdx, 0, moved)
      // Reordering can move a clip that held a head/tail/round segment
      // away from the sequence's outer edge, so re-anchor those segments.
      return sanitizeHoldPlacement(next)
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

  return (
    <div className="rounded-md bg-neutral-900 border border-neutral-800 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Timeline</h2>
        <span className="text-[10px] text-neutral-600">{clips.length} clip(s) · {totalDuration.toFixed(2)}s total</span>
      </div>

      {clips.length === 0 ? (
        <div className="flex items-center justify-center h-28 text-xs text-neutral-600">
          Add clips from the Media Bin to start editing
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <Ruler clips={clips} pps={PPS} />
            <div
              ref={trackRef}
              className="flex items-stretch gap-0.5 bg-neutral-950 px-2 py-2 h-20 relative"
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

      <EdlTable clips={clips} selectedId={selectedId} onSelect={handleSelect} />
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
        <p key={clip.id} className="px-3 py-1.5 text-[10px] text-amber-400">
          ⚠ "{clip.sourceName}" duration is not rounded up ({base.toFixed(1)}s) — use Raise to round to {(base + amount).toFixed(0)}s
        </p>
      ))}
      {hasDirty && (
        <p className="px-3 py-1.5 text-[10px] text-amber-400">
          ● Unrendered edits — click Render to apply
        </p>
      )}
    </div>
  )
}
