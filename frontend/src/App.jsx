import { useState, useEffect, useCallback, useRef } from 'react'
import { listFiles, listOutputs, probe, upload, renderTimeline, saveProject } from './api'
import { useUndoableState } from './hooks/useUndoableState'
import { MediaProvider, useMedia } from './context/MediaContext'
import { TourProvider, useTour } from './context/TourContext'
import TourOverlay from './components/TourOverlay'
import MediaLibrary from './components/MediaLibrary'
import OutputPanel from './components/OutputPanel'
import PreviewPlayer from './components/PreviewPlayer'
import TechInfoPanel from './components/TechInfoPanel'
import HoldFrameForm from './components/HoldFrameForm'
import TrimForm from './components/TrimForm'
import ReverseForm from './components/ReverseForm'
import SpeedForm from './components/SpeedForm'
import CropForm from './components/CropForm'
import CropOverlay from './components/CropOverlay'
import OverlayPreview from './components/OverlayPreview'
import RaiseButton from './components/RaiseButton'
import SpliceButton from './components/SpliceButton'
import DuplicateButton from './components/DuplicateButton'
import ChatPanel from './components/ChatPanel'
import RenderDialog from './components/RenderDialog'
import ReformatPanel from './components/ReformatPanel'
import LogPanel from './components/LogPanel'
import ProjectLibrary from './components/ProjectLibrary'
import AboutDialog from './components/AboutDialog'
import Timeline from './components/Timeline/Timeline'
import { clipBaseSec, roundUpAmount } from './clipMath'
import { loadTrackTags, tagTrack } from './fileList'
import { analyzeAgainstV1, reconstructFromV1 } from './analyzeMath'
import { matchOverlays } from './overlayMatch'

const MIN_RIGHT_PANEL = 260
const MAX_RIGHT_PANEL = 720
const MIN_LEFT_PANEL = 180
const MAX_LEFT_PANEL = 560

