import { createContext, useContext, useRef, useState } from 'react'

const MediaContext = createContext(null)

export function MediaProvider({ children }) {
  const videoRef = useRef(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [activePreview, setActivePreview] = useState(null)

  function seekTo(time) {
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
  }

  return (
    <MediaContext.Provider value={{ videoRef, currentTime, setCurrentTime, activePreview, setActivePreview, seekTo }}>
      {children}
    </MediaContext.Provider>
  )
}

export function useMedia() {
  return useContext(MediaContext)
}
