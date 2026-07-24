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
    <div className="flex flex-col h-screen p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-neutral-100">ffmpeg editor</h1>
        <button onClick={() => location.reload()} className="px-3 py-1 text-xs rounded border border-neutral-600 text-neutral-400 hover:text-neutral-200">↻ Refresh</button>
      </div>

      {/* Dropzone */}
      <Dropzone onUpload={handleUpload} />

      {/* Main content */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: Media library + preview */}
        <div className="w-72 flex flex-col gap-3 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">{inputFiles.length} file(s)</span>
            <ClearInputButton onCleared={handleCleared} />
          </div>
          <MediaLibrary files={inputFiles} onAddToTimeline={handleAddToTimeline} />
          <PreviewPlayer />
          <TechInfoPanel info={displayInfo} />
        </div>

        {/* Center: Timeline + forms */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          <Timeline clips={timelineClips} setClips={setTimelineClips} onRenderComplete={handleRenderComplete} />
          <div className="grid grid-cols-2 gap-3">
            <HoldFrameForm inputFiles={inputFiles} onResult={handleEditResult} />
            <ReverseForm inputFiles={inputFiles} onResult={handleEditResult} />
          </div>
        </div>

        {/* Right: Chat + outputs */}
        <div className="w-80 flex flex-col gap-3 shrink-0">
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
