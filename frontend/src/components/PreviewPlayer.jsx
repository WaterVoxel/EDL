import { useMedia } from '../context/MediaContext'

export default function PreviewPlayer() {
  const { videoRef, setCurrentTime } = useMedia()

  return (
    <video
      ref={videoRef}
      controls
      className="max-w-full max-h-full rounded"
      onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
    />
  )
}
