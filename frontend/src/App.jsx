import { useState, useEffect, useCallback } from 'react'
import { listFiles, listOutputs, probe, trim, splice, promoteOutputToInput } from './api'
import { MediaProvider, useMedia } from './context/MediaContext'
import Dropzone from './components/Dropzone'
import MediaLibrary from './components/MediaLibrary'
import OutputPanel from './components/OutputPanel'
import PreviewPlayer from './components/PreviewPlayer'
import TechInfoPanel from './components/TechInfoPanel'
import ClearInputButton from './components/ClearInputButton'
import HoldFrameForm from './components/HoldFrameForm'
import ReverseForm from './components/ReverseForm'
import ChatPanel from './components/ChatPanel'
import Timeline from './components/Timeline/Timeline'

function AppInner() {
  const [inputFiles, setInputFiles] = useState([])
  const [outputFiles, setOutputFiles] = useState([])
  const [timelineClips, setTimelineClips] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [rendering, setRendering] = useState(false)
  const { activePreview } = useMedia()

  const selectedClip = timelineClips.find(c => c.id === selectedId) || null
  const hasDirty = timelineClips.some(c => c.dirty || (!c.renderedInputName && !(c.inSec === 0 && c.outSec === c.sourceDurationSec)))

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

  async function handleRenderSequence() {
    if (timelineClips.length === 0) return
    setRendering(true)
    try {
      const resolved = []
      for (const clip of timelineClips) {
        const untrimmed = clip.inSec === 0 && clip.outSec === clip.sourceDurationSec
        if (untrimmed && !clip.dirty) {
          resolved.push({ ...clip, renderedInputName: clip.sourceName })
        } else {
          const trimResult = await trim(clip.sourceName, clip.inSec.toFixed(4), clip.outSec.toFixed(4))
          if (trimResult.error) { alert('Trim failed: ' + trimResult.error); return }
          const promoted = await promoteOutputToInput(trimResult.output)
          if (promoted.error) { alert('Promote failed: ' + promoted.error); return }
          resolved.push({ ...clip, renderedInputName: promoted.name, dirty: false })
        }
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

  const displayInfo = activePreview?.info ? { ...activePreview.info, _name: activePreview.name } : null

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-200">
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-neutral-100 tracking-tight">ffmpeg editor</span>
          <span className="text-[10px] text-neutral-600 border border-neutral-700 rounded px-1.5 py-0.5">EDL mode</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRenderSequence}
            disabled={rendering || timelineClips.length === 0}
            className="px-3 py-1 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500"
          >
            {rendering ? 'Rendering…' : '▶ Render Sequence'}
          </button>
          <button onClick={() => location.reload()} className="px-3 py-1 text-xs rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500">↻ Refresh</button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Media bin + always-visible metadata inspector */}
        <div className="w-64 flex flex-col gap-3 p-3 border-r border-neutral-800 overflow-y-auto shrink-0">
          <Dropzone onUpload={handleUpload} />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-neutral-500">{inputFiles.length} file(s)</span>
            <ClearInputButton onCleared={handleCleared} />
          </div>
          <MediaLibrary files={inputFiles} onAddToTimeline={handleAddToTimeline} />
          <TechInfoPanel info={displayInfo} />
        </div>

        {/* Center: Preview + Timeline + Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 flex items-center justify-center bg-black p-4 min-h-0">
            <PreviewPlayer />
          </div>
          <div className="grid grid-cols-2 gap-3 px-3 pt-3">
            <HoldFrameForm selectedClip={selectedClip} onResult={handleEditResult} />
            <ReverseForm selectedClip={selectedClip} onResult={handleEditResult} />
          </div>
          <div className="p-3 shrink-0">
            <Timeline
              clips={timelineClips}
              setClips={setTimelineClips}
              selectedId={selectedId}
              onSelectId={setSelectedId}
              hasDirty={hasDirty}
            />
          </div>
          <div className="p-3 pt-0 shrink-0 h-48">
            <ChatPanel onResult={handleEditResult} />
          </div>
        </div>

        {/* Right: Rendered output + media info */}
        <div className="w-80 flex flex-col gap-3 p-3 border-l border-neutral-800 overflow-y-auto shrink-0">
          <OutputPanel files={outputFiles} />
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
