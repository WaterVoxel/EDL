import { useRef, useEffect, useCallback, useState } from 'react'
import TimelineClip from './TimelineClip'
import Playhead from './Playhead'
import Ruler from './Ruler'
import EdlTable from './EdlTable'
import TransportBar from './TransportBar'
import { useMedia } from '../../context/MediaContext'
import { probe } from '../../api'
import { useTimelinePlayback } from '../../hooks/useTimelinePlayback'
import { clipTotalSec, clipTotalPx, clipHeadPx, clipMainPx, sanitizeHoldPlacement, timelinePosToPx } from '../../clipMath'
import { addKeyframe, removeNearestKeyframe, sampleCropOrigin, clipTFromTimelinePos, retimeKeyframesForTrim } from '../../cropAnimation'

const PPS = 60
const TRACK_PAD = 8
const GAP = 0.5 * 4 // gap-0.5 = 2px (0.125rem = 2px)
const GUTTER_PX = 48 // matches the w-12 gutter (track-focus label + eye toggle)

function EyeIcon({ off, className }) {
  return off ? (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 3l18 18" />
      <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83" />
      <path d="M9.88 4.6A10.94 10.94 0 0 1 12 4.5c5 0 9 4.5 10 7.5-.53 1.6-1.53 3.28-2.87 4.68M6.1 6.1C4.1 7.5 2.6 9.6 2 12c1 3 5 7.5 10 7.5 1.13 0 2.2-.2 3.2-.55" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 12c1-3 5-7.5 10-7.5S21 9 22 12c-1 3-5 7.5-10 7.5S3 15 2 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  )
}

