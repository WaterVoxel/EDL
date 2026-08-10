import { useState, useRef } from 'react'
import { upload } from '../api'

// Compact upload control: click opens a file picker, or drag files directly
// onto it. Lives in the Media Bin header, next to Clear.
export default function Dropzone({ onUpload }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)

  function handleFiles(files) {
    for (const f of files) {
      upload(f).then(data => {
        if (data.error) alert('Upload failed: ' + data.error)
        else onUpload(data.name)
      })
    }
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragEnter={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); handleFiles(e.dataTransfer.files) }}
      onClick={() => inputRef.current?.click()}
      title="Drop a video file here, or click to choose one"
      className={`px-1.5 py-0.5 text-[9px] rounded cursor-pointer transition-colors ${
        over ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500' : 'bg-neutral-700 text-neutral-400 hover:text-neutral-200'
      }`}
    >
      <span>{over ? 'Drop to upload' : '⇪ Drag here or Upload'}</span>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".mp4,.mov,.mkv,.avi,.m4v,.webm"
        className="hidden"
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
