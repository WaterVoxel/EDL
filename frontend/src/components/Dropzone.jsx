import { useState } from 'react'
import { upload } from '../api'

export default function Dropzone({ onUpload }) {
  const [over, setOver] = useState(false)

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
      className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${over ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-600 bg-neutral-800/50'}`}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragEnter={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); handleFiles(e.dataTransfer.files) }}
    >
      <p className="text-neutral-400 text-sm">Drag &amp; drop video files here, or</p>
      <input
        type="file"
        multiple
        accept=".mp4,.mov,.mkv,.avi,.m4v,.webm"
        className="mt-2 text-sm text-neutral-400"
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