export default function Timeline({
  clips, setClips, selectedId, selectedPart = 'main', onSelectId, onSelectItem, onUndo, canUndo,
  track2Clips = [], setTrack2Clips, selectedId2 = null, selectedPart2 = 'main', onSelectItem2,
  focusedTrack = 1, onFocusTrack, onAddToV2, onAnalyze, onReconstruct, onRenderV2,
  timeDisplayMode, onToggleTimeDisplayMode, animateEnabled = false,
  v1Visible = true, onToggleV1, v2Visible = true, onToggleV2, hasOverlay = false,
  v2RenderMode = 'A', onSetV2RenderMode,
}) {
  const selectItem = onSelectItem || ((id) => onSelectId(id))
  const selectItem2 = onSelectItem2 || (() => {})
  const [v2DragOver, setV2DragOver] = useState(false)
  // Per-track visibility — independent of each other. Muting a track only
  // greys out its content (it stays on the timeline and stays editable);
  // it also determines what the shared video preview decodes below. Lifted
  // to App.jsx, like focusedTrack, because the preview stage lives there and
  // the composited overlay layer has to honor the same eye toggles.
  const toggleV1 = onToggleV1 || (() => {})
  const toggleV2 = onToggleV2 || (() => {})
  // focusedTrack/selectedId2/selectedPart2 are lifted to App.jsx (not local
  // state here) so the shared toolbar row, which lives in App.jsx, can
  // redirect to whichever track is focused.
  const setFocusedTrack = onFocusTrack || (() => {})
  const dragFromRef2 = useRef(null)

  const { videoRef, setActivePreview } = useMedia()
  const timelineRef = useRef(null)
  const dragFromRef = useRef(null)
  const playheadRef = useRef(null)
  // Cache probe() results per source so a looping timeline doesn't re-hit
  // the network (and re-fire setActivePreview) every time playback crosses
  // into a clip. Keyed by `${dir}/${name}`.
  const probeCacheRef = useRef(new Map())
  const lastActiveKeyRef = useRef(null)

  function handleV2Files(files) {
    const file = files[0]
    if (file && onAddToV2) onAddToV2(file)
  }

  const selectedClip = clips.find(c => c.id === selectedId)

  // The playhead/ruler/transport clock is ALWAYS driven by V1's own clip
  // list — V1 is the timeline of record. What the video element actually
  // decodes and shows at that position is separate: V2 sits "on top" of
  // V1, so whichever of the two is visible and topmost wins, exactly like
  // video track compositing in an NLE.
  //
  // The exception is an OVERLAY (a V2 clip smaller than V1 — see
  // overlayMatch.js). There V2 doesn't replace the frame, it's a region
  // composited onto it, so the shared <video> must keep decoding V1 and the
  // V2 picture is drawn over it by OverlayPreview in App.jsx.
  const displayClips = (v2Visible && track2Clips.length > 0 && !hasOverlay)
    ? track2Clips
    : (v1Visible ? clips : [])

  const handlePlaybackSelectClip = useCallback((clip) => {
    // Only sync V1's selection (and thus Trim/Hold/Reverse's bound clip)
    // when the clip actually driving playback IS one of V1's own clips —
    // when V2 is composited on top for display, the clip playing isn't in
    // V1's list at all, so V1's selection must stay untouched.
    if (clips.some(c => c.id === clip.id)) {
      onSelectId(clip.id)
    }
    const dir = clip.sourceDir || 'input'
    const key = `${dir}/${clip.sourceName}`
    // Skip work entirely if this is already the active preview source.
    if (lastActiveKeyRef.current === key) return
    const apply = (info) => {
      lastActiveKeyRef.current = key
      setActivePreview({ name: clip.sourceName, dir, info })
    }
    const cached = probeCacheRef.current.get(key)
    if (cached) { apply(cached); return }
    probe(clip.sourceName, dir).then(info => {
      probeCacheRef.current.set(key, info)
      apply(info)
    })
  }, [clips, onSelectId, setActivePreview])

  // Move the playhead imperatively (compositor-only transform, no React
  // re-render) — driven every animation frame by the playback engine, and
  // also on any state change (clip edits, seeks) via the effect below.
  const positionPlayhead = useCallback((pos) => {
    const px = timelinePosToPx(clips, pos, { pps: PPS, gutterPx: GUTTER_PX, trackPad: TRACK_PAD, gapPx: GAP })
    if (playheadRef.current && px != null) {
      playheadRef.current.style.transform = `translateX(${px}px)`
    }
  }, [clips])

  const transport = useTimelinePlayback(clips, videoRef, handlePlaybackSelectClip, displayClips, positionPlayhead)

  // Keep the playhead pixel position in sync whenever the clip layout or the
  // (throttled) position state changes — covers seeks, edits, and the paused
  // state. During playback the engine also calls positionPlayhead directly
  // each frame for smoothness.
  useEffect(() => {
    positionPlayhead(transport.timelinePos)
  }, [positionPlayhead, transport.timelinePos, clips])

  const activeFps = selectedClip?.fps || clips[0]?.fps || 24

  function handleSelect(clip, part = 'main') {
    setFocusedTrack(1)
    selectItem(clip.id, part)
    let pos = 0
    for (const c of clips) {
      if (c.id === clip.id) break
      pos += clipTotalSec(c)
    }
    transport.seekTimeline(pos)
  }

  function handleSelect2(clip, part = 'main') {
    setFocusedTrack(2)
    selectItem2(clip.id, part)
  }

  function handleDeleteSelected() {
    if (focusedTrack === 2) {
      handleDeleteSelected2()
      return
    }
    if (!selectedId) return
    if (selectedPart === 'main') {
      handleDelete(selectedId)
    } else {
      // Remove just the hold/round segment, not the whole clip
      const field = selectedPart === 'head' ? 'headHoldSec'
        : selectedPart === 'tail' ? 'tailHoldSec'
        : 'roundHoldSec'
      setClips(prev => prev.map(c =>
        c.id === selectedId ? { ...c, [field]: 0, dirty: true } : c
      ))
      selectItem(selectedId, 'main')
    }
  }

  function handleDeleteSelected2() {
    if (!selectedId2 || !setTrack2Clips) return
    if (selectedPart2 === 'main') {
      handleDelete2(selectedId2)
    } else {
      // Mirrors V1's handleDeleteSelected: remove just the hold/round
      // segment, not the whole clip.
      const field = selectedPart2 === 'head' ? 'headHoldSec'
        : selectedPart2 === 'tail' ? 'tailHoldSec'
        : 'roundHoldSec'
      setTrack2Clips(prev => prev.map(c =>
        c.id === selectedId2 ? { ...c, [field]: 0, dirty: true } : c
      ))
      selectItem2(selectedId2, 'main')
    }
  }

  // Trimming rebases any crop keyframes — their `t` is relative to inSec,
  // so without this a trim slides the pan onto different frames and can
  // leave keyframes past the body's end, which fails render validation.
  // See cropAnimation.retimeKeyframesForTrim.
  function trimClip(c, inSec, outSec) {
    return {
      ...c,
      inSec,
      outSec,
      cropKeyframes: retimeKeyframesForTrim(c.cropKeyframes, c.inSec, inSec, outSec),
      dirty: true,
    }
  }

  function handleTrim(id, inSec, outSec) {
    setClips(prev => prev.map(c => c.id === id ? trimClip(c, inSec, outSec) : c))
  }

  function handleTrim2(id, inSec, outSec) {
    if (!setTrack2Clips) return
    setTrack2Clips(prev => prev.map(c => c.id === id ? trimClip(c, inSec, outSec) : c))
  }

  function handleDelete(id) {
    // Removing a clip changes the rendered sequence even though the
    // remaining clips themselves are unedited, so mark them dirty too.
    setClips(prev => sanitizeHoldPlacement(
      prev.filter(c => c.id !== id).map(c => ({ ...c, dirty: true }))
    ))
    if (id === selectedId) onSelectId(null)
  }

  function handleDelete2(id) {
    if (!setTrack2Clips) return
    setTrack2Clips(prev => sanitizeHoldPlacement(
      prev.filter(c => c.id !== id).map(c => ({ ...c, dirty: true }))
    ))
    if (id === selectedId2) selectItem2(null)
  }

  // Keyboard shortcuts — only active when focus is NOT in a text input.
  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (canUndo) onUndo()
        return
      }
      const hasSelection = focusedTrack === 2 ? !!selectedId2 : !!selectedId
      if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection) {
        e.preventDefault()
        handleDeleteSelected()
        return
      }
      if (e.key === ' ' && clips.length > 0) {
        e.preventDefault()
        if (transport.playing) { transport.stop() } else { transport.play() }
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        transport.stepFrames(1)
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        transport.stepFrames(-1)
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        transport.goToStart()
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        transport.goToEnd()
        return
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [focusedTrack, selectedId, selectedPart, selectedId2, selectedPart2, clips.length, transport, canUndo, onUndo])

  function handleDragStart(idx) { dragFromRef.current = idx }
  function handleDragOver(_idx) {}
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

  function handleDragStart2(idx) { dragFromRef2.current = idx }
  function handleDragOver2(_idx) {}
  function handleDrop2(targetIdx) {
    if (!setTrack2Clips || dragFromRef2.current == null || dragFromRef2.current === targetIdx) return
    setTrack2Clips(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragFromRef2.current, 1)
      next.splice(targetIdx, 0, moved)
      return sanitizeHoldPlacement(next.map(c => ({ ...c, dirty: true })))
    })
    dragFromRef2.current = null
  }

  // Playhead/ruler/click-to-seek all measure from ONE shared wrapper
  // (timelineRef) so the ruler, V2 lane, and V1 lane share one coordinate
  // system and one horizontal scroll — the playhead is one continuous line
  // spanning all three, ticked according to V1's structure. Its pixel
  // position is computed by timelinePosToPx and applied imperatively (see
  // positionPlayhead) rather than through a per-frame React re-render.

  function clientXToTimelinePos(clientX) {
    if (clips.length === 0 || !timelineRef.current) return null
    const rect = timelineRef.current.getBoundingClientRect()
    let clickPx = clientX - rect.left - GUTTER_PX - TRACK_PAD
    let pos = 0
    const totalDur = clips.reduce((sum, c) => sum + clipTotalSec(c), 0)
    for (let i = 0; i < clips.length; i++) {
      const clipPx = clipTotalSec(clips[i]) * PPS
      if (clickPx <= clipPx) {
        pos += Math.max(0, clickPx) / PPS
        return Math.min(pos, totalDur)
      }
      clickPx -= clipPx + GAP
      pos += clipTotalSec(clips[i])
    }
    return totalDur
  }

  function handleTimelineClick(e) {
    const pos = clientXToTimelinePos(e.clientX)
    if (pos != null) transport.seekTimeline(pos)
  }

  // The clip's start offset on the timeline (sum of clipTotalSec of all
  // preceding V1 clips) — needed to convert the shared playhead position
  // into a per-clip source time via clipTFromTimelinePos.
  function clipStartTimeline(clip) {
    let cursor = 0
    for (const c of clips) {
      if (c.id === clip.id) return cursor
      cursor += clipTotalSec(c)
    }
    return null
  }

  // Source-relative keyframe time (0 → outSec-inSec) the playhead sits at
  // within this clip's main body, or null if outside the body / in a hold.
  // One shared definition with the preview (CropOverlay) and the render
  // expression — see cropAnimation.clipTFromTimelinePos.
  function playheadClipT(clip) {
    const start = clipStartTimeline(clip)
    if (start == null) return null
    // Read the always-fresh position (not the throttled state) so a
    // keyframe lands exactly at the playhead even mid-playback.
    return clipTFromTimelinePos(clip, start, transport.getTimelinePos())
  }

  function handleAddKeyframe(clip) {
    if (!clip.crop) return
    const t = playheadClipT(clip)
    if (t == null) return
    // Capture the position CURRENTLY on the preview at this playhead so the
    // box never moves when the keyframe is committed:
    //  • ≥1 keyframe already → sample the existing curve at t (what's on
    //    screen right now), then add/overwrite at t.
    //  • no keyframes yet → the box is showing the static crop origin, so
    //    the first keyframe captures crop.x/y AND we seed a matching
    //    keyframe there is not needed — a lone keyframe just holds a
    //    constant, identical to the static crop until a second is added.
    const kfs = clip.cropKeyframes || []
    const base = kfs.length >= 1 ? sampleCropOrigin(kfs, t) : { x: clip.crop.x, y: clip.crop.y }
    setClips(prev => prev.map(c => c.id === clip.id
      ? { ...c, cropKeyframes: addKeyframe(c.cropKeyframes || [], t, base.x, base.y), dirty: true }
      : c
    ))
  }

  function handleRemoveKeyframe(clip) {
    const t = playheadClipT(clip)
    if (t == null) return
    setClips(prev => prev.map(c => c.id === clip.id
      ? { ...c, cropKeyframes: removeNearestKeyframe(c.cropKeyframes || [], t), dirty: true }
      : c
    ))
  }

  function handlePlayheadDrag(clientX) {
    const pos = clientXToTimelinePos(clientX)
    if (pos != null) transport.seekTimeline(pos)
  }

  return (
    <div className="rounded-md bg-neutral-900 border border-neutral-800 flex flex-col">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2.5 py-1.5 border-b border-neutral-800">
        <div className="flex items-center gap-2 justify-self-start">
          <h2 className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Timeline</h2>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo last V1 edit (Cmd/Ctrl+Z)"
            className="w-5 h-5 flex items-center justify-center rounded text-[12px] text-neutral-400 hover:text-white hover:bg-neutral-700 disabled:opacity-40"
          >↩</button>
        </div>
        <div className="justify-self-center">
          <TransportBar
            playing={transport.playing}
            looping={transport.looping}
            timelinePos={transport.timelinePos}
            totalDuration={transport.totalDuration}
            fps={activeFps}
            onPlay={transport.play}
            onStop={transport.stop}
            onGoToStart={transport.goToStart}
            onGoToEnd={transport.goToEnd}
            onStepFrames={transport.stepFrames}
            onToggleLoop={transport.toggleLoop}
            onSeekTimeline={transport.seekTimeline}
            displayMode={timeDisplayMode}
            onToggleDisplayMode={onToggleTimeDisplayMode}
          />
        </div>
        <div className="flex items-center gap-1.5 justify-self-end">
          {clips.length > 0 && track2Clips.length > 0 && (
            <button
              onClick={onReconstruct}
              title="Strip V1's edits (holds, reverse, speed, crop) back out of V2's own clip(s) — for footage that was rendered, taken through an external tool, and dropped back onto V2"
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded bg-orange-600 text-white hover:bg-orange-500"
            >
              Reconstruct
            </button>
          )}
          {track2Clips.length > 0 && (
            <button
              onClick={onAnalyze}
              title="Cut the V2 file at the same time locations as V1 (including holds and round-up)"
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded bg-teal-700 text-white hover:bg-teal-600"
            >
              Analize
            </button>
          )}
          {track2Clips.length > 0 && (
            <button
              onClick={onRenderV2}
              title={v2RenderMode === 'AB'
                ? 'Render V2 composited over V1 as one clip'
                : 'Render the V2 track to a file'}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded border border-teal-700 text-teal-400 hover:bg-teal-900/40"
            >
              Render V2
            </button>
          )}
          {/* What "Render V2" produces: A = the V2 track alone (default),
              A/B = V2 composited on top of V1 as a single clip. A segmented
              switch rather than a checkbox, since the two are alternatives
              and the active one names the output. */}
          {track2Clips.length > 0 && (
            <div
              className="flex items-stretch rounded overflow-hidden border border-teal-700 text-[9px] leading-none"
              role="group"
              aria-label="Render V2 output mode"
            >
              <button
                onClick={() => onSetV2RenderMode?.('A')}
                aria-pressed={v2RenderMode !== 'AB'}
                title="A — render only the V2 track, as its own file"
                className={`px-1.5 py-0.5 ${v2RenderMode !== 'AB' ? 'bg-teal-700 text-white' : 'text-teal-400 hover:bg-teal-900/40'}`}
              >
                A
              </button>
              <button
                onClick={() => onSetV2RenderMode?.('AB')}
                aria-pressed={v2RenderMode === 'AB'}
                title="A/B — render V2 on top of V1, composited into one clip"
                className={`px-1.5 py-0.5 border-l border-teal-700 ${v2RenderMode === 'AB' ? 'bg-teal-700 text-white' : 'text-teal-400 hover:bg-teal-900/40'}`}
              >
                A/B
              </button>
            </div>
          )}
        </div>
      </div>

      {clips.length === 0 && track2Clips.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-[11px] text-neutral-600">
          Add clips from the Media Bin to start editing
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div ref={timelineRef} className="inline-block min-w-full relative">
            <Playhead ref={playheadRef} visible={clips.length > 0} onDrag={handlePlayheadDrag} />

            {/* Ruler — reflects V1's structure only; a plain spacer keeps its
                ticks aligned under the V1/V2 gutter buttons below. */}
            <div className="flex items-stretch">
              <div className="shrink-0 w-12" />
              <div onClick={handleTimelineClick} className="flex-1 cursor-pointer" title="Click to move the playhead">
                <Ruler clips={clips} pps={PPS} />
              </div>
            </div>

            {/* V2 — Analyze lane. Always present; muting only hides its
                content, it never leaves the timeline. */}
            <div className="border-b border-neutral-800">
              <div className="flex items-stretch">
                <div className={`shrink-0 w-12 flex items-center justify-center gap-1 text-[9px] font-mono ${focusedTrack === 2 ? 'bg-teal-800 text-white' : 'bg-neutral-800 text-neutral-500'}`}>
                  <button
                    onClick={() => setFocusedTrack(2)}
                    title="Focus the V2 track (for Delete)"
                    className="hover:text-neutral-200"
                  >V2</button>
                  <button
                    onClick={toggleV2}
                    title={v2Visible ? 'Hide V2 content' : 'Show V2 content'}
                    className={v2Visible ? 'text-current hover:text-white' : 'text-neutral-600 hover:text-neutral-400'}
                  ><EyeIcon off={!v2Visible} /></button>
                </div>
                <div className="flex-1 relative">
                  {track2Clips.length === 0 ? (
                    <label
                      onDragOver={e => { e.preventDefault(); setV2DragOver(true) }}
                      onDragEnter={e => { e.preventDefault(); setV2DragOver(true) }}
                      onDragLeave={() => setV2DragOver(false)}
                      onDrop={e => { e.preventDefault(); setV2DragOver(false); handleV2Files(e.dataTransfer.files) }}
                      className={`flex w-full items-center justify-center gap-1.5 px-3 h-10 text-[10px] cursor-pointer transition-colors ${v2DragOver ? 'bg-teal-950/40 text-teal-300' : 'bg-neutral-950/50 text-neutral-600 hover:text-neutral-400'}`}
                    >
                      <span>Drop file or Choose file to reverse</span>
                      <input
                        type="file"
                        accept=".mp4,.mov,.mkv,.avi,.m4v,.webm"
                        className="hidden"
                        onChange={e => { handleV2Files(e.target.files); e.target.value = '' }}
                      />
                    </label>
                  ) : (
                    <div
                      onClick={handleTimelineClick}
                      className={`flex items-stretch gap-0.5 bg-neutral-950 px-2 py-1 h-12 cursor-pointer transition-all ${!v2Visible ? 'opacity-35 grayscale pointer-events-none' : ''}`}
                    >
                      {track2Clips.map((clip, i) => (
                        <TimelineClip
                          key={clip.id}
                          clip={clip}
                          pps={PPS}
                          index={i}
                          selected={clip.id === selectedId2}
                          selectedPart={clip.id === selectedId2 ? selectedPart2 : null}
                          onSelect={handleSelect2}
                          onDeletePart={(part) => {
                            const field = part === 'head' ? 'headHoldSec' : part === 'tail' ? 'tailHoldSec' : 'roundHoldSec'
                            setTrack2Clips?.(prev => prev.map(c => c.id === clip.id ? { ...c, [field]: 0, dirty: true } : c))
                          }}
                          onTrim={handleTrim2}
                          onDelete={handleDelete2}
                          onDragStart={handleDragStart2}
                          onDragOver={handleDragOver2}
                          onDrop={handleDrop2}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* V1 — main edit track */}
            <div className={animateEnabled ? 'border-b border-neutral-800' : ''}>
            <div className="flex items-stretch">
              <div className={`shrink-0 w-12 flex items-center justify-center gap-1 text-[9px] font-mono ${focusedTrack === 1 ? 'bg-indigo-800 text-white' : 'bg-neutral-800 text-neutral-500'}`}>
                <button
                  onClick={() => setFocusedTrack(1)}
                  title="Focus the V1 track (for Delete)"
                  className="hover:text-neutral-200"
                >V1</button>
                <button
                  onClick={toggleV1}
                  title={v1Visible ? 'Hide V1 content' : 'Show V1 content'}
                  className={v1Visible ? 'text-current hover:text-white' : 'text-neutral-600 hover:text-neutral-400'}
                ><EyeIcon off={!v1Visible} /></button>
              </div>
              {clips.length === 0 ? (
                <div className="flex-1 flex items-center justify-center h-16 text-[11px] text-neutral-600">
                  Add clips from the Media Bin to start editing
                </div>
              ) : (
                <div
                  onClick={handleTimelineClick}
                  className={`flex-1 flex items-stretch gap-0.5 bg-neutral-950 px-2 py-1.5 h-16 cursor-pointer transition-all ${!v1Visible ? 'opacity-35 grayscale' : ''}`}
                >
                  {clips.map((clip, i) => (
                    <TimelineClip
                      key={clip.id}
                      clip={clip}
                      pps={PPS}
                      index={i}
                      selected={clip.id === selectedId}
                      selectedPart={clip.id === selectedId ? selectedPart : null}
                      onSelect={handleSelect}
                      onDeletePart={(part) => {
                        const field = part === 'head' ? 'headHoldSec' : part === 'tail' ? 'tailHoldSec' : 'roundHoldSec'
                        setClips(prev => prev.map(c => c.id === clip.id ? { ...c, [field]: 0, dirty: true } : c))
                      }}
                      onTrim={handleTrim}
                      onDelete={handleDelete}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                    />
                  ))}
                </div>
              )}
            </div>
            {animateEnabled && clips.length > 0 && (() => {
              // The +/− controls live in the gutter (under the ANIM label)
              // and act on the currently selected V1 clip — one shared pair
              // for the whole lane, so the tools are always in the same
              // spot regardless of clip count / horizontal scroll.
              const activeClip = clips.find(c => c.id === selectedId) || null
              const activeT = activeClip ? playheadClipT(activeClip) : null
              const activeKfs = activeClip?.cropKeyframes || []
              const canAdd = !!activeClip?.crop && activeT != null
              const canRemove = activeKfs.length > 0 && activeT != null
              return (
                <div className="flex items-stretch border-t border-neutral-800">
                  <div className="shrink-0 w-12 flex flex-col items-center justify-center gap-0.5 bg-neutral-900 py-0.5">
                    <span className="text-[8px] font-mono uppercase tracking-wide text-amber-400 leading-none">ANIM</span>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => activeClip && handleAddKeyframe(activeClip)}
                        disabled={!canAdd}
                        title={
                          !activeClip ? 'Select a V1 clip first'
                          : !activeClip.crop ? 'Pick a crop preset on the selected clip first'
                          : activeT == null ? 'Move the playhead over the selected clip’s body to add a keyframe'
                          : 'Add keyframe at playhead'
                        }
                        className="w-4 h-4 flex items-center justify-center rounded bg-neutral-700 text-emerald-300 hover:text-emerald-200 disabled:text-neutral-600 text-[11px] leading-none"
                      >+</button>
                      <button
                        onClick={() => activeClip && handleRemoveKeyframe(activeClip)}
                        disabled={!canRemove}
                        title={
                          !activeClip ? 'Select a V1 clip first'
                          : activeKfs.length === 0 ? 'No keyframes to remove on this clip'
                          : activeT == null ? 'Move the playhead over the selected clip’s body to remove its nearest keyframe'
                          : 'Remove the keyframe nearest the playhead'
                        }
                        className="w-4 h-4 flex items-center justify-center rounded bg-neutral-700 text-rose-300 hover:text-rose-200 disabled:text-neutral-600 text-[11px] leading-none"
                      >−</button>
                    </div>
                  </div>
                  <div className="flex-1 flex items-stretch gap-0.5 bg-neutral-950/60 px-2 py-1.5 h-12">
                    {clips.map(clip => {
                      const totalPx = clipTotalPx(clip, PPS)
                      const headPx = clipHeadPx(clip, PPS)
                      const mainPx = clipMainPx(clip, PPS)
                      const dur = clip.outSec - clip.inSec // source length
                      const kfs = clip.cropKeyframes || []
                      return (
                        <div
                          key={clip.id}
                          className={`relative flex-shrink-0 h-full rounded-sm border ${clip.id === selectedId ? 'border-amber-400/60' : 'border-neutral-800'} bg-neutral-900/50`}
                          style={{ width: Math.max(totalPx, 24) }}
                        >
                          {/* Main-body span the keyframes live in (excludes
                              head/tail/round hold segments — nothing to
                              animate over a frozen frame). */}
                          <div
                            className="absolute top-0 h-full border-l border-r border-neutral-800/40"
                            style={{ left: headPx, width: mainPx }}
                          >
                            {kfs.map((k, i) => {
                              // k.t is source-seconds from inSec. Its visual
                              // position along the (timeline-order) body:
                              // forward clips map source offset → timeline
                              // offset directly; a reversed clip plays outSec
                              // first, so source offset `dur` sits at the
                              // body's left edge (fraction flips).
                              const visualOffset = clip.reversed ? dur - k.t : k.t
                              const frac = dur > 0 ? Math.max(0, Math.min(1, visualOffset / dur)) : 0
                              return (
                                <div
                                  key={i}
                                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-amber-400 border border-amber-200 shadow"
                                  style={{ left: `${frac * 100}%` }}
                                  title={`Keyframe ${i + 1} at ${k.t.toFixed(2)}s → (${Math.round(k.x)}, ${Math.round(k.y)})`}
                                />
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
            </div>
          </div>
        </div>
      )}

      <EdlTable clips={clips} selectedId={selectedId} onSelect={handleSelect} onDelete={handleDelete} />
    </div>
  )
}