function AppInner() {
  const [inputFiles, setInputFiles] = useState([])
  const [outputFiles, setOutputFiles] = useState([])
  // Sticky V1/V2 track tags per source file (persisted in localStorage) —
  // stamped the first time a file is placed on a track, drives the Media
  // Bin's V1/V2 filter. See fileList.tagTrack / filterByTrack.
  const [trackTags, setTrackTags] = useState(() => loadTrackTags())
  const {
    state: timelineClips,
    set: setTimelineClips,
    undo: undoTimeline,
    reset: resetTimeline,
    canUndo,
  } = useUndoableState([])
  const [selectedId, setSelectedId] = useState(null)
  // Which part of the selected clip is selected: the clip body itself
  // ('main') or one of its frozen-frame extensions ('head'|'tail'|'round').
  // Hold segments are selectable/deletable on their own, without deleting
  // the clip they extend.
  const [selectedPart, setSelectedPart] = useState('main')
  // V2's own selection — kept separate from V1's rather than reused, since
  // V1 and V2 clips can be selected independently while both are visible
  // (e.g. comparing a specific V1 cut against its V2 counterpart).
  const [selectedId2, setSelectedId2] = useState(null)
  const [selectedPart2, setSelectedPart2] = useState('main')
  // Which lane the toolbar (Trim/Hold/Reverse/Speed/Crop/Duplicate/Splice/
  // Raise) and Delete/Backspace act on — set whenever a clip or a lane's
  // own gutter label is clicked. Lifted up from Timeline.jsx (rather than
  // kept local there) specifically so this toolbar row, which lives here
  // in App.jsx, can redirect to whichever track is focused.
  const [focusedTrack, setFocusedTrack] = useState(1)
  // Per-track eye toggles, also lifted from Timeline.jsx: they decide what
  // the shared preview decodes, and with V2-as-overlay they additionally
  // gate the composited PiP layer on the preview stage below.
  const [v1Visible, setV1Visible] = useState(true)
  const [v2Visible, setV2Visible] = useState(true)
  const toggleV1Visible = useCallback(() => setV1Visible(v => !v), [])
  const toggleV2Visible = useCallback(() => setV2Visible(v => !v), [])

  const selectItem = useCallback((id, part = 'main') => {
    setSelectedId(id)
    setSelectedPart(id == null ? 'main' : part)
  }, [])
  const selectItem2 = useCallback((id, part = 'main') => {
    setSelectedId2(id)
    setSelectedPart2(id == null ? 'main' : part)
  }, [])
  const [rendering, setRendering] = useState(false)
  const [showRenderDialog, setShowRenderDialog] = useState(false)
  // Shared timecode/frames display mode — lifted here (rather than local to
  // TransportBar) so Trim and Splice, which live as separate sibling
  // components, can format/parse positions the same way the transport clock
  // does when the user toggles it.
  const [timeDisplayMode, setTimeDisplayMode] = useState('timecode')
  const toggleTimeDisplayMode = useCallback(() => {
    setTimeDisplayMode(m => m === 'timecode' ? 'frames' : 'timecode')
  }, [])
  // Timeline, the Agentic Assistant Editor, Reformat, and the Actions log
  // share one tabbed dock at the bottom of the center column — only one is
  // visible at a time.
  const [centerTab, setCenterTab] = useState('timeline')
  // "Animate" mode: reveals the ANIM lane under V1 with +/− keyframe
  // buttons, and drives the CropOverlay's on-preview position from the
  // active clip's cropKeyframes (interpolated at the playhead) instead of
  // its static crop.x/y. Off by default — keyframes stay on the clip when
  // toggled off, they just aren't shown or used for the preview.
  const [animateEnabled, setAnimateEnabled] = useState(false)
  const [freeEnabled, setFreeEnabled] = useState(false)
  const [rightPanelWidth, setRightPanelWidth] = useState(() => window.innerWidth * 0.18)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => window.innerWidth * 0.18)
  const resizingRef = useRef(null)
  const previewStageRef = useRef(null)
  const importInputRef = useRef(null)
  // The Timeline/AGENT/Actions dock's own wrapper (a single, stable DOM
  // node — only its children swap on tab change, per centerTab). Its
  // rendered height while showing Timeline becomes the fixed height
  // applied to it while showing AGENT/Actions, so toggling tabs never
  // changes the dock's height — Timeline's own natural content height is
  // the source of truth, not whatever ChatPanel/LogPanel would stretch to.
  const centerDockRef = useRef(null)
  const [centerDockHeight, setCenterDockHeight] = useState(null)
  const { binSelection } = useMedia()
  const { active: tourActive, start: startTour, stepIndex: tourStepIndex, steps: tourSteps } = useTour()

  // Timeline/AGENT/Actions are now mutually-exclusive tabs in one dock, so
  // the guided tour must switch to whichever tab its current step targets
  // before TourOverlay tries to spotlight it. Adjusted directly during
  // render (React's documented pattern for state derived from another
  // value) rather than in a useEffect, so the DOM already reflects the
  // right tab by the time TourOverlay's own effect measures it — a
  // separate effect here would race TourOverlay's and could measure the
  // previous tab's (wrong or absent) element for one frame.
  // Measure the dock's own rendered height only while Timeline is the
  // active tab — that's the "desired height" AGENT/Actions should be
  // pinned to instead of stretching taller. A ResizeObserver (not a
  // one-shot measurement) keeps this current if Timeline's own content
  // changes height while it's showing (clips added, holds appearing/
  // disappearing, etc.); it stops observing the moment the tab switches
  // away, so it never measures AGENT/Actions' own (different) height.
  useEffect(() => {
    const el = centerDockRef.current
    if (!el || centerTab !== 'timeline') return
    const measure = () => setCenterDockHeight(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [centerTab])

  if (tourActive) {
    const stepId = tourSteps[tourStepIndex]?.id
    if (stepId === 'agentDock' && centerTab === 'timeline') setCenterTab('assistant')
    else if (stepId === 'timeline' && centerTab !== 'timeline') setCenterTab('timeline')
  }

  // Track 2 ("Analyze") is a scratch lane, not part of the undo history —
  // it holds a single dropped file (unmodified) until Analyze cuts it to
  // match V1's structure, so it's rebuilt on demand rather than hand-edited
  // step by step. Full editing (Trim/Hold/Reverse/Speed/Crop/Duplicate/
  // Splice/Raise) is still allowed on it via the shared toolbar below —
  // "outside undo" only means Cmd/Ctrl+Z never reaches it, not that it's
  // read-only.
  const [track2Clips, setTrack2Clips] = useState([])

  const selectedClip = timelineClips.find(c => c.id === selectedId) || null
  const selectedClip2 = track2Clips.find(c => c.id === selectedId2) || null
  const hasDirty = timelineClips.some(c => c.dirty)

  // The shared toolbar row always acts on whichever track is currently
  // focused — clicking a V1 clip focuses V1, clicking a V2 clip focuses
  // V2, and the same Trim/Hold/Reverse/Speed/Crop/Duplicate/Splice/Raise
  // controls redirect to that track's own clips/setter/selection without
  // any change to those components themselves.
  const activeClips = focusedTrack === 2 ? track2Clips : timelineClips
  const setActiveClips = focusedTrack === 2 ? setTrack2Clips : setTimelineClips
  const activeSelectedClip = focusedTrack === 2 ? selectedClip2 : selectedClip
  const setActiveSelectedId = focusedTrack === 2 ? setSelectedId2 : setSelectedId

  // Persistent notices from Analyze (e.g. V1's cut points running past the
  // end of the file dropped on V2) — kept separate from the derived
  // round-up/dirty warnings below so they survive across renders.
  const [analyzeLog, setAnalyzeLog] = useState([])

  // V2-as-overlay detection: a V2 clip whose resolution differs from its
  // positionally-paired V1 clip is treated as a cropped region to composite
  // back on top, at the V1 clip's crop box, following its crop keyframes.
  // Derived (not state) — it depends on the crop/keyframes of V1's clips,
  // which the user can change at any moment, so there's nothing to
  // invalidate. See overlayMatch.js for the matching rules.
  const overlayMatch = matchOverlays(timelineClips, track2Clips)
  const overlays = overlayMatch.overlays
  const hasOverlay = overlays.length > 0

  // "Render V2" mode, toggled by the A / A/B switch beside that button:
  //   'A'  → render the V2 track on its own, to its own file (the original
  //          behavior, and the default).
  //   'AB' → composite V2 over V1 and render the two as one clip.
  // In A/B a V2 clip that matches V1's resolution covers the frame entirely,
  // which is exactly what the user is asking for here — so this pass opts
  // into `fullFrameSameSize`, unlike the always-on derivation above (where a
  // same-size V2 is ordinary replacement, not a composite).
  const [v2RenderMode, setV2RenderMode] = useState('A')
  const abMatch = matchOverlays(timelineClips, track2Clips, { fullFrameSameSize: true })
  const abOverlays = abMatch.overlays

  const logMessages = (() => {
    const msgs = []
    for (const c of timelineClips) {
      if (c.roundHoldSec > 0) continue
      const base = clipBaseSec(c)
      const amount = roundUpAmount(base)
      if (amount > 0) {
        msgs.push({ kind: 'warn', text: `⚠ "${c.displayName || c.sourceName}" duration is not rounded up (${base.toFixed(1)}s) — use Raise to round to ${(base + amount).toFixed(0)}s` })
      }
    }
    // Overlay near-misses (a size that doesn't match the crop box, a missing
    // crop box) are surfaced here rather than as an alert: they're derived
    // continuously, so an alert would fire on every keystroke of a resize.
    for (const text of overlayMatch.warnings) {
      msgs.push({ kind: 'warn', text: `⚠ ${text}` })
    }
    if (hasOverlay) {
      msgs.push({
        kind: 'info',
        text: `▣ ${overlays.length} V2 ${overlays.length === 1 ? 'clip is' : 'clips are'} composited over V1 `
          + `(${overlays.map(o => `${o.w}×${o.h}`).join(', ')}) — set the V2 toggle to A/B and click Render V2 to burn ${overlays.length === 1 ? 'it' : 'them'} in`,
      })
    }
    if (hasDirty) {
      msgs.push({ kind: 'info', text: '● Unrendered edits — click Render to apply' })
    }
    return [...analyzeLog, ...msgs]
  })()

  const refresh = useCallback(() => {
    listFiles().then(setInputFiles)
    listOutputs().then(setOutputFiles)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  function handleUpload() { refresh() }

  async function handleAddToTimeline(name) {
    const info = await probe(name, 'input')
    if (info.error) { alert('Could not probe file: ' + info.error); return }
    // Sticky-tag this source as a V1 file for the Media Bin filter.
    setTrackTags(prev => tagTrack(name, 'v1', prev))
    // Trim bounds use the video stream's own duration, not the container's:
    // the container can outlast the last video frame (audio runs longer),
    // and an outSec pointing past the final frame has nothing to hold or
    // seek to.
    const videoDur = info.video_duration || info.duration
    setTimelineClips(prev => [...prev, {
      id: crypto.randomUUID(),
      sourceName: name,
      sourceDir: 'input',
      sourceDurationSec: videoDur,
      sourceWidth: info.width || null,
      sourceHeight: info.height || null,
      fps: info.fps || 30,
      inSec: 0,
      outSec: videoDur,
      headHoldSec: 0,
      tailHoldSec: 0,
      roundHoldSec: 0,
      reversed: false,
      speed: 1,
      crop: null,
      cropKeyframes: [],
      dirty: true,
    }])
  }

  function handleCleared() {
    // Source files were just deleted from disk — undoing back to clips that
    // reference them would break, so clear the undo history too. V2 isn't
    // undoable, but its clips reference the same deleted input/ files, so
    // it needs clearing for the identical reason.
    resetTimeline([])
    setSelectedId(null)
    setTrack2Clips([])
    setSelectedId2(null)
    refresh()
  }

  // Called after the Agentic Assistant Editor runs an accepted ffmpeg
  // command. `output` (from /api/execute) names the file that command
  // actually wrote. If a clip is selected, load that result onto it in
  // place — same treatment Reconstruct gives a "fresh" source: the chat
  // edit is now baked into new pixels, so any trim/hold/reverse/speed/crop
  // staged on the OLD source no longer applies and must reset.
  async function handleEditResult(output) {
    refresh()
    if (!output || !selectedClip) return
    const info = await probe(output.name, output.dir)
    if (info.error) return
    const videoDur = info.video_duration || info.duration
    setTimelineClips(prev => prev.map(c => c.id !== selectedClip.id ? c : {
      ...c,
      sourceName: output.name,
      sourceDir: output.dir,
      sourceDurationSec: videoDur,
      sourceWidth: info.width || null,
      sourceHeight: info.height || null,
      fps: info.fps || c.fps,
      inSec: 0,
      outSec: videoDur,
      headHoldSec: 0,
      tailHoldSec: 0,
      roundHoldSec: 0,
      reversed: false,
      speed: 1,
      crop: null,
      cropKeyframes: [],
      dirty: true,
    }))
  }

  // Which clip list a pending render dialog targets: 'v1' (main timeline),
  // 'v2' (the Analyze scratch track), or 'composite' (V1 with V2's cropped
  // regions animated back on top — see overlayMatch.js).
  const [renderTarget, setRenderTarget] = useState('v1')

  function handleRenderClick() {
    if (timelineClips.length === 0) return
    setRenderTarget('v1')
    setShowRenderDialog(true)
  }

  function handleRenderV2Click() {
    if (track2Clips.length === 0) return
    if (v2RenderMode === 'AB') {
      // A/B: V2 over V1 as one clip. Needs V1 clips to composite onto and at
      // least one pair that actually resolves — otherwise say why instead of
      // silently rendering a plain V1.
      if (timelineClips.length === 0) {
        alert('A/B renders V2 over V1, so V1 needs clips too. Add clips to V1, or switch the toggle to A to render V2 on its own.')
        return
      }
      if (abOverlays.length === 0) {
        alert(
          'Nothing to composite in A/B mode:\n\n'
          + (abMatch.warnings.length
            ? abMatch.warnings.join('\n\n')
            : 'no V2 clip pairs with a V1 clip. V2 clips pair with V1 clips by order.')
          + '\n\nSwitch the toggle to A to render V2 on its own.'
        )
        return
      }
      setRenderTarget('composite')
      setShowRenderDialog(true)
      return
    }
    setRenderTarget('v2')
    setShowRenderDialog(true)
  }

  // `overlays` (optional, from overlayMatch.matchOverlays) attaches a V2
  // clip to the V1 clip it composites onto. The V1 clip's own crop is
  // deliberately dropped in that case: the crop box defined WHERE the region
  // came from, and in a composite it becomes the overlay's placement rect
  // (sent as overlay.x/y/w/h + keyframes) rather than a crop of V1 — the
  // whole point is to put the processed region back onto the full frame.
  function clipsToPayload(list, overlays = []) {
    return list.map(c => {
      const ov = overlays.find(o => o.v1Id === c.id) || null
      return {
        input: c.sourceName,
        dir: c.sourceDir || 'input',
        inSec: c.inSec,
        outSec: c.outSec,
        headHoldSec: c.headHoldSec || 0,
        tailHoldSec: c.tailHoldSec || 0,
        roundHoldSec: c.roundHoldSec || 0,
        reversed: !!c.reversed,
        speed: c.speed && c.speed > 0 ? c.speed : 1,
        crop: ov ? null : (c.crop || null),
        cropKeyframes: ov ? [] : (c.cropKeyframes || []),
        overlay: ov ? {
          input: ov.v2Clip.sourceName,
          dir: ov.v2Clip.sourceDir || 'input',
          inSec: ov.v2Clip.inSec,
          outSec: ov.v2Clip.outSec,
          x: ov.x,
          y: ov.y,
          w: ov.w,
          h: ov.h,
          keyframes: ov.keyframes,
        } : null,
      }
    })
  }

  async function handleRenderConfirm(outputName, noAudio = false) {
    setShowRenderDialog(false)
    setRendering(true)
    try {
      const isV2 = renderTarget === 'v2'
      const isComposite = renderTarget === 'composite'
      const sourceClips = isV2 ? track2Clips : timelineClips
      // Only a composite render attaches overlays; a plain V1 render still
      // renders V1 exactly as before (crop and all), so both are reachable.
      // A composite always comes from the A/B toggle, so it uses the
      // full-frame-aware match (abOverlays), not the always-on one.
      const payload = clipsToPayload(sourceClips, isComposite ? abOverlays : [])
      const result = await renderTimeline(payload, outputName, noAudio)
      if (result.error) { alert('Render failed: ' + result.error + (result.detail ? '\n' + result.detail : '')); return }
      if (!isV2) {
        setTimelineClips(prev => prev.map(c => ({ ...c, dirty: false })))
      } else {
        setTrack2Clips(prev => prev.map(c => ({ ...c, dirty: false })))
      }
      refresh()
    } finally {
      setRendering(false)
    }
  }

  function startResize(side) {
    return function (e) {
      e.preventDefault()
      resizingRef.current = side
      document.body.style.cursor = 'col-resize'

      function onMove(ev) {
        if (resizingRef.current === 'right') {
          const fromRight = window.innerWidth - ev.clientX
          setRightPanelWidth(Math.max(MIN_RIGHT_PANEL, Math.min(MAX_RIGHT_PANEL, fromRight)))
        } else if (resizingRef.current === 'left') {
          setLeftPanelWidth(Math.max(MIN_LEFT_PANEL, Math.min(MAX_LEFT_PANEL, ev.clientX)))
        }
      }
      function onUp() {
        resizingRef.current = null
        document.body.style.cursor = ''
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    }
  }

  const [projectName, setProjectName] = useState(null)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')

  async function handleAddToV2(file) {
    const result = await upload(file)
    if (result.error) { alert('Upload failed: ' + result.error); return }
    const info = await probe(result.name, 'input')
    if (info.error) { alert('Could not probe file: ' + info.error); return }
    // Sticky-tag this source as a V2 file for the Media Bin filter.
    setTrackTags(prev => tagTrack(result.name, 'v2', prev))
    const videoDur = info.video_duration || info.duration
    setTrack2Clips([{
      id: crypto.randomUUID(),
      sourceName: result.name,
      sourceDir: 'input',
      sourceDurationSec: videoDur,
      sourceWidth: info.width || null,
      sourceHeight: info.height || null,
      fps: info.fps || 30,
      inSec: 0,
      outSec: videoDur,
      headHoldSec: 0,
      tailHoldSec: 0,
      roundHoldSec: 0,
      reversed: false,
      speed: 1,
      crop: null,
      cropKeyframes: [],
      dirty: true,
    }])
    refresh()
  }

  function handleAnalyze() {
    if (track2Clips.length === 0) { alert('Drop a file on the V2 track first.'); return }
    if (timelineClips.length === 0) { alert('V1 has no clips to analyze against.'); return }
    const v2Source = track2Clips[0]
    const { segments, overflow } = analyzeAgainstV1(timelineClips, v2Source)
    if (segments.length === 0) {
      alert('Nothing to cut — none of V1\'s clips fit within the V2 file.')
      return
    }
    setTrack2Clips(segments)
    if (overflow > 0.001) {
      setAnalyzeLog(prev => [
        { kind: 'warn', text: `⚠ V1's cut points ran ${overflow.toFixed(2)}s past the end of "${v2Source.sourceName}" — the affected clip(s) were clamped to fit` },
        ...prev,
      ])
    }
  }

  function handleReconstruct() {
    if (timelineClips.length === 0) { alert('V1 has no clips to reconstruct from.'); return }
    if (track2Clips.length === 0) { alert('Drop the round-tripped file on V2 first — Reconstruct edits V2\'s own clip(s), it does not create new ones.'); return }
    const { segments, warnings } = reconstructFromV1(timelineClips, track2Clips)
    setTrack2Clips(segments)
    if (warnings.length > 0) {
      setAnalyzeLog(prev => [
        ...warnings.map(text => ({ kind: 'warn', text: `⚠ ${text}` })),
        ...prev,
      ])
    }
  }

  function buildProject() {
    return { version: 2, clips: timelineClips, track2Clips, selectedId }
  }

  async function handleSave() {
    let name = projectName
    if (!name) {
      name = prompt('Project name:', 'project')
      if (!name) return
    }
    const result = await saveProject(name, buildProject())
    if (result.error) { alert('Save failed: ' + result.error); return }
    setProjectName(result.name)
    setSaveStatus('Saved ' + new Date().toLocaleTimeString())
    setTimeout(() => setSaveStatus(''), 3000)
  }

  // Save As: always ask for a new name and save a copy under it, leaving the
  // currently-open project file untouched. The default seeds a "copy" name so
  // hitting Enter never overwrites the original. The active project switches
  // to the new name, so subsequent Saves target the copy.
  async function handleSaveAs() {
    const suggested = projectName
      ? projectName.replace(/\.nara$/, '') + ' copy'
      : 'project'
    const name = prompt('Save project as:', suggested)
    if (!name) return
    const result = await saveProject(name, buildProject())
    if (result.error) { alert('Save failed: ' + result.error); return }
    setProjectName(result.name)
    setSaveStatus('Saved ' + new Date().toLocaleTimeString())
    setTimeout(() => setSaveStatus(''), 3000)
  }

  function handleLibraryOpen(name, project) {
    resetTimeline(project.clips)
    setTrack2Clips(project.track2Clips || [])
    setSelectedId(project.selectedId || null)
    setProjectName(name)
    setShowLibrary(false)
  }

  function handleExportProject() {
    const blob = new Blob([JSON.stringify(buildProject(), null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = projectName || 'project.nara'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  // Reads a .nara file picked from disk (the counterpart to
  // handleExportProject's download) and loads it the same way opening a
  // saved project from the Library does — same shape, same trust model
  // (the server's own /api/projects save route only checks clips is a
  // list, so client-side validation mirrors that, not more).
  async function handleImportProject(file) {
    let project
    try {
      project = JSON.parse(await file.text())
    } catch {
      alert('Import failed: not a valid .nara/JSON file.')
      return
    }
    if (!project || !Array.isArray(project.clips)) {
      alert('Import failed: file is missing a "clips" list.')
      return
    }
    const name = file.name.replace(/\.\w+$/, '')
    handleLibraryOpen(name, project)
  }

  function handleExportEdl() {
    const lines = ['TITLE: NARA LOSSLESS EDITOR', '']
    let recFrame = 0
    const fps = timelineClips[0]?.fps || 24
    function tc(seconds) {
      const totalFrames = Math.round(seconds * fps)
      const ff = totalFrames % fps
      const totalSec = Math.floor(totalFrames / fps)
      const ss = totalSec % 60
      const mm = Math.floor((totalSec % 3600) / 60)
      const hh = Math.floor(totalSec / 3600)
      return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}:${String(ff).padStart(2,'0')}`
    }
    timelineClips.forEach((c, i) => {
      const dur = (c.outSec - c.inSec) + (c.headHoldSec || 0) + (c.tailHoldSec || 0) + (c.roundHoldSec || 0)
      const durFrames = Math.round(dur * fps)
      const evt = String(i + 1).padStart(3, '0')
      const reel = (c.displayName || c.sourceName).slice(0, 8).padEnd(8)
      const srcIn = tc(c.inSec)
      const srcOut = tc(c.outSec)
      const recIn = tc(recFrame / fps)
      const recOut = tc((recFrame + durFrames) / fps)
      lines.push(`${evt}  ${reel}  V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`)
      if (c.reversed) lines.push(`* REVERSE`)
      if (c.headHoldSec) lines.push(`* HEAD HOLD ${c.headHoldSec.toFixed(2)}s`)
      if (c.tailHoldSec) lines.push(`* TAIL HOLD ${c.tailHoldSec.toFixed(2)}s`)
      if (c.roundHoldSec) lines.push(`* ROUND ${c.roundHoldSec.toFixed(2)}s`)
      lines.push('')
      recFrame += durFrames
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = (projectName || 'project').replace(/\.\w+$/, '') + '.edl'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const displayInfo = (() => {
    if (!binSelection?.info) return null
    const info = { ...binSelection.info, _name: binSelection.name }
    // When the selected clip is slowed, show the stretched duration and the
    // frame count the constant-fps render will actually contain (the fps
    // normalization duplicates frames to fill the stretched timing).
    const speed = selectedClip?.speed
    if (selectedClip && speed && speed !== 1 && selectedClip.sourceName === binSelection.name) {
      if (info.duration) info.duration = info.duration / speed
      if (info.video_duration) info.video_duration = info.video_duration / speed
      if (info.nb_frames != null) info.nb_frames = Math.round(info.nb_frames / speed)
      info._name = `${binSelection.name} (${Math.round(speed * 100)}% speed)`
    }
    return info
  })()

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-200">
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 bg-neutral-900 shrink-0">
        <div data-tour="title" className="flex items-center gap-2">
          <button
            onClick={() => setShowAbout(true)}
            title="About Nara Lossless Editor"
            className="text-xs font-bold text-white tracking-tight hover:text-indigo-300"
          >NARA LOSSLESS EDITOR</button>
          <span className="text-[9px] text-neutral-600 border border-neutral-700 rounded px-1 py-0.5">EDL mode</span>
        </div>
        <div data-tour="project" className="flex items-center gap-1.5">
          {projectName && (
            <span className="text-[9px] text-neutral-500 mr-1">{projectName}{saveStatus && <span className="text-emerald-500 ml-1.5">{saveStatus}</span>}</span>
          )}
          <button
            onClick={() => setShowLibrary(true)}
            title="Open the project library"
            className="px-2.5 py-1 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500"
          >Library</button>
          <button
            onClick={handleSave}
            disabled={timelineClips.length === 0}
            title="Save project to the library"
            className="px-2.5 py-1 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-40"
          >Save</button>
          <button
            onClick={handleSaveAs}
            disabled={timelineClips.length === 0}
            title="Save a copy under a new name, without overwriting the current project"
            className="px-2.5 py-1 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-40"
          >Save As</button>
          <button
            onClick={handleExportProject}
            disabled={timelineClips.length === 0}
            title="Download the project as a .nara file"
            className="px-2.5 py-1 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-40"
          >Export</button>
          <button
            onClick={() => importInputRef.current?.click()}
            title="Load a project from a .nara file"
            className="px-2.5 py-1 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500"
          >Import</button>
          <input
            ref={importInputRef}
            type="file"
            accept=".nara,application/json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleImportProject(file)
              e.target.value = ''
            }}
          />
          <button
            onClick={handleExportEdl}
            disabled={timelineClips.length === 0}
            title="Export EDL file"
            className="px-2.5 py-1 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-40"
          >Export EDL</button>
          <div className="w-px h-4 bg-neutral-700" />
          <button onClick={() => location.reload()} className="px-2.5 py-1 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500">New</button>
          <button
            onClick={startTour}
            disabled={tourActive}
            title="Take a guided tour of the app, one part at a time"
            className={`w-6 h-6 flex items-center justify-center rounded text-[13px] border ${tourActive ? 'bg-amber-500 text-neutral-950 border-amber-500' : 'border-neutral-700 text-neutral-400 hover:text-amber-400 hover:border-amber-500'} disabled:cursor-default`}
          >💡</button>
        </div>
      </div>

      <TourOverlay />

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: mirrors the right column's own shape exactly — preview
            video, then always-visible metadata, then the bin as a flex-1
            card, so Media Bin's list fills the same remaining height
            Export Bin's own list does (OutputPanel.jsx has the identical
            video/info/flex-1-bin structure). */}
        <div
          style={{ width: leftPanelWidth }}
          className="flex flex-col gap-2 p-2 overflow-y-auto shrink-0"
        >
          <div className="flex-1 min-h-0 flex flex-col">
            <MediaLibrary files={inputFiles} trackTags={trackTags} onAddToTimeline={handleAddToTimeline} onCleared={handleCleared} onDeleted={refresh} onUpload={handleUpload}>
              <div data-tour="mediaInfoIn">
                <TechInfoPanel info={displayInfo} title="Media Info In" />
              </div>
            </MediaLibrary>
          </div>
        </div>

        {/* Drag handle to resize the left panel */}
        <div
          onPointerDown={startResize('left')}
          className="w-1.5 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-indigo-500 active:bg-indigo-500 transition-colors"
          title="Drag to resize"
        />

        {/* Center: Preview + toolbar + Timeline */}
        <div className="flex-1 flex flex-col min-w-0">
          <div data-tour="previewHeader" className="flex items-center justify-between px-2.5 py-1 border-b border-neutral-800 bg-neutral-900">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Preview</span>
            <div className="flex items-center gap-2">
              <CropForm
                selectedClip={activeSelectedClip}
                setClips={setActiveClips}
                animateEnabled={animateEnabled}
                onToggleAnimate={() => setAnimateEnabled(v => !v)}
                freeEnabled={freeEnabled}
                onToggleFree={() => setFreeEnabled(v => !v)}
              />
              <button
                onClick={handleRenderClick}
                disabled={rendering || timelineClips.length === 0}
                className="px-2.5 py-1 text-[10px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500"
              >
                {rendering ? 'Rendering…' : '▶ Render'}
              </button>
            </div>
          </div>
          <div ref={previewStageRef} data-tour="previewStage" className="relative flex-1 min-h-[50vh] flex items-center justify-center bg-black p-3">
            <PreviewPlayer />
            {/* Composited V2 regions, under the crop outline so the outline
                stays visible while dragging the box that positions them.
                One layer per overlay; each shows only while the shared
                <video> is decoding its own V1 source. */}
            {overlays.map(ov => (
              <OverlayPreview
                key={ov.v2Id}
                overlay={ov}
                stageRef={previewStageRef}
                visible={v2Visible}
              />
            ))}
            <CropOverlay selectedClip={activeSelectedClip} setClips={setActiveClips} stageRef={previewStageRef} animateEnabled={animateEnabled} freeEnabled={freeEnabled} />
          </div>

          {/* Timeline / AGENT / Actions tab bar — sits above the edit
              toolbar so it reads as "which dock pane" before "which tool
              acts on the current selection." Only one pane (below the
              toolbar) is visible at a time. Selected state is text color
              only (violet), not a background highlight. */}
          <div className="flex items-center gap-1 p-2">
            <button
              onClick={() => setCenterTab('timeline')}
              className={`flex-1 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide rounded bg-neutral-900 border border-neutral-800 ${centerTab === 'timeline' ? 'text-violet-400' : 'text-neutral-500 hover:text-neutral-300'}`}
            >Timeline</button>
            <button
              onClick={() => setCenterTab('assistant')}
              className={`flex-1 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide rounded bg-neutral-900 border border-neutral-800 ${centerTab === 'assistant' ? 'text-violet-400' : 'text-neutral-500 hover:text-neutral-300'}`}
            >AGENT</button>
            <button
              data-tour="reformat"
              onClick={() => setCenterTab('reformat')}
              className={`flex-1 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide rounded bg-neutral-900 border border-neutral-800 ${centerTab === 'reformat' ? 'text-violet-400' : 'text-neutral-500 hover:text-neutral-300'}`}
            >Reformat</button>
            <button
              onClick={() => setCenterTab('actions')}
              className={`flex-1 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide rounded bg-neutral-900 border border-neutral-800 ${centerTab === 'actions' ? 'text-violet-400' : 'text-neutral-500 hover:text-neutral-300'}`}
            >Actions</button>
          </div>

          <div data-tour="editToolbar" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 py-1.5 border-y border-neutral-800 bg-neutral-900">
            <HoldFrameForm clips={activeClips} setClips={setActiveClips} />
            <div className="w-px h-3.5 bg-neutral-700" />
            <TrimForm selectedClip={activeSelectedClip} setClips={setActiveClips} displayMode={timeDisplayMode} />
            <div className="w-px h-3.5 bg-neutral-700" />
            <DuplicateButton selectedClip={activeSelectedClip} clips={activeClips} setClips={setActiveClips} onSelectId={setActiveSelectedId} />
            <div className="w-px h-3.5 bg-neutral-700" />
            <ReverseForm selectedClip={activeSelectedClip} setClips={setActiveClips} />
            <div className="w-px h-3.5 bg-neutral-700" />
            <SpliceButton selectedClip={activeSelectedClip} clips={activeClips} setClips={setActiveClips} onSelectId={setActiveSelectedId} displayMode={timeDisplayMode} />
            <div className="w-px h-3.5 bg-neutral-700" />
            <RaiseButton clips={activeClips} setClips={setActiveClips} />
            <div className="w-px h-3.5 bg-neutral-700" />
            <SpeedForm selectedClip={activeSelectedClip} setClips={setActiveClips} />
          </div>

          {/* Timeline / AGENT / Actions pane content — only one visible at
              a time, per the tab bar above. Timeline sets this wrapper's
              natural content height (shrink-0, unconstrained); switching
              to AGENT/Actions pins the wrapper to that SAME height
              (centerDockHeight, measured off Timeline via the ResizeObserver
              effect above) rather than letting ChatPanel/LogPanel stretch
              it taller — so toggling tabs never changes the dock's height.
              min-h-56 is still applied as a floor UNDERNEATH the pinned
              height (via Math.max, not instead of it): an empty Timeline
              (no clips) is naturally only ~150px tall, which would clip
              ChatPanel's own input row — 56 (14rem/224px) matches
              ChatPanel's minimum usable height (header + editing banner +
              its 100px message-area floor + input row), so AGENT/Actions
              stay usable even when Timeline itself is currently shorter
              than that. */}
          <div
            ref={centerDockRef}
            style={centerTab !== 'timeline' && centerDockHeight ? { height: Math.max(centerDockHeight, 224) } : undefined}
            className={`flex flex-col p-2 ${centerTab === 'timeline' ? 'shrink-0' : centerDockHeight ? 'shrink-0 overflow-hidden' : 'flex-1 min-h-56'}`}
          >
            {centerTab === 'timeline' && (
              <div data-tour="timeline">
                <Timeline
                  clips={timelineClips}
                  setClips={setTimelineClips}
                  selectedId={selectedId}
                  selectedPart={selectedPart}
                  onSelectId={setSelectedId}
                  onSelectItem={selectItem}
                  hasDirty={hasDirty}
                  onUndo={undoTimeline}
                  canUndo={canUndo}
                  track2Clips={track2Clips}
                  setTrack2Clips={setTrack2Clips}
                  selectedId2={selectedId2}
                  selectedPart2={selectedPart2}
                  onSelectItem2={selectItem2}
                  focusedTrack={focusedTrack}
                  onFocusTrack={setFocusedTrack}
                  onAddToV2={handleAddToV2}
                  onAnalyze={handleAnalyze}
                  onReconstruct={handleReconstruct}
                  onRenderV2={handleRenderV2Click}
                  timeDisplayMode={timeDisplayMode}
                  onToggleTimeDisplayMode={toggleTimeDisplayMode}
                  animateEnabled={animateEnabled}
                  v1Visible={v1Visible}
                  onToggleV1={toggleV1Visible}
                  v2Visible={v2Visible}
                  onToggleV2={toggleV2Visible}
                  hasOverlay={hasOverlay}
                  v2RenderMode={v2RenderMode}
                  onSetV2RenderMode={setV2RenderMode}
                />
              </div>
            )}
            {centerTab === 'assistant' && (
              <div data-tour="agentDock" className="flex-1 min-h-0 flex flex-col">
                <ChatPanel onResult={handleEditResult} selectedClipName={selectedClip?.sourceName} />
              </div>
            )}
            {centerTab === 'reformat' && (
              <div className="flex-1 min-h-0 flex flex-col">
                <ReformatPanel onRendered={refresh} />
              </div>
            )}
            {centerTab === 'actions' && (
              <div data-tour="agentDock" className="flex-1 min-h-0 flex flex-col">
                <LogPanel messages={logMessages} />
              </div>
            )}
          </div>
        </div>

        {/* Drag handle to resize the right panel */}
        <div
          onPointerDown={startResize('right')}
          className="w-1.5 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-indigo-500 active:bg-indigo-500 transition-colors"
          title="Drag to resize"
        />

        {/* Right: Rendered output + media info */}
        <div
          style={{ width: rightPanelWidth }}
          data-tour="rightColumn"
          className="flex flex-col gap-2 p-2 overflow-y-auto shrink-0"
        >
          <OutputPanel files={outputFiles} onCleared={refresh} />
        </div>
      </div>

      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}

      {showLibrary && (
        <ProjectLibrary
          onOpen={handleLibraryOpen}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {showRenderDialog && (
        <RenderDialog
          defaultName={(() => {
            const sourceClips = renderTarget === 'v2' ? track2Clips : timelineClips
            const base = sourceClips[0]?.sourceName || 'render.mp4'
            const dot = base.lastIndexOf('.')
            const stem = dot > 0 ? base.slice(0, dot) : base
            if (renderTarget === 'v2') return `${stem}-analyzed.mp4`
            if (renderTarget === 'composite') return `${stem}-composite.mp4`
            return `${stem}.mp4`
          })()}
          showNoAudioOption={renderTarget === 'v2'}
          onConfirm={handleRenderConfirm}
          onCancel={() => setShowRenderDialog(false)}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <MediaProvider>
      <TourProvider>
        <AppInner />
      </TourProvider>
    </MediaProvider>
  )
}
