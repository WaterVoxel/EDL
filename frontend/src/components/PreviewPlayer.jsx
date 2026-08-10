import { useEffect, useState } from 'react'
import { useMedia } from '../context/MediaContext'

const CORNER_RADIUS_PX = 4 // matches Tailwind's `rounded` (--radius: 0.25rem)

export default function PreviewPlayer() {
  const { videoRef, setCurrentTime, activePreview } = useMedia()
  const [clipPath, setClipPath] = useState(`inset(0 round ${CORNER_RADIUS_PX}px)`)

  // Some sources (confirmed with a 2520x1080 H.264 file from Nuke's mov64
  // writer) have a bitstream-coded picture size a few pixels larger than
  // their real display size — the encoder pads the frame out to the next
  // 16px macroblock boundary (2528x1088 here) without signaling a crop in
  // the SPS (frame_cropping_flag=0), even though the MOV container's own
  // track header correctly declares 2520x1080. Browsers size a <video>
  // element from the bitstream's coded dimensions (videoWidth/videoHeight
  // read 2528x1088 here, confirmed live), NOT the container's declared
  // size, so those extra padding rows/columns get stretched into view as
  // a colored fringe along the right/bottom edges — reproduced and fixed
  // by hand via a headless-Chrome CDP session.
  //
  // Fix: clip-path inset by the exact padding fraction, computed from our
  // own backend's ffprobe-reported width/height (activePreview.info, the
  // TRUE display size) vs. the browser's own videoWidth/videoHeight (the
  // padded coded size). For any normally-encoded file the two already
  // match, so the inset is 0 and this is a no-op beyond the corner round.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    function recompute() {
      const trueW = activePreview?.info?.width
      const trueH = activePreview?.info?.height
      const { videoWidth, videoHeight } = video
      if (!trueW || !trueH || !videoWidth || !videoHeight) {
        setClipPath(`inset(0 round ${CORNER_RADIUS_PX}px)`)
        return
      }
      const rightPct = Math.max(0, (1 - trueW / videoWidth) * 100)
      const bottomPct = Math.max(0, (1 - trueH / videoHeight) * 100)
      setClipPath(`inset(0 ${rightPct}% ${bottomPct}% 0 round ${CORNER_RADIUS_PX}px)`)
    }

    recompute()
    video.addEventListener('loadedmetadata', recompute)
    return () => video.removeEventListener('loadedmetadata', recompute)
  }, [videoRef, activePreview])

  return (
    <video
      ref={videoRef}
      // Muted so native timeline playback (which now calls video.play() for
      // forward, normal-speed clips) stays silent — preview audio behaves
      // exactly as before. Also lets play() start without a user gesture.
      muted
      className="max-w-full max-h-full"
      style={{ clipPath }}
      onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
    />
  )
}
