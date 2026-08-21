import { createContext, useContext, useState } from 'react'

const TourContext = createContext(null)

// Ordered walkthrough steps. `id` must match a `data-tour="<id>"` attribute
// somewhere in the app — TourOverlay looks that element up by id and
// spotlights it. Kept as one ordered list (not scattered inline tags) so
// "one tool at a time" has an actual sequence to step through.
export const TOUR_STEPS = [
  { id: 'project', text: 'Project controls: open the Library, Save, Export/Import a .nara project file, Export an EDL, or start a New session. The gear opens FFmpeg Custom Settings — a size-capped two-pass encode you configure and save as named presets; it glows green while those settings are the ones Render will use. The document icon at the end opens the About manual, with details on every feature (the app title is just a label — this button is the way in).' },
  { id: 'mediaInfoIn', text: 'Media Info In shows ffprobe details — resolution, codec, bitrate, etc. — for whatever source is currently previewed.' },
  { id: 'mediaBin', text: 'The Media Bin lists source files from input/. Click a file to preview it, or click + to add it to the V1 timeline. Use the search/sort bar to filter, ★ to favorite, and "Drag here or Upload" to add a new source file.' },
  { id: 'previewHeader', text: 'The two IMAGE icons on the left grab the frame the preview is parked on: download it as a PNG at full source resolution, or copy it to the clipboard. On the right, V1 CROP picks a fixed output resolution/aspect for the selected clip. With a crop set, toggle Animate to keyframe the crop position — the ANIM lane under V1 gets + / − controls to add or remove a keyframe at the playhead, and the crop pans linearly between them.' },
  { id: 'previewStage', text: 'This shows the selected or currently playing clip. When a crop is set, drag the green box here to reposition it.' },
  { id: 'editToolbar', text: 'The edit toolbar acts on the selected clip: Hold (freeze a frame), Trim, Duplicate, Move ◀ ▶ (slide the clip one slot earlier or later in the sequence — same as ⌥← / ⌥→, dragging it along the lane, or the ▲ ▼ arrows on its EDL row), Reverse, Split (splice at the playhead — the one tool that also cuts an A1 audio clip, if that is what you clicked last), Round Up (hold the last frame so the sequence\'s total duration lands on a whole second — the amber readout beside it says by how much), and Speed (slow motion). A1 Room Tone at the end is the one render-wide toggle here — it fills the silent stretches of the render with room tone instead of digital silence: holds, round-ups, slow-downs, a source with no audio at all, the gap a removed A1 clip leaves, and the tail past the end of a short A1 track. It never plays over sound that is already there, so clip audio and the A1 bed come out untouched at their own level. The dB arrows beside it set how loud the tone is, −12 to +24 (default +12, and +24 is as loud as it goes without clipping); both the toggle and the level are saved with the project. It applies at render time, so the preview will not play it.' },
  { id: 'timeline', text: "The Timeline tab: V1 is your main edit track — add clips from the Media Bin's + or by dragging files straight onto it, several at once landing end to end like A1 takes audio. V2 is a scratch lane for Analyze/Reconstruct, and A1 underneath holds an ordered lane of audio clips locked to V1 — padded or cut to the sequence on every render. Each A1 clip keeps its own position, so removing one with its × leaves the rest where they are and the gap plays as silence (or as room tone). Click an A1 clip to select it — the playhead moves to where you clicked — and Split cuts it there into two clips playing adjoining parts of the same file, so the lane sounds exactly the same until you remove one of them. V1 clips have no position of their own — they play in list order — so to move one, drag it along the lane (a teal line marks the boundary it will land on, and the lane scrolls when you hold near an edge), use Move ◀ ▶ or ⌥← / ⌥→, or the ▲ ▼ arrows on its EDL row. Reordering V1 does not re-cut V2 retroactively: run V2 Analyzer again if you want V2 to follow the new order. The Edit Decision List below it lists every clip's decisions." },
  { id: 'renderBar', text: 'Everything that runs ffmpeg sits in this row. Left: V2 Reconstruct, V2 Analyzer, and V2 Batch Analyzer, which rewrite clips rather than write a file — the Analyzer stamps V1\'s IN/OUT points onto V2, the Batch Analyzer simply cuts V2 where V1 cuts, for a whole sequence that went out as one file. Center: the transport — play/stop, frame stepping, first/last, loop, and a clock you can type into (click it to switch timecode/frames). Right, in track order: V1 Render applies every V1 decision in one pass, V2 Render writes the V2 track (its A / A/B switch picks V2 alone or V2 composited over V1, and the 1 / 1+ switch beside it picks one joined file or one file per cut), and A1 Render writes the audio alone as a .wav the same length as the V1 render. The V2 and A1 buttons appear only once those tracks have something on them.' },
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
