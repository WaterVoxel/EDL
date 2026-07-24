import { useState, useEffect, useCallback } from 'react'
import { listFiles, listOutputs, probe } from './api'
import { MediaProvider, useMedia } from './context/MediaContext'
import Dropzone from './components/Dropzone'
import MediaLibrary from './components/MediaLibrary'
import OutputLibrary from './components/OutputLibrary'
import PreviewPlayer from './components/PreviewPlayer'
import TechInfoPanel from './components/TechInfoPanel'
import ClearInputButton from './components/ClearInputButton'
import DownloadButton from './components/DownloadButton'
import HoldFrameForm from './components/HoldFrameForm'
import ReverseForm from './components/ReverseForm'
import ChatPanel from './components/ChatPanel'
import Timeline from './components/Timeline/Timeline'

function AppInner() {
  const [inputFiles, setInputFiles] = useState([])
  const [outputFiles, setOutputFiles] = useState([])
  const [timelineClips, setTimelineClips] = useState([])
  const [selectedOutput, setSelectedOutput] = useState(null)
  const { activePreview } = useMedia()

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
    refresh()
  }

  function handleRenderComplete() { refresh() }
  function handleEditResult() { refresh() }

  const displayInfo = activePreview?.info ? { ...activePreview.info, _name: activePreview.name } : null

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-200">
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-neutral-100 tracking-tight">ffmpeg editor</span>
          <span className="text-[10px] text-neutral-600 border border-neutral-700 rounded px-1.5 py-0.5">EDL mode</span>
        </div>
        <button onClick={() => location.reload()} className="px-3 py-1 text-xs rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500">↻ Refresh</button>
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

        {/* Center: Preview + Timeline */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 flex items-center justify-center bg-black p-4 min-h-0">
            <PreviewPlayer />
          </div>
          <div className="grid grid-cols-2 gap-3 px-3 pt-3">
            <HoldFrameForm inputFiles={inputFiles} onResult={handleEditResult} />
            <ReverseForm inputFiles={inputFiles} onResult={handleEditResult} />
          </div>
          <div className="p-3 shrink-0">
            <Timeline clips={timelineClips} setClips={setTimelineClips} onRenderComplete={handleRenderComplete} />
          </div>
        </div>

        {/* Right: Chat + outputs */}
        <div className="w-80 flex flex-col gap-3 p-3 border-l border-neutral-800 overflow-y-auto shrink-0">
          <ChatPanel onResult={handleEditResult} />
          <OutputLibrary files={outputFiles} selectedOutput={selectedOutput} onSelect={setSelectedOutput} />
          <DownloadButton outputName={selectedOutput} />
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
