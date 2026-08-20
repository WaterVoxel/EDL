import { useRef, useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import TimelineClip from './TimelineClip'
import AudioBedBar from './AudioBedBar'
import AudioBedPlayer from './AudioBedPlayer'
import Playhead from './Playhead'
import Ruler from './Ruler'
import EdlTable from './EdlTable'
import TransportBar from './TransportBar'
import { useMedia } from '../../context/MediaContext'
import { probe } from '../../api'
import { useTimelinePlayback } from '../../hooks/useTimelinePlayback'
import { clipTotalSec, clipTotalPx, clipHeadPx, clipMainPx, sanitizeHoldPlacement, timelinePosToPx, sequenceVideoStartSec } from '../../clipMath'
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
  clips, setClips, onAddToV1, selectedId, selectedPart = 'main', onSelectId, onSelectItem, onUndo, canUndo,
  track2Clips = [], setTrack2Clips, selectedId2 = null, selectedPart2 = 'main', onSelectItem2,
  focusedTrack = 1, onFocusTrack, onAddToV2, onAnalyze, onBatchAnalyze, onReconstruct, onRenderV2,
  onRender, onRenderA1, rendering = false,
  timeDisplayMode, onToggleTimeDisplayMode, animateEnabled = false,
  v1Visible = true, onToggleV1, v2Visible = true, onToggleV2, hasOverlay = false,
  v2RenderMode = 'A', onSetV2RenderMode,
  v2ShotMode = '1', onSetV2ShotMode, v2ShotProgress = null,
  audioBeds = [], onAddToA1, onRemoveBed, a1Visible = true, onToggleA1,
  a1Muted = false, noiseEnabled = false,
  // The two halves of the bar swap, so each one is rendered where the other
  // used to be: `toolbar` is App.jsx's clip edit row, handed down as a node
  // and drawn as this card's first row; `barSlot` is the DOM element up in
  // App.jsx that this card's own action bar is portaled into. Both default to
  // nothing, so the component still renders standalone without either.
  barSlot = null, toolbar = null,
}) {
  const selectItem = onSelectItem || ((id) => onSelectId(id))
  const selectItem2 = onSelectItem2 || (() => {})
  const [v1DragOver, setV1DragOver] = useState(false)
  const [v2DragOver, setV2DragOver] = useState(false)
  const [a1DragOver, setA1DragOver] = useState(false)
  // Per-track visibility — independent of each other. Muting a track only
  // greys out its content (it stays on the timeline and stays editable);
  // it also determines what the shared video preview decodes below. Lifted
  // to App.jsx, like focusedTrack, because the preview stage lives there and
  // the composited overlay layer has to honor the same eye toggles.
  const toggleV1 = onToggleV1 || (() => {})
  const toggleV2 = onToggleV2 || (() => {})
  // A1's eye hides the bar. It does not change the render — a loaded bed
  // always renders. a1Muted still silences the bed in the PREVIEW only, but
  // there is no gutter control for it: it's set from App.jsx, not here.
  const toggleA1 = onToggleA1 || (() => {})
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

  // V1 is a lane, so a multi-file drop lands as several clips end to end — the
  // same shape as A1 below, and awaited one at a time for the same reason:
  // every file is uploaded and probed before it's appended, and letting those
  // race would append them in whatever order the network finished in rather
  // than the order they were dropped.
  async function handleV1Files(files) {
    for (const file of Array.from(files)) {
      if (onAddToV1) await onAddToV1(file)
    }
  }

  // V1's lane is BOTH a file drop target and the clip-reorder drop target, so
  // every handler on it has to tell the two apart. A reorder drag carries no
  // files, which `types` reports during dragover (where `files` is always
  // empty by design) and `files.length` reports on drop itself.
  const isFileDrag = e => Array.from(e.dataTransfer?.types || []).includes('Files')

  const v1FileDragProps = {
    onDragOver: e => { if (!isFileDrag(e)) return; e.preventDefault(); setV1DragOver(true) },
    onDragEnter: e => { if (!isFileDrag(e)) return; e.preventDefault(); setV1DragOver(true) },
    // Crossing from the lane onto one of its own clips fires dragleave on the
    // lane too (the event bubbles), which would strobe the highlight on every
    // clip boundary the pointer passes over. Only a leave that actually exits
    // the lane counts.
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setV1DragOver(false) },
    onDrop: e => {
      // No files means a clip reorder, whose own drop already ran on the
      // TimelineClip below and is merely bubbling through here.
      if (!e.dataTransfer.files.length) return
      e.preventDefault()
      setV1DragOver(false)
      handleV1Files(e.dataTransfer.files)
    },
  }

  function handleV2Files(files) {
    const file = files[0]
    if (file && onAddToV2) onAddToV2(file)
  }

  // A1 is a lane, so a multi-file drop lands as several clips end to end.
  // Awaited one at a time on purpose: each file is uploaded and probed before
  // it's appended, and letting those race would append them in whatever order
  // the network finished in rather than the order they were dropped.
  async function handleA1Files(files) {
    for (const file of Array.from(files)) {
      if (onAddToA1) await onAddToA1(file)
    }
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

  // V1's own timeline length — what the A1 bed is padded/cut to. The same sum
  // the ruler and the playhead use, so the bed bar lines up with them; the
  // render recomputes it on a frame grid, which can differ by a few ms under
  // mixed fps (see build_timeline_filter's expected_secs).
  const sequenceSec = transport.totalDuration

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

  // This card's action bar: the transport clock, the two V2-derived edit
  // actions, and the render buttons. It renders through a portal into
  // `barSlot` — the app-level row above this card, which is where the clip
  // edit tools used to be — instead of as this card's own header. Every
  // control in it is driven by `transport` (a hook that lives in THIS
  // component) or by handlers passed to it, so the JSX has to stay here; a
  // portal moves only the DOM parent, keeping the React tree, the handlers,
  // and the state exactly as they were.
  //
  // How many files a 1+ Render V2 would write: the cuts it splits at belong to
  // whichever track that render is built from — V2's own clips in A, V1's in
  // A/B, where V2's clips are overlays ON V1's cuts rather than cuts of their
  // own. Read only by labels here; App.jsx derives the same count from the same
  // two lists when it actually runs the renders.
  const v2ShotCount = v2RenderMode === 'AB' ? clips.length : track2Clips.length
  const actionsBar = (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center">
      <div className="flex items-center gap-1.5 justify-self-start">
        {/* The two V2-derived edit actions live on THIS side, away from the
            render buttons on the right: they rewrite clips rather than write
            a file, so keeping them here holds "changes the timeline" and
            "produces an export" visually apart. Undo used to lead this group
            and now sits ahead of Hold in App.jsx's editToolbar instead — the
            onUndo/canUndo props stay, because this component's key handler
            still owns Cmd/Ctrl+Z. With no V2 clips this group renders empty,
            which the 1fr_auto_1fr grid absorbs without moving the transport. */}
        {clips.length > 0 && track2Clips.length > 0 && (
          <button
            onClick={onReconstruct}
            title="Strip V1's edits (holds, reverse, speed, crop) back out of V2's own clip(s) — for footage that was rendered, taken through an external tool, and dropped back onto V2"
            className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded bg-orange-600 text-white hover:bg-orange-500"
          >
            V2 Reconstruct
          </button>
        )}
        {track2Clips.length > 0 && (
          <button
            onClick={onAnalyze}
            title="Cut the V2 file at the same time locations as V1 (including holds and round-up)"
            className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded bg-teal-700 text-white hover:bg-teal-600"
          >
            V2 Analyzer
          </button>
        )}
        {/* Its plain-cut sibling, next to it and a shade back in the same teal
            so the pair reads as two ways of conforming V2 to V1 rather than two
            unrelated actions. Needs V1 clips as well as a V2 file, since the cut
            points come from V1 (the Analyzer beside it only needs V2 — it reads
            V1 inside the handler and says so if it's empty). */}
        {clips.length > 0 && track2Clips.length > 0 && (
          <button
            onClick={onBatchAnalyze}
            title="Cut the V2 file at every boundary in V1's sequence — each clip, each edge hold and the round-up becomes its own V2 clip; no holds, reverse or speed re-applied. For a whole V1 sequence rendered as one file and handled in a single pass outside the app"
            className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded bg-teal-900 text-white hover:bg-teal-800"
          >
            V2 Batch Analyzer
          </button>
        )}
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
        {/* The primary render. Lives in this bar rather than in the Preview
            header so every render action sits in one row, and it reads
            left-to-right as V1 then V2. Styled like Render V2 (outline, not a
            filled button) since they're the same kind of action, in indigo
            because that's V1's color everywhere else. Always present but
            disabled with no clips — it's the main action, so it shouldn't
            vanish. */}
        <button
          onClick={onRender}
          disabled={rendering || clips.length === 0}
          title="Apply every V1 edit decision in one lossless pass and write the result to the export folder"
          className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded border border-indigo-600 text-indigo-400 hover:bg-indigo-900/40 disabled:border-neutral-700 disabled:text-neutral-600 disabled:hover:bg-transparent"
        >
          {rendering ? 'Rendering…' : 'Render V1'}
        </button>
        {track2Clips.length > 0 && (
          <button
            onClick={onRenderV2}
            // Only a 1+ render disables the button, and only while it runs: it
            // is N passes deep and the click that started it looks finished
            // long before it is, so the label counts the shots off. A 1 render
            // stays exactly as it was — one pass, no progress to report.
            disabled={!!v2ShotProgress}
            title={
              (v2RenderMode === 'AB' ? 'Render V2 composited over V1' : 'Render the V2 track')
              + (v2ShotMode === '1+'
                ? ` as ${v2ShotCount} separate ${v2ShotCount === 1 ? 'file' : 'files'}, one per cut`
                : ' as one clip')
            }
            className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded border border-teal-700 text-teal-400 hover:bg-teal-900/40 disabled:border-neutral-700 disabled:text-neutral-600 disabled:hover:bg-transparent"
          >
            {v2ShotProgress
              ? `Shot ${v2ShotProgress.done + 1}/${v2ShotProgress.total}…`
              : 'Render V2'}
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
        {/* How MANY files "Render V2" writes: 1 = the whole track joined into
            a single clip (the original behavior, and the default), 1+ = one
            file per cut, numbered in track order.
            Deliberately a SECOND switch rather than four modes in one: this
            axis is orthogonal to A / A/B, which decides what each shot
            CONTAINS. Same styling as that group because it's the same kind of
            control on the same button, and it sits to its right so the pair
            reads "what, then how many". */}
        {track2Clips.length > 0 && (
          <div
            className="flex items-stretch rounded overflow-hidden border border-teal-700 text-[9px] leading-none"
            role="group"
            aria-label="Render V2 shot mode"
          >
            <button
              onClick={() => onSetV2ShotMode?.('1')}
              aria-pressed={v2ShotMode !== '1+'}
              title="1 — render the whole track as a single clip"
              className={`px-1.5 py-0.5 ${v2ShotMode !== '1+' ? 'bg-teal-700 text-white' : 'text-teal-400 hover:bg-teal-900/40'}`}
            >
              1
            </button>
            <button
              onClick={() => onSetV2ShotMode?.('1+')}
              aria-pressed={v2ShotMode === '1+'}
              title={`1+ — render every cut as its own file (${v2ShotCount} ${v2ShotCount === 1 ? 'shot' : 'shots'}), numbered in track order`}
              className={`px-1.5 py-0.5 border-l border-teal-700 ${v2ShotMode === '1+' ? 'bg-teal-700 text-white' : 'text-teal-400 hover:bg-teal-900/40'}`}
            >
              1+
            </button>
          </div>
        )}
        {/* Last in the row, past the V2 group: it's the only audio render, so
            it sits apart from the two picture renders rather than between
            them. Amber for the same reason — indigo is V1's and teal is V2's,
            and amber is already the A1 Room Tone toggle's color, so the audio
            actions read as one family. Shown only when there is something on
            A1 to render — a loaded track, or A1 Room Tone on (the fill is A1
            content too, and on a sequence with any silence in it that alone
            makes a usable stem; when there is none, the server says so instead
            of writing an empty file) — the same "appears with its track" rule
            Render V2 follows. */}
        {(audioBeds.length > 0 || noiseEnabled) && (
          <button
            onClick={onRenderA1}
            disabled={rendering || clips.length === 0}
            title="Render the A1 track alone to a .wav, timed to the V1 sequence — same length, ready to line up beside the V1 file"
            className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded border border-amber-600 text-amber-400 hover:bg-amber-900/40 disabled:border-neutral-700 disabled:text-neutral-600 disabled:hover:bg-transparent"
          >
            Render A1
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="rounded-md bg-neutral-900 border border-neutral-800 flex flex-col">
      {/* The action bar above, drawn into App.jsx's row instead of here. */}
      {barSlot && createPortal(actionsBar, barSlot)}

      {/* …and in its place, this card's first row is now the clip edit
          toolbar (Hold, Trim, Duplicate, Reverse, Split, Raise, Speed +
          A1 Room Tone). It arrives as a ready-made node from App.jsx because
          every control in it acts on whichever TRACK is focused — clips,
          setters and selection that all live up there. */}
      {toolbar && (
        <div className="px-2.5 py-1.5 border-b border-neutral-800">{toolbar}</div>
      )}

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
                <label
                  {...v1FileDragProps}
                  className={`flex-1 flex items-center justify-center gap-1.5 h-16 text-[11px] cursor-pointer transition-colors ${v1DragOver ? 'bg-indigo-950/40 text-indigo-300' : 'text-neutral-600 hover:text-neutral-400'}`}
                >
                  <span>Drop clips here, choose files, or add them from the Media Bin</span>
                  <input
                    type="file"
                    multiple
                    accept=".mp4,.mov,.mkv,.avi,.m4v,.webm"
                    className="hidden"
                    onChange={e => { handleV1Files(e.target.files); e.target.value = '' }}
                  />
                </label>
              ) : (
                /* A populated lane stays a drop target: V1 APPENDS, so dropping
                   more files puts them after the last clip rather than
                   replacing anything — including a drop that lands on top of an
                   existing clip, since TimelineClip's own drop handler doesn't
                   stop the event and a file drop is a no-op for it. */
                <div
                  onClick={handleTimelineClick}
                  {...v1FileDragProps}
                  className={`flex-1 flex items-stretch gap-0.5 px-2 py-1.5 h-16 cursor-pointer transition-all ${v1DragOver ? 'bg-indigo-950/40' : 'bg-neutral-950'} ${!v1Visible ? 'opacity-35 grayscale' : ''}`}
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

            {/* A1 — the audio lane. Lives INSIDE timelineRef so the absolutely
                positioned playhead spans it and click-to-seek covers it with
                no extra math, exactly like V1 and V2. It has no gutter focus
                button (a plain <span>, like the ANIM label above): its clips
                aren't trimmable, so there's nothing for the clip toolbar or
                the Delete key to act on. */}
            <div className="border-t border-neutral-800">
              <div className="flex items-stretch">
                <div className="shrink-0 w-12 flex items-center justify-center gap-1 text-[9px] font-mono bg-neutral-800 text-emerald-500/80">
                  <span title="A1 — audio, laid end to end and locked to the V1 sequence">A1</span>
                  <button
                    onClick={toggleA1}
                    title={a1Visible ? 'Hide A1 content' : 'Show A1 content'}
                    className={a1Visible ? 'text-current hover:text-emerald-300' : 'text-neutral-600 hover:text-neutral-400'}
                  ><EyeIcon off={!a1Visible} /></button>
                </div>
                <div className="flex-1 relative">
                  {audioBeds.length === 0 ? (
                    <label
                      onDragOver={e => { e.preventDefault(); setA1DragOver(true) }}
                      onDragEnter={e => { e.preventDefault(); setA1DragOver(true) }}
                      onDragLeave={() => setA1DragOver(false)}
                      onDrop={e => { e.preventDefault(); setA1DragOver(false); handleA1Files(e.dataTransfer.files) }}
                      className={`flex w-full items-center justify-center gap-1.5 px-3 h-8 text-[10px] cursor-pointer transition-colors ${a1DragOver ? 'bg-emerald-950/40 text-emerald-300' : 'bg-neutral-950/50 text-neutral-600 hover:text-neutral-400'}`}
                    >
                      <span>Drop music or voice-over to run under V1</span>
                      <input
                        type="file"
                        multiple
                        accept=".wav,.mp3,.m4a,.aac,.flac,.aiff,audio/*"
                        className="hidden"
                        onChange={e => { handleA1Files(e.target.files); e.target.value = '' }}
                      />
                    </label>
                  ) : (
                    /* A populated lane stays a drop target: A1 APPENDS, so
                       dropping another file puts it after the last one rather
                       than replacing anything. The + at the end is the same
                       action for people who'd rather pick a file than drag it. */
                    <div
                      onClick={handleTimelineClick}
                      onDragOver={e => { e.preventDefault(); setA1DragOver(true) }}
                      onDragEnter={e => { e.preventDefault(); setA1DragOver(true) }}
                      onDragLeave={() => setA1DragOver(false)}
                      onDrop={e => { e.preventDefault(); setA1DragOver(false); handleA1Files(e.dataTransfer.files) }}
                      className={`flex items-stretch gap-1 px-2 py-1 h-8 cursor-pointer transition-all ${a1DragOver ? 'bg-emerald-950/40' : 'bg-neutral-950'} ${!a1Visible ? 'opacity-35 grayscale pointer-events-none' : ''}`}
                    >
                      {/* `clips` + `gapPx` are what LINK A1 to V1: the bar lays
                          itself out in V1's own coordinate space (per-clip
                          rendered widths and the 2px flex gaps between them)
                          rather than as one continuous sequenceSec*PPS span,
                          and it starts at V1's picture start rather than at 0 —
                          so a head hold pushes A1 forward with the video,
                          exactly as the render's adelay does. */}
                      <AudioBedBar
                        beds={audioBeds}
                        clips={clips}
                        sequenceSec={sequenceSec}
                        pps={PPS}
                        gapPx={GAP}
                        muted={a1Muted}
                        noiseEnabled={noiseEnabled}
                        onRemove={onRemoveBed}
                      />
                      <label
                        onClick={e => e.stopPropagation()}
                        title="Add another audio file to the end of A1"
                        className="shrink-0 self-center w-4 h-4 flex items-center justify-center rounded border border-neutral-700 text-neutral-500 text-[10px] leading-none cursor-pointer hover:border-emerald-600 hover:text-emerald-400"
                      >
                        +
                        <input
                          type="file"
                          multiple
                          accept=".wav,.mp3,.m4a,.aac,.flac,.aiff,audio/*"
                          className="hidden"
                          onChange={e => { handleA1Files(e.target.files); e.target.value = '' }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* A1 audio for the preview. Mounted here (not in App.jsx's preview
          stage) because `transport` lives in this component — which does mean
          A1 goes quiet on the AGENT/Reformat/Actions tabs, where the
          Timeline unmounts. Acceptable for a best-effort preview. */}
      {audioBeds.length > 0 && clips.length > 0 && (
        <AudioBedPlayer
          beds={audioBeds}
          transport={transport}
          muted={a1Muted}
          startSec={sequenceVideoStartSec(clips)}
        />
      )}

      <EdlTable clips={clips} selectedId={selectedId} onSelect={handleSelect} onDelete={handleDelete} />
    </div>
  )
}
