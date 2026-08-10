import { createContext, useContext, useRef, useState } from 'react'

const MediaContext = createContext(null)

export function MediaProvider({ children }) {
  const videoRef = useRef(null)
  const [currentTime, setCurrentTime] = useState(0)
  // activePreview = what the CENTER preview shows (driven by the timeline
  // playback engine). binSelection = what's selected in the left-column
  // Media Bin. They are deliberately separate: selecting a source in the
  // bin must NOT retarget or re-crop the center preview, which belongs to
  // the timeline/agent/reformat flow only.
  const [activePreview, setActivePreview] = useState(null)
  const [binSelection, setBinSelection] = useState(null)

  function seekTo(time) {
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
  }

  return (
    <MediaContext.Provider value={{ videoRef, currentTime, setCurrentTime, activePreview, setActivePreview, binSelection, setBinSelection, seekTo }}>
      {children}
    </MediaContext.Provider>
  )
}

export function useMedia() {
  return useContext(MediaContext)
}
