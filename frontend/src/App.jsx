import { useState, useEffect, useCallback, useRef } from 'react'
import { listFiles, listOutputs, probe, trim, splice, holdFrame, promoteOutputToInput } from './api'
import { MediaProvider, useMedia } from './context/MediaContext'
import Dropzone from './components/Dropzone'
import MediaLibrary from './components/MediaLibrary'
import OutputPanel from './components/OutputPanel'
import PreviewPlayer from './components/PreviewPlayer'
import TechInfoPanel from './components/TechInfoPanel'
import HoldFrameForm from './components/HoldFrameForm'
import TrimForm from './components/TrimForm'
import ReverseForm from './components/ReverseForm'
import RaiseButton from './components/RaiseButton'
import SpliceButton from './components/SpliceButton'
import ChatPanel from './components/ChatPanel'
import Timeline from './components/Timeline/Timeline'

const MIN_RIGHT_PANEL = 260
const MAX_RIGHT_PANEL = 720
const MIN_LEFT_PANEL = 180
const MAX_LEFT_PANEL = 560

function AppInner() {
  const [inputFiles, setInputFiles] = useState([])
  const [outputFiles, setOutputFiles] = useState([])
  const [timelineClips, setTimelineClips] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [rendering, setRendering] = useState(false)
  const [rightPanelWidth, setRightPanelWidth] = useState(320)
  const [leftPanelWidth, setLeftPanelWidth] = useState(224)
  const resizingRef = useRef(null)
  const { activePreview } = useMedia()

  const selectedClip = timelineClips.find(c => c.id === selectedId) || null
  const hasDirty = timelineClips.some(c =>
    c.dirty ||
    (!c.renderedInputName && (
      c.inSec !== 0 || c.outSec !== c.sourceDurationSec ||
      (c.headHoldSec || 0) > 0 || (c.tailHoldSec || 0) > 0 || (c.roundHoldSec || 0) > 0
    ))
  )

  const refresh = useCallback(() => {
    listFiles().then(setInputFiles)
    listOutputs().then(setOutputFiles)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  function handleUpload() { refresh() }

  async function handleAddToTimeline(name) {
    const info = await probe(name, 'input')
    if (info.error) { alert('Could not probe file: ' + info.error); return }
    setTimelineClips(prev => [...prev, {
      id: crypto.randomUUID(),
      sourceName: name,
      sourceDurationSec: info.duration,
      fps: info.fps || 30,
      inSec: 0,
      outSec: info.duration,
      headHoldSec: 0,
      tailHoldSec: 0,
      roundHoldSec: 0,
      dirty: false,
      renderedInputName: null,
    }])
  }

  function handleCleared() {
    setTimelineClips([])
    setSelectedId(null)
    refresh()
  }

  function handleEditResult() { refresh() }

  async function handleRender() {
    if (timelineClips.length === 0) return
    setRendering(true)
    try {
      const resolved = []
      for (const clip of timelineClips) {
        const needsHold = (clip.headHoldSec || 0) > 0 || (clip.tailHoldSec || 0) > 0 || (clip.roundHoldSec || 0) > 0
        const untrimmed = clip.inSec === 0 && clip.outSec === clip.sourceDurationSec
        if (untrimmed && !needsHold && !clip.dirty) {
          resolved.push({ ...clip, renderedInputName: clip.sourceName })
          continue
        }

        // 1. Trim to the selected in/out range.
        const trimResult = await trim(clip.sourceName, clip.inSec.toFixed(4), clip.outSec.toFixed(4))
        if (trimResult.error) { alert('Trim failed: ' + trimResult.error); return }
        let currentName = trimResult.output

        // 2. Apply head hold: freeze the first frame (time 0 of the now-trimmed
        // clip) for headHoldSec, extending total length by that amount. Only
        // ever present on the sequence's first clip.
        if (clip.headHoldSec > 0) {
          const promoted = await promoteOutputToInput(currentName)
          if (promoted.error) { alert('Promote failed: ' + promoted.error); return }
          const held = await holdFrame(promoted.name, 0, clip.headHoldSec)
          if (held.error) { alert('Head hold failed: ' + held.error); return }
          currentName = held.output
        }

        // 3. Apply tail hold: freeze the last frame for tailHoldSec. Re-probe
        // first since the clip's duration changed if a head hold was applied.
        // Only ever present on the sequence's last clip.
        if (clip.tailHoldSec > 0) {
          const promoted = await promoteOutputToInput(currentName)
          if (promoted.error) { alert('Promote failed: ' + promoted.error); return }
          const info = await probe(promoted.name, 'input')
          if (info.error) { alert('Probe failed: ' + info.error); return }
          const tailTime = Math.max(0, info.duration - 1 / (clip.fps || 30))
          const held = await holdFrame(promoted.name, tailTime, clip.tailHoldSec)
          if (held.error) { alert('Tail hold failed: ' + held.error); return }
          currentName = held.output
        }

        // 4. Apply Raise's round-up hold: same mechanism as tail hold, always
        // trails the sequence's last clip so the whole program's total
        // duration lands on a whole second.
        if (clip.roundHoldSec > 0) {
          const promoted = await promoteOutputToInput(currentName)
          if (promoted.error) { alert('Promote failed: ' + promoted.error); return }
          const info = await probe(promoted.name, 'input')
          if (info.error) { alert('Probe failed: ' + info.error); return }
          const endTime = Math.max(0, info.duration - 1 / (clip.fps || 30))
          const held = await holdFrame(promoted.name, endTime, clip.roundHoldSec)
          if (held.error) { alert('Raise hold failed: ' + held.error); return }
          currentName = held.output
        }

        const promoted = await promoteOutputToInput(currentName)
        if (promoted.error) { alert('Promote failed: ' + promoted.error); return }
        resolved.push({ ...clip, renderedInputName: promoted.name, dirty: false })
      }

      if (resolved.length > 1) {
        const spliceResult = await splice(resolved.map(c => c.renderedInputName))
        if (spliceResult.error) { alert('Splice failed: ' + spliceResult.error); return }
      }
      setTimelineClips(resolved)
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

  const displayInfo = activePreview?.info ? { ...activePreview.info, _name: activePreview.name } : null

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-200">
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 bg-neutral-900 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-neutral-100 tracking-tight">Nara Lossless Editor</span>
          <span className="text-[9px] text-neutral-600 border border-neutral-700 rounded px-1 py-0.5">EDL mode</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRender}
            disabled={rendering || timelineClips.length === 0}
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500"
          >
            {rendering ? 'Rendering…' : '▶ Render'}
          </button>
          <button onClick={() => location.reload()} className="px-2.5 py-1 text-[11px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500">↻ Refresh</button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Media bin + always-visible metadata inspector */}
        <div
          style={{ width: leftPanelWidth }}
          className="flex flex-col gap-2 p-2 overflow-y-auto shrink-0"
        >
          <Dropzone onUpload={handleUpload} />
          <span className="text-[9px] text-neutral-500">{inputFiles.length} file(s)</span>
          <MediaLibrary files={inputFiles} onAddToTimeline={handleAddToTimeline} onCleared={handleCleared} />
          <TechInfoPanel info={displayInfo} />
        </div>

        {/* Drag handle to resize the left panel */}
        <div
          onPointerDown={startResize('left')}
          className="w-1.5 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-indigo-500 active:bg-indigo-500 transition-colors"
          title="Drag to resize"
        />

        {/* Center: Preview + toolbar + Timeline + Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-[50vh] flex items-center justify-center bg-black p-3">
            <PreviewPlayer />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 py-1.5 border-y border-neutral-800 bg-neutral-900">
            <HoldFrameForm clips={timelineClips} setClips={setTimelineClips} />
            <div className="w-px h-3.5 bg-neutral-700" />
            <TrimForm selectedClip={selectedClip} setClips={setTimelineClips} />
            <div className="w-px h-3.5 bg-neutral-700" />
            <ReverseForm selectedClip={selectedClip} onResult={handleEditResult} />
            <div className="w-px h-3.5 bg-neutral-700" />
            <RaiseButton clips={timelineClips} setClips={setTimelineClips} />
            <div className="w-px h-3.5 bg-neutral-700" />
            <SpliceButton selectedClip={selectedClip} clips={timelineClips} setClips={setTimelineClips} onSelectId={setSelectedId} />
          </div>

          <div className="p-2 shrink-0">
            <Timeline
              clips={timelineClips}
              setClips={setTimelineClips}
              selectedId={selectedId}
              onSelectId={setSelectedId}
              hasDirty={hasDirty}
            />
          </div>
          <div className="p-2 pt-0 shrink-0 h-40">
            <ChatPanel onResult={handleEditResult} />
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
          className="flex flex-col gap-2 p-2 overflow-y-auto shrink-0"
        >
          <OutputPanel files={outputFiles} onCleared={refresh} />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <MediaProvider>
      <AppInner />
    </MediaProvider>
  )
}
