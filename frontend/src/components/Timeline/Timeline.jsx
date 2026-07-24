import { useState, useMemo } from 'react'
import TimelineClip from './TimelineClip'
import Playhead from './Playhead'
import { useMedia } from '../../context/MediaContext'
import { trim, splice, promoteOutputToInput } from '../../api'

const PPS = 40

export default function Timeline({ clips, setClips, onRenderComplete }) {
  const { currentTime, seekTo, videoRef, setActivePreview } = useMedia()
  const [selectedId, setSelectedId] = useState(null)
  const [rendering, setRendering] = useState(false)
  const [dragFrom, setDragFrom] = useState(null)

  const selectedClip = clips.find(c => c.id === selectedId)
  const hasDirty = clips.some(c => c.dirty || (!c.renderedInputName && !(c.inSec === 0 && c.outSec === c.sourceDurationSec)))

  function handleSelect(clip) {
    setSelectedId(clip.id)
    const url = `/input/${encodeURIComponent(clip.sourceName)}`
    if (videoRef.current) {
      videoRef.current.src = url
      videoRef.current.currentTime = clip.inSec
    }
    setActivePreview({ name: clip.sourceName, dir: 'input' })
  }

  function handleTrim(id, inSec, outSec) {
    setClips(prev => prev.map(c => c.id === id ? { ...c, inSec, outSec, dirty: true } : c))
  }

  function handleDragStart(idx) { setDragFrom(idx) }
  function handleDragOver(idx) {}
  function handleDrop(targetIdx) {
    if (dragFrom == null || dragFrom === targetIdx) return
    setClips(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragFrom, 1)
      next.splice(targetIdx, 0, moved)
      return next
    })
    setDragFrom(null)
  }

  async function handleRenderSequence() {
    setRendering(true)
    try {
      const resolved = []
      for (const clip of clips) {
        const untrimmed = clip.inSec === 0 && clip.outSec === clip.sourceDurationSec
        if (untrimmed && !clip.dirty) {
          resolved.push({ ...clip, renderedInputName: clip.sourceName })
        } else {
          const trimResult = await trim(clip.sourceName, clip.inSec.toFixed(4), clip.outSec.toFixed(4))
          if (trimResult.error) { alert('Trim failed: ' + trimResult.error); setRendering(false); return }
          const promoted = await promoteOutputToInput(trimResult.output)
          if (promoted.error) { alert('Promote failed: ' + promoted.error); setRendering(false); return }
          resolved.push({ ...clip, renderedInputName: promoted.name, dirty: false })
        }
      }

      if (resolved.length === 1) {
        setClips(resolved)
        onRenderComplete()
      } else {
        const spliceResult = await splice(resolved.map(c => c.renderedInputName))
        if (spliceResult.error) { alert('Splice failed: ' + spliceResult.error); setRendering(false); return }
        setClips(resolved)
        onRenderComplete()
      }
    } finally {
      setRendering(false)
    }
  }

  const playheadPx = useMemo(() => {
    if (!selectedClip) return null
    let offset = 0
    for (const c of clips) {
      if (c.id === selectedClip.id) break
      offset += (c.outSec - c.inSec) * PPS + 4
    }
    const clampedTime = Math.max(selectedClip.inSec, Math.min(currentTime, selectedClip.outSec))
    return offset + (clampedTime - selectedClip.inSec) * PPS
  }, [selectedClip, currentTime, clips])

  function handleTrackClick(e) {
    if (!selectedClip) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    let offset = 0
    for (const c of clips) {
      const w = (c.outSec - c.inSec) * PPS
      if (clickX >= offset && clickX <= offset + w && c.id === selectedClip.id) {
        const seekTime = c.inSec + (clickX - offset) / PPS
        seekTo(seekTime)
        break
      }
      offset += w + 4
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-neutral-300">Timeline</h2>
        <button
          onClick={handleRenderSequence}
          disabled={rendering || clips.length === 0}
          className="px-3 py-1 text-xs rounded bg-green-700 text-white hover:bg-green-600 disabled:bg-neutral-600 disabled:text-neutral-400"
        >
          {rendering ? 'Rendering...' : 'Render Sequence'}
        </button>
      </div>

      {clips.length === 0 ? (
        <div className="flex items-center justify-center h-24 rounded-lg bg-neutral-900 border border-neutral-700 text-xs text-neutral-500">
          Add clips from the input library to start editing
        </div>
      ) : (
        <div
          className="flex items-end gap-1 overflow-x-auto bg-neutral-900 rounded-lg p-2 h-24 relative"
          onClick={handleTrackClick}
        >
          <Playhead leftPx={playheadPx} />
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
      )}

      {hasDirty && (
        <p className="mt-1 text-[10px] text-amber-400">Some clips have pending edits — click Render Sequence to apply.</p>
      )}
    </div>
  )
}
