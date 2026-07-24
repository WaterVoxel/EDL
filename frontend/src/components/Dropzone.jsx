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
      className={`border border-dashed rounded-md p-3 text-center transition-colors ${over ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-700 bg-neutral-900'}`}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragEnter={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); handleFiles(e.dataTransfer.files) }}
    >
      <p className="text-neutral-500 text-[11px]">Drop files or</p>
      <input
        type="file"
        multiple
        accept=".mp4,.mov,.mkv,.avi,.m4v,.webm"
        className="mt-1 text-[11px] text-neutral-500 w-full"
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
