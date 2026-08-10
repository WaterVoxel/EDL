import { createContext, useContext, useState } from 'react'

const TourContext = createContext(null)

// Ordered walkthrough steps. `id` must match a `data-tour="<id>"` attribute
// somewhere in the app — TourOverlay looks that element up by id and
// spotlights it. Kept as one ordered list (not scattered inline tags) so
// "one tool at a time" has an actual sequence to step through.
export const TOUR_STEPS = [
  { id: 'title', text: 'This is the app title — click it anytime for the full About dialog with details on every feature.' },
  { id: 'project', text: 'Project controls: open the Library, Save, Export/Import a .nara project file, Export an EDL, or start a New session.' },
  { id: 'mediaInfoIn', text: 'Media Info In shows ffprobe details — resolution, codec, bitrate, etc. — for whatever source is currently previewed.' },
  { id: 'mediaBin', text: 'The Media Bin lists source files from input/. Click a file to preview it, or click + to add it to the V1 timeline. Use the search/sort bar to filter, ★ to favorite, and "Drag here or Upload" to add a new source file.' },
  { id: 'previewHeader', text: 'Crop picks a fixed output resolution/aspect for the selected clip. With a crop set, toggle Animate to keyframe the crop position — the ANIM lane under V1 gets + / − controls to add or remove a keyframe at the playhead, and the crop pans linearly between them. Render opens the render dialog for the whole V1 timeline.' },
  { id: 'previewStage', text: 'This shows the selected or currently playing clip. When a crop is set, drag the green box here to reposition it.' },
  { id: 'editToolbar', text: 'The edit toolbar acts on the selected clip: Hold (freeze a frame), Trim, Duplicate, Reverse, Splice (split at the playhead), Raise (round duration up), and Speed (slow motion).' },
  { id: 'timeline', text: "The Timeline tab: V1 is your main edit track, V2 is a scratch lane for Analyze/Reconstruct. The Edit Decision List below it lists every clip's decisions." },
  { id: 'reformat', text: 'The Reformat tab is a one-shot resize of the clip selected in the Media Bin: pick a resolution tier and aspect ratio and it scales down to fit (contain-fit, never upscales), writing a brand-new file — the source is never touched. It works outside the timeline, so no clips required.' },
  { id: 'agentDock', text: 'The AGENT tab lets you chat with a local Claude CLI to propose an ffmpeg edit, which you approve before it runs. The Actions tab shows a log of warnings and pending-render notices — Timeline/AGENT/Reformat/Actions share this one dock, one at a time.' },
  { id: 'rightColumn', text: 'This column shows rendered output — a preview, the Export Bin (files in output/), and Media Info Out for the selected export.' },
]

export function TourProvider({ children }) {
  // -1 = tour not running. 0..TOUR_STEPS.length-1 = active step index.
  const [stepIndex, setStepIndex] = useState(-1)

  const active = stepIndex >= 0
  const start = () => setStepIndex(0)
  const end = () => setStepIndex(-1)
  const next = () => setStepIndex(i => (i + 1 < TOUR_STEPS.length ? i + 1 : -1))
  const back = () => setStepIndex(i => Math.max(0, i - 1))

  return (
    <TourContext.Provider value={{ active, stepIndex, steps: TOUR_STEPS, start, end, next, back }}>
      {children}
    </TourContext.Provider>
  )
}

export function useTour() {
  return useContext(TourContext)
}
