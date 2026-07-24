import { useMedia } from '../context/MediaContext'

export default function PreviewPlayer() {
  const { videoRef, setCurrentTime } = useMedia()

  return (
    <video
      ref={videoRef}
      controls
      className="w-full max-h-56 bg-black rounded-md"
      onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
    />
  )
}
