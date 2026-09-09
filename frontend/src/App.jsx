import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { listFiles, listOutputs, probe, upload, renderTimeline, renderA1, saveProject, getExportSettings, setExportSettings, getVersion } from './api'
import { useUndoableTracks } from './hooks/useUndoableTracks'
import { MediaProvider, useMedia } from './context/MediaContext'
import { TourProvider, useTour } from './context/TourContext'
import TourOverlay from './components/TourOverlay'
import MediaLibrary from './components/MediaLibrary'
import OutputPanel from './components/OutputPanel'
import PreviewPlayer from './components/PreviewPlayer'
import FrameGrabButtons from './components/FrameGrabButtons'
import TechInfoPanel from './components/TechInfoPanel'
import HoldFrameForm from './components/HoldFrameForm'
import TrimForm from './components/TrimForm'
import ReverseForm from './components/ReverseForm'
import SpeedForm, {
  NOISE_GAIN_DB_DEFAULT, NOISE_GAIN_DB_MIN, NOISE_GAIN_DB_MAX,
} from './components/SpeedForm'
import CropForm from './components/CropForm'
import CropOverlay from './components/CropOverlay'
import OverlayPreview from './components/OverlayPreview'
import RaiseButton from './components/RaiseButton'
import SpliceButton from './components/SpliceButton'
import PanelDivider from './components/PanelDivider'
import MergeButton from './components/MergeButton'
import DuplicateButton from './components/DuplicateButton'
import MoveClipButtons from './components/MoveClipButtons'
import ChatPanel from './components/ChatPanel'
import RenderDialog from './components/RenderDialog'
import ReformatPanel from './components/ReformatPanel'
import LogPanel from './components/LogPanel'
import ProjectLibrary from './components/ProjectLibrary'
import AboutDialog from './components/AboutDialog'
import FootageLossDialog from './components/FootageLossDialog'
import FfmpegCustomSettings from './components/FfmpegCustomSettings'
import ContextMenu from './components/ContextMenu'
import Timeline from './components/Timeline/Timeline'
import { sequenceTargetFps, sequenceRenderFrames, sequenceRaise, roundUpAmount, clampNoiseGainDb, normalizeBeds, bedLaneEndSec, bedInSec, fuseGroups, clipPalette, clipTotalSec, CLIP_THEME_NAMES, DEFAULT_CLIP_THEME } from './clipMath'
import { loadTrackTags, tagTrack, renameTrackTag, isAudioFile, loadHideFootageLossWarning, saveHideFootageLossWarning, loadClipTheme, saveClipTheme } from './fileList'
import { analyzeAgainstV1, batchCutAgainstV1, reconstructFromV1, sequencePieces } from './analyzeMath'
import { mergeExportPresets } from './exportPresets'
import { workFingerprint } from './projectWork'
import { matchOverlays, compareOverlays, compareCoverageSec } from './overlayMatch'
import { isFitCrop } from './cropMath'
import { shotOutputNames, nameStem } from './renderNames'

// How far each side column can be dragged. The two minimums are deliberately
// the same number: the right column used to stop at 260 while the left went to
// 180, so the right one couldn't be pushed as far out of the way as the left
// even though its widest setting is already the larger of the two. Nothing in
// the right column needs 260 — the Export Bin rows and Media Info Out are the
// same kind of narrow list the left column holds at 180, and the output preview
// is a `<video>` that scales to whatever width it gets.
const MIN_RIGHT_PANEL = 180
const MAX_RIGHT_PANEL = 720
const MIN_LEFT_PANEL = 180
const MAX_LEFT_PANEL = 560

// Opening width of each side column, as a fraction of the window — so the centre
// (preview + timeline) starts with the remaining ~70%. ONE constant for both sides
// rather than the same literal twice, because the two columns are meant to open
// symmetrically and two copies is how that quietly stops being true.
//
// Applied at mount only, and NOT clamped to the MIN/MAX above — those bound the
// divider drag. So on a window narrower than MIN_LEFT_PANEL / this fraction
// (=1200px) the columns open below their own minimum and the first drag snaps them
// wider. Worth knowing before lowering this further.
const DEFAULT_PANEL_FRACTION = 0.15

// Below this, a V1 trim isn't a decision anyone made — an edge drag converts
// screen pixels to seconds, so a single stray pointermove can shave a fraction
// of a frame off a clip. Warning about that would train the user to dismiss the
// popup without reading it, which is the only way this warning can fail.
const MIN_LOSS_SEC = 0.02

// The app's version, from `VERSION` at the repo root — the single source of
// truth (see CLAUDE.md). vite.config puts it on Vite's env channel, which is
// the one mechanism that behaves identically in dev and in a build; the alias
// exists only so the four call sites below don't each spell out the env lookup.
// Read it, never write it: a literal here would be a second place storing the
// version, and it would be the one that goes stale.
const APP_VERSION = import.meta.env.VITE_APP_VERSION

// Same inline-SVG idiom as Timeline's EyeIcon and the frame-grab icons:
// 24-unit box, stroke: currentColor, so the button's own text color drives it.
// A stroked bulb replaced the 💡 emoji: the emoji stayed yellow no matter what
// the button did, so it couldn't invert against the amber "tour running" fill,
// and it rendered at whatever weight the system font decided. Drawn one pixel
// larger than DocIcon because a narrow outline reads lighter than a page's
// block shape at the same box size.
function BulbIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5A5.5 5.5 0 0 0 18 8a6 6 0 0 0-12 0c0 1.2.4 2.5 1.5 3.5.8.8 1.3 1.5 1.5 2.5" />
      <path d="M9.5 17.5h5" />
      <path d="M10.5 20.5h3" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  )
}

// A ring with eight teeth rather than the usual one-path cog: at 13px the
// detailed outline mushes into a blob, while spokes still read as a gear.
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 4.5V1.5M12 19.5v3M4.5 12h-3M19.5 12h3M6.7 6.7 4.6 4.6M17.3 17.3l2.1 2.1M17.3 6.7l2.1-2.1M6.7 17.3l-2.1 2.1" />
    </svg>
  )
}

// The project group's icons — Library / Save / Save As / New always visible, and
// Export / Import / Export EDL now living inside the ⋯ drop-down beside them
// (with FFmpeg Custom Settings) since they are the ones reached occasionally
// rather than mid-edit. Same 24-grid stroked idiom as the three above, so the
// whole top-right row reads as one set of square buttons rather than a row of
// words followed by a row of glyphs.
//
// Two choices worth knowing, both about telling a pair apart at 13px:
//   · Save and Save As share ONE silhouette on purpose — the same floppy, with a
//     `+` where Save's label block sits. "Another one of these", which is exactly
//     what Save As does. Two unrelated glyphs would hide that they are siblings.
//   · Export and Import are a mirrored pair over a shared baseline: the arrow
//     points down onto the line to leave for disk, up off it to come back in.
//     Export's geometry is deliberately the same three paths as the frame-grab
//     DownloadIcon (FrameGrabButtons.jsx), because both mean "write a file out".
// Export EDL is text-lines-plus-arrow rather than a page, because a page with
// lines in it is already taken: that is DocIcon, the About button, two buttons
// along. Its three lines are EQUAL length on purpose — drawn short-to-long they
// were a sort-descending glyph, which the Media Bin's own sort control already
// means. Every one of them is icon-only, so every one carries a `title` — that
// tooltip is now the only place the button's name exists.
function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 17.2V6.2a1.7 1.7 0 0 1 1.7-1.7h3.2l1.9 2.3h6.3a1.7 1.7 0 0 1 1.7 1.7v1.6" />
      <path d="M3.5 17.4l2-6.2h15.2l-2 6.2a1.7 1.7 0 0 1-1.6 1.2H5.1a1.7 1.7 0 0 1-1.6-1.2Z" />
    </svg>
  )
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.4 3.9h9.2l4.5 4.5v10.2a1.7 1.7 0 0 1-1.7 1.7H5.4a1.7 1.7 0 0 1-1.7-1.7V5.6a1.7 1.7 0 0 1 1.7-1.7Z" />
      <path d="M7.7 3.9v4.3h6.6V3.9" />
      <path d="M7.7 19.6v-5.1h8.6v5.1" />
    </svg>
  )
}

function SaveAsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.4 3.9h9.2l4.5 4.5v10.2a1.7 1.7 0 0 1-1.7 1.7H5.4a1.7 1.7 0 0 1-1.7-1.7V5.6a1.7 1.7 0 0 1 1.7-1.7Z" />
      <path d="M7.7 3.9v4.3h6.6V3.9" />
      <path d="M12 12.4v5M9.5 14.9h5" />
    </svg>
  )
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 19.5h16" />
    </svg>
  )
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15.5v-11" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 19.5h16" />
    </svg>
  )
}

function ExportEdlIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 6.5h10.5M3.5 11h10.5M3.5 15.5h10.5" />
      <path d="M18 9.6v7.6" />
      <path d="M15.6 14.8l2.4 2.4 2.4-2.4" />
    </svg>
  )
}

function NewIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5.2" y="3.5" width="13.6" height="17" rx="1.8" />
      <path d="M12 9v6M9 12h6" />
    </svg>
  )
}

// The drop-down's trigger: three dots for "more of these" plus a chevron, the
// two halves of the one glyph in this row that opens a menu instead of doing
// something. Deliberately NOT one of the four icons it now hides — borrowing
// Export's arrow to stand for a group containing Import as well would be a lie
// about what the button does.
function MoreMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="9" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="9" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="9" r="1.15" fill="currentColor" stroke="none" />
      <path d="M8.5 14.5 12 18l3.5-3.5" />
    </svg>
  )
}

function AppInner() {
  const [inputFiles, setInputFiles] = useState([])
  const [outputFiles, setOutputFiles] = useState([])
  // Sticky V1/V2 track tags per source file (persisted in localStorage) —
  // stamped the first time a file is placed on a track, drives the Media
  // Bin's V1/V2 filter. See fileList.tagTrack / filterByTrack.
  const [trackTags, setTrackTags] = useState(() => loadTrackTags())
  // Which clip-colour palette the tracks draw with (⋯ menu → Theme). Held here
  // rather than inside Timeline because it is a persisted preference, and Timeline
  // is remounted by enough of this file's state changes that it would be a poor
  // owner. `|| DEFAULT_CLIP_THEME` covers the never-chosen case; an unrecognised
  // stored name is handled downstream by clipMath.clipPalette, so a value that got
  // hand-edited in devtools still paints.
  const [clipTheme, setClipTheme] = useState(() => loadClipTheme() || DEFAULT_CLIP_THEME)
  function chooseClipTheme(name) {
    setClipTheme(name)
    saveClipTheme(name)
  }
  // All three tracks share ONE undo history (see useUndoableTracks): Undo and
  // Cmd/Ctrl+Z step back the last edit on any lane — a V1 trim, a V2 Analyze,
  // an A1 clip removal, an ANIM keyframe — rather than only V1's. The slices are
  // destructured back into the names the rest of the file already uses, so every
  // call site keeps the plain `setX(prev => …)` shape it had as useState.
  const {
    tracks: { v1: timelineClips, v2: track2Clips, a1: audioBeds },
    setters: { v1: setTimelineClips, v2: setTrack2Clips, a1: setAudioBeds },
    undo: undoEdit,
    reset: resetTracks,
    canUndo,
  } = useUndoableTracks({ v1: [], v2: [], a1: [] })
  const [selectedId, setSelectedId] = useState(null)
  // Which part of the selected clip is selected: the clip body itself
  // ('main') or one of its frozen-frame extensions ('head'|'tail'|'round').
  // Hold segments are selectable/deletable on their own, without deleting
  // the clip they extend.
  const [selectedPart, setSelectedPart] = useState('main')
  // V2's own selection — kept separate from V1's rather than reused, since
  // V1 and V2 clips can be selected independently while both are visible
  // (e.g. comparing a specific V1 cut against its V2 counterpart).
  const [selectedId2, setSelectedId2] = useState(null)
  const [selectedPart2, setSelectedPart2] = useState('main')
  // Which lane the toolbar (Trim/Hold/Reverse/Speed/Crop/Duplicate/Splice/
  // Raise) and Delete/Backspace act on — set whenever a clip or a lane's
  // own gutter label is clicked. Lifted up from Timeline.jsx (rather than
  // kept local there) specifically so this toolbar row, which lives here
  // in App.jsx, can redirect to whichever track is focused.
  const [focusedTrack, setFocusedTrack] = useState(1)
  // Per-track eye toggles, also lifted from Timeline.jsx: they decide what
  // the shared preview decodes, and with V2-as-overlay they additionally
  // gate the composited PiP layer on the preview stage below.
  const [v1Visible, setV1Visible] = useState(true)
  const [v2Visible, setV2Visible] = useState(true)
  const toggleV1Visible = useCallback(() => setV1Visible(v => !v), [])
  const toggleV2Visible = useCallback(() => setV2Visible(v => !v), [])
  // V2 Compare (0.72.0): draw V2 OVER V1 at half opacity instead of in place of
  // it. A view state like the two eyes above — session-only, outside undo and
  // outside the .nara, because it changes nothing about the edit or the render.
  const [compareEnabled, setCompareEnabled] = useState(false)
  const toggleCompare = useCallback(() => setCompareEnabled(v => !v), [])

  // A1 — the "smart" audio track: an ordered lane of audio clips locked under
  // the whole V1 sequence (the `a1` slice above). Sequential like V1 (each clip
  // starts where the previous one ends), but still NOT part of focusedTrack/
  // activeClips: no clip on it owns editable timing (the lane starts at V1's
  // picture start and the render pads or cuts the whole run to V1's length), so
  // there is nothing for Trim, Hold, Reverse, Speed or Round Up to act on. A1
  // has its own selection instead (selectedBedIndex below), read by Split and by
  // the Move ◀ ▶ buttons — the two tools that mean something on an audio clip.
  // Deliberately not a third focusedTrack value: those two read the bed selection
  // directly, and the rest of the toolbar simply goes empty-handed, which is
  // cheaper than teaching every control a third track. Order IS the lane,
  // so this is an array and the render sends it in order. Undoable like the
  // other two — add and remove are the only edits it has, and both are as
  // destructive as any V1 edit.
  // Shape: [{ name, dir, durationSec, startSec, inSec?, outSec? }].
  // `startSec` (version 6) is what makes the lane's positions EXPLICIT: removing
  // a clip leaves the survivors exactly where they were, and the hole renders as
  // silence — or as noise when that toggle is on. It is LANE seconds, 0 being
  // V1's picture start excluding V1's head hold, so it is immune to head-hold
  // edits. clipMath.normalizeBeds back-fills it for older projects.
  // `inSec`/`outSec` (version 7) are which part of its FILE a clip plays, absent
  // meaning all of it: a split clip is the same file twice with adjoining ranges,
  // so nothing about an unsplit lane — or a project saved before Split existed —
  // changes. See clipMath.splitBed / bedPlayedSec.
  // Eye = show the bar on the timeline. It does not affect the render — the
  // bed is either loaded or it isn't. a1Muted silences the bed in the PREVIEW
  // only; it has no UI control (the gutter is just A1 + the eye), so it stays
  // false unless something sets it — kept because the player and the bar both
  // already honor it, and a mute control can return without re-plumbing.
  const [a1Visible, setA1Visible] = useState(true)
  const [a1Muted] = useState(false)
  const toggleA1Visible = useCallback(() => setA1Visible(v => !v), [])
  // Which A1 clip Split cuts and Move ◀ ▶ move. An INDEX, not an id: A1 clips
  // have no id (the same file can legitimately sit on the lane twice, so identity
  // is position — which is also why onRemove takes an index). Nothing acts on the
  // index without first checking that a clip is actually there: Split goes through
  // `selectedBed` below, and MoveClipButtons tests `beds[selectedBedIndex]`. So an
  // index left pointing past the end of a shorter lane (an undo, a project load)
  // degrades to "nothing selected" instead of to the wrong clip.
  const [selectedBedIndex, setSelectedBedIndex] = useState(null)
  const selectedBed = selectedBedIndex == null ? null : (audioBeds[selectedBedIndex] || null)
  // The A1 lane's live playhead, in LANE seconds. A function put here by
  // Timeline.jsx, which owns the transport: Split needs the playhead at the
  // moment it is pressed, and lifting the ~15Hz position into this component's
  // state would re-render the whole app during playback — the very thing that
  // got the old playhead readout removed from this toolbar (see SpliceButton).
  const laneClockRef = useRef(null)
  // The other direction, same reason: a seek function put here by Timeline.jsx, so
  // this toolbar's Move buttons can send the playhead to the clip they just moved.
  // It takes TIMELINE seconds — laneClockRef hands out A1 LANE seconds, which is a
  // different origin, so the two are not interchangeable.
  const timelineSeekRef = useRef(null)

  // Picking a video clip drops the A1 selection, so Split always cuts the clip
  // the user touched LAST — the one rule that keeps one button over two tracks
  // unambiguous. Only for a real pick: `id == null` is a deselect (and playback's
  // follow-the-playhead selection goes through setSelectedId directly, not here),
  // neither of which should quietly un-select the audio clip the user chose.
  const selectItem = useCallback((id, part = 'main') => {
    setSelectedId(id)
    setSelectedPart(id == null ? 'main' : part)
    if (id != null) setSelectedBedIndex(null)
  }, [])
  const selectItem2 = useCallback((id, part = 'main') => {
    setSelectedId2(id)
    setSelectedPart2(id == null ? 'main' : part)
    if (id != null) setSelectedBedIndex(null)
  }, [])
  // And the other direction, so exactly ONE clip is ever ringed: picking an audio
  // clip drops the video selection. It used to leave it, which put two rings on
  // the timeline at once and no way to tell which one the toolbar meant — bad
  // enough with Split, worse now that Move ◀ ▶ follows the audio clip too. The
  // ring is the promise about what the toolbar acts on, so the tools that don't
  // understand A1 (Trim, Hold, Reverse, Speed, Round Up, Duplicate, Crop, Raise)
  // read "select a clip" rather than quietly acting on a clip with no ring. Same
  // for Delete/Backspace, which acts on the focused V1/V2 clip and so now does
  // nothing while an audio clip is selected — removal there is still the × on the
  // bar. Click the video clip again and the whole toolbar is back on it.
  const selectBed = useCallback(index => {
    setSelectedBedIndex(index)
    if (index == null) return
    setSelectedId(null)
    setSelectedPart('main')
    setSelectedId2(null)
    setSelectedPart2('main')
  }, [])
  const [rendering, setRendering] = useState(false)
  const [showRenderDialog, setShowRenderDialog] = useState(false)
  // A1 Noise (the Speed row's "A1 Noise" toggle — `noiseEnabled` and the
  // `fillNoise`/`noise_*` wire names are the older spelling of the same thing):
  // when on, the server measures which stretches of the rendered sequence carry
  // no sound — a hold, a round-up, a slow-down, a source with no audio stream,
  // the tail past the end of a short A1 track — and fills exactly those from the
  // checked-in asset. It never plays over audio that is already there: clip
  // audio and the bed come out bit-identical at their own level, and no length
  // and no video frame changes either way (all three verified by subtraction).
  // A render-wide switch, not a per-clip decision — it never marks a clip dirty.
  // Render-time only: the preview does not emulate it. Both the switch and the
  // level below are saved in the .nara (version 6), since a project's noise
  // is part of how it is meant to sound.
  const [noiseEnabled, setNoiseEnabled] = useState(false)
  const toggleNoise = useCallback(() => setNoiseEnabled(v => !v), [])
  // How loud the tone is, in dB of gain on the asset. Held as the field's RAW
  // TEXT, not a number, so a half-typed "-" or a momentarily empty box doesn't
  // snap back under the cursor; clamped to a number exactly once, at payload
  // time, by clampNoiseGainDb. Deliberately not part of useUndoableTracks: it is
  // a render setting rather than a lane snapshot, and spending an undo step per
  // ▲ click would bury whatever real edit the user actually wants back.
  const [noiseGainDb, setNoiseGainDb] = useState(String(NOISE_GAIN_DB_DEFAULT))
  const noiseSettings = useCallback(() => ({
    noiseGainDb: clampNoiseGainDb(
      noiseGainDb, NOISE_GAIN_DB_DEFAULT, NOISE_GAIN_DB_MIN, NOISE_GAIN_DB_MAX),
  }), [noiseGainDb])
  // Shared timecode/frames display mode — lifted here (rather than local to
  // TransportBar) so Trim and Splice, which live as separate sibling
  // components, can format/parse positions the same way the transport clock
  // does when the user toggles it.
  const [timeDisplayMode, setTimeDisplayMode] = useState('timecode')
  const toggleTimeDisplayMode = useCallback(() => {
    setTimeDisplayMode(m => m === 'timecode' ? 'frames' : 'timecode')
  }, [])
  // Timeline, the Agentic Assistant Editor, Reformat, and the Actions log
  // share one dock at the bottom of the center column — only one is visible at
  // a time, picked by the top bar's pane menu (the name is still `centerTab`:
  // it is the dock's own state, and the menu is only the control that sets it).
  const [centerTab, setCenterTab] = useState('timeline')
  // The row above the dock is a SLOT: Timeline.jsx portals its action bar
  // (transport clock, Undo/V2 Reconstruct/V2 Analyzer, the render buttons) into it,
  // while this file's clip edit tools render inside the Timeline card instead
  // — the two bars trade places. State, not a ref, because the portal target
  // has to be a rendered element Timeline can be re-rendered with.
  const [timelineBarSlot, setTimelineBarSlot] = useState(null)
  // "Animate" mode: reveals the ANIM lane under V1 with +/− keyframe
  // buttons, and drives the CropOverlay's on-preview position from the
  // active clip's cropKeyframes (interpolated at the playhead) instead of
  // its static crop.x/y. Off by default — keyframes stay on the clip when
  // toggled off, they just aren't shown or used for the preview.
  const [animateEnabled, setAnimateEnabled] = useState(false)
  const [freeEnabled, setFreeEnabled] = useState(false)
  const [rightPanelWidth, setRightPanelWidth] = useState(() => window.innerWidth * DEFAULT_PANEL_FRACTION)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => window.innerWidth * DEFAULT_PANEL_FRACTION)
  const resizingRef = useRef(null)
  // Which divider is being dragged, for its own styling only ('left'|'right'|null).
  const [resizingSide, setResizingSide] = useState(null)
  const previewStageRef = useRef(null)
  const importInputRef = useRef(null)
  // The top bar's ⋯ drop-down (Export / Import / Export EDL / FFmpeg Custom
  // Settings). `null` = closed; otherwise the viewport point ContextMenu opens
  // at, taken off the trigger's own rect. Held as state rather than a boolean so
  // ContextMenu's existing {x, y} contract is reused unchanged; the ref is what
  // lets it tell "clicked the trigger again" from "clicked away".
  const [projectMenuAt, setProjectMenuAt] = useState(null)
  const projectMenuBtnRef = useRef(null)
  // The Timeline/AGENT/Actions dock's own wrapper (a single, stable DOM
  // node — only its children swap on tab change, per centerTab). Its
  // rendered height while showing Timeline becomes the fixed height
  // applied to it while showing AGENT/Actions, so toggling tabs never
  // changes the dock's height — Timeline's own natural content height is
  // the source of truth, not whatever ChatPanel/LogPanel would stretch to.
  const centerDockRef = useRef(null)
  const [centerDockHeight, setCenterDockHeight] = useState(null)
  const { binSelection } = useMedia()
  const { active: tourActive, start: startTour, stepIndex: tourStepIndex, steps: tourSteps } = useTour()

  // Timeline/AGENT/Actions are now mutually-exclusive tabs in one dock, so
  // the guided tour must switch to whichever tab its current step targets
  // before TourOverlay tries to spotlight it. Adjusted directly during
  // render (React's documented pattern for state derived from another
  // value) rather than in a useEffect, so the DOM already reflects the
  // right tab by the time TourOverlay's own effect measures it — a
  // separate effect here would race TourOverlay's and could measure the
  // previous tab's (wrong or absent) element for one frame.
  // Measure the dock's own rendered height only while Timeline is the
  // active tab — that's the "desired height" AGENT/Actions should be
  // pinned to instead of stretching taller. A ResizeObserver (not a
  // one-shot measurement) keeps this current if Timeline's own content
  // changes height while it's showing (clips added, holds appearing/
  // disappearing, etc.); it stops observing the moment the tab switches
  // away, so it never measures AGENT/Actions' own (different) height.
  useEffect(() => {
    const el = centerDockRef.current
    if (!el || centerTab !== 'timeline') return
    const measure = () => setCenterDockHeight(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [centerTab])

  if (tourActive) {
    const stepId = tourSteps[tourStepIndex]?.id
    if (stepId === 'agentDock' && centerTab === 'timeline') setCenterTab('assistant')
    // 'editToolbar' joins 'timeline' here because the edit tools now render
    // INSIDE the Timeline card, so that step's target is tab-gated too — and
    // 'renderBar' for the mirror-image reason: its slot element always exists,
    // but Timeline only portals the bar into it while the Timeline tab is up,
    // so on any other tab that step would spotlight an empty strip.
    else if ((stepId === 'timeline' || stepId === 'editToolbar' || stepId === 'renderBar') && centerTab !== 'timeline') setCenterTab('timeline')
  }

  // Track 2 ("Analyze") is the `v2` slice above. It was deliberately left OUT
  // of the undo history for a while, on the reasoning that it's a scratch lane
  // rebuilt from a rule (drop a file, let Analyze cut it to match V1) rather
  // than hand-edited step by step. That reasoning was wrong in practice: the
  // same toolbar edits V2 that edits V1 (Trim/Hold/Reverse/Speed/Crop/Duplicate/
  // Splice/Raise), Analyze/Reconstruct/Batch REPLACE the whole lane in one
  // click, and "rebuildable in principle" is no comfort after a mis-click. It
  // shares V1's history now.

  const selectedClip = timelineClips.find(c => c.id === selectedId) || null
  const selectedClip2 = track2Clips.find(c => c.id === selectedId2) || null
  const hasDirty = timelineClips.some(c => c.dirty)

  // The shared toolbar row always acts on whichever track is currently
  // focused — clicking a V1 clip focuses V1, clicking a V2 clip focuses
  // V2, and the same Trim/Hold/Reverse/Speed/Crop/Duplicate/Splice/Raise
  // controls redirect to that track's own clips/setter/selection without
  // any change to those components themselves.
  const activeClips = focusedTrack === 2 ? track2Clips : timelineClips
  const setActiveClips = focusedTrack === 2 ? setTrack2Clips : setTimelineClips
  const activeSelectedClip = focusedTrack === 2 ? selectedClip2 : selectedClip
  const setActiveSelectedId = focusedTrack === 2 ? setSelectedId2 : setSelectedId

  // Free and Animate are one app-wide toggle each, not per-clip state, so
  // selecting a FIT-cropped clip while either was already on would leave a
  // button lit and a handle drawn for a box that covers the whole frame and
  // cannot move (see cropMath.cropForPreset). Gating the value here rather
  // than resetting the state means the user's toggle comes back untouched the
  // moment they select a normally-cropped clip again — turning it off for them
  // would be a side effect they never asked for and can't see the cause of.
  const cropIsFit = isFitCrop(activeSelectedClip?.crop)
  const cropAnimateOn = animateEnabled && !cropIsFit
  const cropFreeOn = freeEnabled && !cropIsFit

  // ---------- Merge selection ----------
  // Merge is the one tool that needs MORE than one clip, and the rest of the app
  // is built on one selection per track (see selectedId/selectedId2). Rather than
  // widen that everywhere, Shift-click keeps a side list of EXTRA picks here; the
  // ordinary selection is still the primary one and everything else reads it
  // unchanged, so no other tool notices.
  //
  // The track is stored WITH the ids instead of clearing on focusedTrack change:
  // shift-clicking a V2 clip while V1 is focused both moves the focus and makes a
  // pick, and an effect watching focusedTrack would run after that render and wipe
  // the pick the click just made. Picks for the unfocused track are simply ignored.
  const [mergePicks, setMergePicks] = useState({ track: 1, ids: [] })
  const clearMergePicks = useCallback(() => {
    setMergePicks(prev => (prev.ids.length ? { track: prev.track, ids: [] } : prev))
  }, [])
  // `additive` is the Shift key. A plain click clears — picking up a new clip
  // normally is how you abandon a half-made merge, and leaving stale outlines
  // behind would make the button act on clips the user thinks they deselected.
  const pickForMerge = useCallback((id, additive, track) => {
    setMergePicks(prev => {
      if (!additive) return prev.ids.length ? { track, ids: [] } : prev
      if (prev.track !== track) return { track, ids: [id] }
      return prev.ids.includes(id)
        ? { track, ids: prev.ids.filter(p => p !== id) }
        : { track, ids: [...prev.ids, id] }
    })
  }, [])
  // What Merge acts on: the primary selection first, then the extra picks that are
  // still on this track. Filtered against the lane rather than pruned on every
  // edit, so a delete or an undo can't leave the button pointing at a ghost.
  const activeMergeIds = useMemo(() => {
    if (!activeSelectedClip) return []
    const present = new Set(activeClips.map(c => c.id))
    const extras = mergePicks.track === focusedTrack
      ? mergePicks.ids.filter(id => id !== activeSelectedClip.id && present.has(id))
      : []
    return [activeSelectedClip.id, ...extras]
  }, [activeClips, activeSelectedClip, mergePicks, focusedTrack])
  // Which ids draw the co-selected outline, for whichever lane is asking. The
  // primary selection already has its own ring, so it is left out.
  const mergeMarkIds = useMemo(
    () => new Set(activeMergeIds.slice(1)),
    [activeMergeIds],
  )

  // ---------- V1 footage-loss warning ----------
  // A V1 trim or delete drops source footage from the sequence, and V2's
  // Reconstruct can only rebuild what a V1 render CONTAINS — so those frames are
  // gone for good. Warn once, at the moment it happens, while Cmd+Z is still an
  // easy way back. Payload for the dialog; null when it's closed.
  const [footageLoss, setFootageLoss] = useState(null)
  // Refs, not state, on purpose: an edge drag calls the reporter on every
  // pointermove, and none of this bookkeeping should cost a re-render.
  //   shownThisSessionRef — the "once per session" half. Resets on reload, so a
  //     new session warns again even without the persisted pref.
  //   hideForeverRef      — the "don't show again" pref, read from localStorage
  //     once rather than on every pointermove.
  //   pendingLossRef      — the current gesture's running total.
  const shownThisSessionRef = useRef(false)
  const hideForeverRef = useRef(loadHideFootageLossWarning())
  const pendingLossRef = useRef(null)

  // `deltaSec` is SIGNED source seconds (see clipMath.trimLossSec): positive
  // dropped footage, negative brought it back. Summing the signed deltas across
  // one gesture is what makes a drag pulled inward and then back out past its
  // start silent — no snapshot of the pre-drag window is needed.
  //
  // TIMING: TimelineClip's edge drag fires onTrim on every pointermove and has
  // no commit-on-release callback, so showing the dialog straight from the first
  // narrowing move would drop a modal into the middle of the user's drag. With a
  // `gesture` token we therefore accumulate and settle up on the pointerup that
  // ends that drag. Without one (× button, EDL row, Delete key, TrimForm Apply)
  // there is no gesture to wait out, so it fires immediately.
  const handleFootageLoss = useCallback(({ deltaSec, gesture, sourceName }) => {
    if (shownThisSessionRef.current || hideForeverRef.current) return
    if (!Number.isFinite(deltaSec)) return

    function settle() {
      const p = pendingLossRef.current
      pendingLossRef.current = null
      if (!p || p.sumSec <= MIN_LOSS_SEC) return
      // Latch before showing: the settling pointerup and a queued render can
      // otherwise both get here and stack two identical dialogs.
      shownThisSessionRef.current = true
      setFootageLoss({ lostSec: p.sumSec, sourceName: p.sourceName })
    }

    const p = pendingLossRef.current
    if (gesture != null && p && p.gesture === gesture) {
      p.sumSec += deltaSec
      return  // listener from the first report of this gesture is still armed
    }
    pendingLossRef.current = { gesture: gesture ?? null, sumSec: deltaSec, sourceName }
    if (gesture == null) {
      settle()
      return
    }
    document.addEventListener('pointerup', settle, { once: true })
  }, [])

  function handleFootageLossClose(dontShowAgain) {
    if (dontShowAgain) {
      hideForeverRef.current = true
      saveHideFootageLossWarning(true)
    }
    setFootageLoss(null)
  }

  // Persistent notices from Analyze (e.g. V1's cut points running past the
  // end of the file dropped on V2) — kept separate from the derived
  // round-up/dirty warnings below so they survive across renders.
  const [analyzeLog, setAnalyzeLog] = useState([])

  // Playback hit a clip whose media the browser couldn't load, and stopped
  // there. Reported as a log line rather than an alert: it happens while the
  // user watches the preview, not in answer to a click, and a modal thrown up
  // mid-playback would interrupt the very thing they were looking at. The clip
  // is still on the lane and still renders — only the preview can't show it.
  const handlePlaybackSourceError = useCallback((clip) => {
    const name = clip?.displayName || clip?.sourceName || 'that clip'
    setAnalyzeLog(prev => [
      { kind: 'warn', text: `⚠ playback stopped at "${name}" — its source file could not be loaded (moved, renamed or deleted?)` },
      ...prev,
    ])
  }, [])

  // V2-as-overlay detection: a V2 clip whose resolution differs from its
  // positionally-paired V1 clip is treated as a cropped region to composite
  // back on top, at the V1 clip's crop box, following its crop keyframes.
  // Derived (not state) — it depends on the crop/keyframes of V1's clips,
  // which the user can change at any moment, so there's nothing to
  // invalidate. See overlayMatch.js for the matching rules.
  const overlayMatch = matchOverlays(timelineClips, track2Clips)
  const overlays = overlayMatch.overlays
  const hasOverlay = overlays.length > 0

  // V2 Compare's layers. Only built when there is NO composite to reuse: when
  // overlays already resolve, the V2 pictures are on screen in the right places
  // already and compare's whole job is to make those half-opaque (the `opacity`
  // prop below) — stacking a full-frame layer on top of them as well would hide
  // the very region being compared. Derived, like `overlays`, and for the same
  // reason: it depends on both clip lists, which change under the user's hands.
  const compareLayers = (compareEnabled && !hasOverlay)
    ? compareOverlays(timelineClips, track2Clips)
    : []

  // "V2 Render" mode, toggled by the A / A/B switch beside that button:
  //   'A'  → render the V2 track on its own, to its own file (the original
  //          behavior, and the default).
  //   'AB' → composite V2 over V1 and render the two as one clip.
  // In A/B a V2 clip that matches V1's resolution covers the frame entirely,
  // which is exactly what the user is asking for here — so this pass opts
  // into `fullFrameSameSize`, unlike the always-on derivation above (where a
  // same-size V2 is ordinary replacement, not a composite).
  const [v2RenderMode, setV2RenderMode] = useState('A')
  const abMatch = matchOverlays(timelineClips, track2Clips, { fullFrameSameSize: true })
  const abOverlays = abMatch.overlays

  // "V2 Render"'s second axis, the 1 / 1+ switch beside the A / A/B one:
  //   '1'  → one file, the whole track joined into a single clip (the original
  //          behavior, and the default).
  //   '1+' → one file per cut, each shot rendered on its own and numbered in
  //          track order.
  // Orthogonal to v2RenderMode on purpose: that one decides WHAT each shot
  // contains (V2 alone, or V2 over V1), this one decides how many files it
  // lands in, so all four combinations mean something. Session-only, like
  // v2RenderMode — it's a property of the click, not of the edit.
  const [v2ShotMode, setV2ShotMode] = useState('1')
  // { done, total } while a shot-by-shot render is running, null otherwise.
  // A 1+ render is N sequential ffmpeg passes behind one click, so unlike every
  // other render in the app it has an inside to report — the V2 Render button
  // counts the shots off and refuses a second click until they're done.
  const [v2ShotProgress, setV2ShotProgress] = useState(null)

  const logMessages = (() => {
    const msgs = []
    // Round Up rounds the SEQUENCE, so this warns about the sequence. Per-clip
    // it warned about clips whose own rendered length isn't whole — four
    // warnings on a four-clip sequence that renders to an exact 14s, telling the
    // user to "use Raise" on a single clip, which Raise cannot do. And it is
    // gated on the length the sequence renders to RIGHT NOW, round-up hold
    // included: sequenceRaise measures the base with the hold stripped, so it
    // still reports an amount after a successful Round Up and gating on that
    // would leave the warning on screen for a whole render.
    const raiseFps = sequenceTargetFps(timelineClips)
    const renderedSec = sequenceRenderFrames(timelineClips, raiseFps) / raiseFps
    if (timelineClips.length > 0 && roundUpAmount(renderedSec) > 0) {
      const raise = sequenceRaise(timelineClips)
      msgs.push({ kind: 'warn', text: `⚠ Sequence renders to ${renderedSec.toFixed(2)}s — not a whole second${raise.amountSec > 0 ? `. Round Up adds ${raise.amountSec.toFixed(2)}s to reach ${raise.exact ? '' : '≈'}${raise.wholeSec.toFixed(0)}s` : ''}` })
    }
    // Overlay near-misses (a size that doesn't match the crop box, a missing
    // crop box) are surfaced here rather than as an alert: they're derived
    // continuously, so an alert would fire on every keystroke of a resize.
    for (const text of overlayMatch.warnings) {
      msgs.push({ kind: 'warn', text: `⚠ ${text}` })
    }
    if (hasOverlay) {
      msgs.push({
        kind: 'info',
        text: `▣ ${overlays.length} V2 ${overlays.length === 1 ? 'clip is' : 'clips are'} composited over V1 `
          + `(${overlays.map(o => `${o.w}×${o.h}`).join(', ')}) — set the V2 toggle to A/B and click V2 Render to burn ${overlays.length === 1 ? 'it' : 'them'} in`,
      })
    }
    // Compare is invisible in three situations that all look like a dead
    // button — empty V2, V2's eye off, and no V1 clip to pair with — so the
    // toggle says what it is doing rather than leaving the user to guess which
    // one they are in. Every branch repeats "preview only": the button sits in a
    // row of render-affecting toggles, so that is the thing worth over-saying.
    if (compareEnabled) {
      const pairs = compareLayers.length
      // Coverage, not the layer count: since pairing went timeline-based (0.74.0)
      // the number of layers is an implementation detail — one long V2 file over
      // five V1 cuts is five layers and reads as "5 clips", which is wrong twice.
      // What the user is actually asking is how much of the timeline is being
      // compared, so say that, and say it as a SHORTFALL when there is one. A
      // gap under Compare looks exactly like Compare being off.
      const coveredSec = compareCoverageSec(compareLayers)
      const v1Sec = timelineClips.reduce((s, c) => s + clipTotalSec(c), 0)
      const shortSec = v1Sec - coveredSec
      msgs.push({
        kind: 'info',
        text: !v2Visible
          ? '◫ V2 Compare is on, but V2’s eye is off — turn it back on to see the layer'
          : hasOverlay
            ? `◫ V2 Compare — the ${overlays.length} composited V2 ${overlays.length === 1 ? 'region is' : 'regions are'} at 50% so V1 reads through. Preview only; renders are unchanged`
            : pairs > 0
              ? `◫ V2 Compare — V2 over V1 at 50% for ${coveredSec.toFixed(2)}s of V1’s ${v1Sec.toFixed(2)}s`
                + (shortSec > 0.05 ? `; the other ${shortSec.toFixed(2)}s has no V2 under the playhead and shows V1 alone` : ' — the whole timeline')
                + '. Preview only; renders are unchanged'
              : '◫ V2 Compare is on, but there is no V2 clip overlapping V1 on the timeline to lay over it',
      })
    }
    if (hasDirty) {
      msgs.push({ kind: 'info', text: '● Unrendered edits — click V1 Render to apply' })
    }
    return [...analyzeLog, ...msgs]
  })()

  // No .catch here on purpose. With the backend down these two rejections carry
  // the same message, so main.jsx's global handler reports them as one alert —
  // which is what fixes the misleading part of this surface: an empty bin is a
  // normal state, so "no files" was indistinguishable from "no server". Catching
  // them here would mark them handled and suppress that alert; whatever the bin
  // was already showing stays on screen either way.
  const refresh = useCallback(() => {
    listFiles().then(setInputFiles)
    listOutputs().then(setOutputFiles)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  function handleUpload() { refresh() }

  // Freshest V1 clip list, for routing decisions taken ACROSS an await — the
  // same "latest value" ref pattern as saveRef further down. handleAddToV1
  // uploads and appends one file at a time, so from the second file onward the
  // enclosing closure's `timelineClips` is a render behind; reading it would
  // make the audio gate below bounce a music file that the video dropped
  // alongside it has already given V1 a length for.
  const timelineClipsRef = useRef(timelineClips)
  timelineClipsRef.current = timelineClips

  async function handleAddToTimeline(name) {
    // An audio file has no video stream, so it can never be a V1 clip — it
    // routes to A1 as the bed instead. Gated on V1 already having a clip: the
    // bed's length is DERIVED from the V1 sequence on every render (padded or
    // cut to it), so a bed with no V1 has no length to take and nothing to
    // lock to. Extension-based rather than probe-based on purpose — this is
    // the same decision the bin's own A1 filter and the drop zone's `accept`
    // make, and it avoids a probe round-trip just to reject the file.
    if (isAudioFile(name)) {
      if (timelineClipsRef.current.length === 0) {
        setAnalyzeLog(prev => [
          { kind: 'warn', text: `⚠ "${name}" is audio — add a video to V1 first, then it can run underneath as the A1 bed` },
          ...prev,
        ])
        return
      }
      await addBedByName(name)
      return
    }
    const info = await probe(name, 'input')
    if (info.error) { alert('Could not probe file: ' + info.error); return }
    // Sticky-tag this source as a V1 file for the Media Bin filter.
    setTrackTags(prev => tagTrack(name, 'v1', prev))
    // Trim bounds use the video stream's own duration, not the container's:
    // the container can outlast the last video frame (audio runs longer),
    // and an outSec pointing past the final frame has nothing to hold or
    // seek to.
    const videoDur = info.video_duration || info.duration
    setTimelineClips(prev => [...prev, {
      id: crypto.randomUUID(),
      sourceName: name,
      sourceDir: 'input',
      sourceDurationSec: videoDur,
      sourceWidth: info.width || null,
      sourceHeight: info.height || null,
      fps: info.fps || 30,
      inSec: 0,
      outSec: videoDur,
      headHoldSec: 0,
      tailHoldSec: 0,
      roundHoldSec: 0,
      reversed: false,
      speed: 1,
      crop: null,
      cropKeyframes: [],
      dirty: true,
    }])
  }

  function handleCleared() {
    // Source files were just deleted from disk — undoing back to clips that
    // reference them would break, so this clears the history rather than
    // pushing onto it. All three lanes go, because all three point at the same
    // deleted input/ files: V2's clips by sourceName, A1's by name (A1 used to
    // survive this and keep bars referencing media that no longer existed).
    resetTracks({ v1: [], v2: [], a1: [] })
    setSelectedId(null)
    setSelectedId2(null)
    setSelectedBedIndex(null)
    // Nothing is left to lose, so re-baseline the unsaved-work check. Without
    // this, opening a project afterwards would ask about clips whose media was
    // just deleted from disk.
    savedWorkRef.current = workFingerprint({
      noiseEnabled, noiseGainDb: noiseGainNumber(noiseGainDb),
    })
    refresh()
  }

  // Which files the timeline is currently pointing at, by filename — each bin
  // reads its own set to refuse renaming a file its clips reference (a clip
  // resolves its media by name, so a rename would orphan it). Split by dir
  // because a clip can be re-pointed at an Export Bin file (a chat edit, a
  // Reformat): a same-named file in the other folder isn't the same file.
  function inUseNamesFor(dir) {
    return new Set(
      [...timelineClips, ...track2Clips]
        .filter(c => (c.sourceDir || 'input') === dir)
        .map(c => c.sourceName)
        .concat(audioBeds.filter(b => (b.dir || 'input') === dir).map(b => b.name))
    )
  }
  const inUseSourceNames = inUseNamesFor('input')
  const inUseOutputNames = inUseNamesFor('output')

  // A source file was renamed in the Media Bin. No clip can be pointing at it
  // (rename is blocked while one is), so all this has to do is carry the
  // sticky V1/V2/A1 track tag over to the new name and re-read the list.
  function handleSourceRenamed(oldName, newName) {
    setTrackTags(prev => renameTrackTag(oldName, newName, prev))
    refresh()
  }

  // Called after the Agentic Assistant Editor runs an accepted ffmpeg
  // command. `output` (from /api/execute) names the file that command
  // actually wrote. If a clip is selected, load that result onto it in
  // place — same treatment Reconstruct gives a "fresh" source: the chat
  // edit is now baked into new pixels, so any trim/hold/reverse/speed/crop
  // staged on the OLD source no longer applies and must reset.
  async function handleEditResult(output) {
    refresh()
    if (!output || !selectedClip) return
    const info = await probe(output.name, output.dir)
    if (info.error) return
    const videoDur = info.video_duration || info.duration
    setTimelineClips(prev => prev.map(c => c.id !== selectedClip.id ? c : {
      ...c,
      sourceName: output.name,
      sourceDir: output.dir,
      sourceDurationSec: videoDur,
      sourceWidth: info.width || null,
      sourceHeight: info.height || null,
      fps: info.fps || c.fps,
      inSec: 0,
      outSec: videoDur,
      headHoldSec: 0,
      tailHoldSec: 0,
      roundHoldSec: 0,
      reversed: false,
      speed: 1,
      crop: null,
      cropKeyframes: [],
      dirty: true,
    }))
  }

  // Which clip list a pending render dialog targets: 'v1' (main timeline),
  // 'v2' (the Analyze scratch track), or 'composite' (V1 with V2's cropped
  // regions animated back on top — see overlayMatch.js).
  const [renderTarget, setRenderTarget] = useState('v1')

  function handleRenderClick() {
    if (timelineClips.length === 0) return
    setRenderTarget('v1')
    setShowRenderDialog(true)
  }

  function handleRenderV2Click() {
    if (track2Clips.length === 0) return
    if (v2RenderMode === 'AB') {
      // A/B: V2 over V1 as one clip. Needs V1 clips to composite onto and at
      // least one pair that actually resolves — otherwise say why instead of
      // silently rendering a plain V1.
      if (timelineClips.length === 0) {
        alert('A/B renders V2 over V1, so V1 needs clips too. Add clips to V1, or switch the toggle to A to render V2 on its own.')
        return
      }
      if (abOverlays.length === 0) {
        alert(
          'Nothing to composite in A/B mode:\n\n'
          + (abMatch.warnings.length
            ? abMatch.warnings.join('\n\n')
            : 'no V2 clip pairs with a V1 clip. V2 clips pair with V1 clips by order.')
          + '\n\nSwitch the toggle to A to render V2 on its own.'
        )
        return
      }
      setRenderTarget('composite')
      setShowRenderDialog(true)
      return
    }
    setRenderTarget('v2')
    setShowRenderDialog(true)
  }

  // `overlays` (optional, from overlayMatch.matchOverlays) attaches a V2
  // clip to the V1 clip it composites onto. The V1 clip's own crop is
  // deliberately dropped in that case: the crop box defined WHERE the region
  // came from, and in a composite it becomes the overlay's placement rect
  // (sent as overlay.x/y/w/h + keyframes) rather than a crop of V1 — the
  // whole point is to put the processed region back onto the full frame.
  function clipsToPayload(list, overlays = []) {
    return list.map(c => {
      const ov = overlays.find(o => o.v1Id === c.id) || null
      return {
        input: c.sourceName,
        dir: c.sourceDir || 'input',
        inSec: c.inSec,
        outSec: c.outSec,
        headHoldSec: c.headHoldSec || 0,
        tailHoldSec: c.tailHoldSec || 0,
        roundHoldSec: c.roundHoldSec || 0,
        reversed: !!c.reversed,
        speed: c.speed && c.speed > 0 ? c.speed : 1,
        // A composite drops the crop: the overlay IS the processed region going
        // back onto the full frame, so cropping V1 too would cut the frame the
        // region is being restored into. A FIT is the exception and must
        // survive — its box is the whole frame (nothing is cut) and its real
        // job is the scale-down to the preset, which the graph applies AFTER
        // compositing. Dropping it here would silently render at the source
        // resolution and quietly ignore the preset the user picked.
        crop: ov && !isFitCrop(c.crop) ? null : (c.crop || null),
        cropKeyframes: ov ? [] : (c.cropKeyframes || []),
        overlay: ov ? {
          input: ov.v2Clip.sourceName,
          dir: ov.v2Clip.sourceDir || 'input',
          inSec: ov.v2Clip.inSec,
          outSec: ov.v2Clip.outSec,
          x: ov.x,
          y: ov.y,
          w: ov.w,
          h: ov.h,
          keyframes: ov.keyframes,
        } : null,
      }
    })
  }

  // The A1 lane as the server wants it: which file, where it came from, and where
  // it sits on the lane. One helper rather than an inline .map per route, because
  // V1 Render and A1 Render must describe the SAME lane — a startSec present in
  // one and missing in the other would put a removed clip's hole in a different
  // place in the .wav than in the video, and the two are meant to be
  // sample-for-sample interchangeable.
  //
  // No duration goes out: the server measures each bed's reach from its own audio
  // stream (see ffmpeg_utils.bed_spans), which is the only number noise can
  // safely be kept off.
  //
  // inSec/outSec go out only when the clip actually plays part of its file, so an
  // unsplit lane sends exactly the payload it always did and gets exactly the
  // graph it always did. An absent outSec means "to the end of the audio", which
  // keeps that measurement the server's — a half whose tail is the file's tail
  // must not be capped by a container duration measured here.
  function bedsToPayload(beds) {
    return normalizeBeds(beds).map(b => ({
      input: b.name,
      dir: b.dir,
      startSec: b.startSec || 0,
      ...(bedInSec(b) > 0 ? { inSec: bedInSec(b) } : {}),
      ...(Number.isFinite(b.outSec) ? { outSec: b.outSec } : {}),
    }))
  }

  // V2 Render in 1+ mode: one pass per cut, in track order. The names come from
  // renderNames.shotOutputNames — the same function the dialog previewed the
  // series with, so the names shown are the names written — driven by the
  // dialog's three naming controls in `naming`: V1 name (on by default, each
  // file named after the clip it renders, `<clip>.mp4`), and Prefix/Suffix
  // wrapped around whichever base name is in play. With V1 name off it is the
  // typed name plus an index, `<name>_01`, `_02`…, as it always was.
  //
  // Each pass is the ordinary single-clip render the backend already does, so
  // every per-clip decision — holds, round-up, reverse, speed, crop, its V2
  // overlay — comes out exactly as it does in the joined render. Two things
  // legitimately differ, both because a shot is now its own file rather than a
  // segment of one: the render's target resolution and frame rate come from
  // that one clip instead of the largest and fastest on the track (so a 1080p
  // shot stays 1080p instead of being padded up to a 4K neighbor's frame), and
  // a size-capped quality mode budgets each file separately.
  //
  // Sequential, not concurrent: one pass already uses the whole machine, and
  // the Export Bin should fill in cut order rather than in whatever order N
  // parallel ffmpeg runs happened to finish. A failure stops the series there
  // and says which shot — the shots already written stay, since they're
  // finished files and re-running only appends a fresh series.
  // `settings` is the render-wide knob bag (see api.renderTimeline) — passed in
  // from the caller already clamped, so every shot in the series is rendered
  // with the exact numbers the joined render would have used. Forgetting it here
  // would make a 1+ series quietly stop matching V1 Render.
  //
  // The series runs over GROUPS, not clips (clipMath.fuseGroups): a fused run of
  // V2 Reconstruct ranges is one clip to the user, so it is one file here, posted
  // as a multi-clip payload that the server concatenates exactly as the joined
  // `1`-mode render would. V1 and an unfused V2 lane have no fused runs at all,
  // so every group is a single clip and this behaves precisely as it did.

  // The name each shot of a 1+ series takes, one stem per GROUP in cut order,
  // for the render dialog's **V1 name** box. The FIRST member of a fused run
  // names the whole run, which is the only member the user sees a name for. One
  // function for the dialog's preview and for the render, so the two can't
  // disagree about which clip named which file.
  //
  // The box is called *V1 name* and now means it on both tracks. In A/B the
  // clips passed in ARE V1's, so `displayName || sourceName` is already a V1
  // name. In A they are V2's, whose own name is the round-tripped file plus an
  // `Analyzed01`-style label — nothing the user recognises — so a V2 segment
  // stamped with `v1Id`/`v1Name` by the analyzer (see analyzeMath.v1Provenance)
  // is named after the V1 clip it was cut against instead.
  //
  // Resolution order, most authoritative first:
  //   1. the LIVE V1 clip `v1Id` points at — so renaming or reordering V1 after
  //      the analyze still exports under the current name;
  //   2. `v1Name`, the snapshot taken when the cut was made — for when that clip
  //      is gone (deleted, or a project reopened against a rebuilt V1);
  //   3. the clip's own label, which is the pre-0.59.0 behaviour and the only
  //      thing available for a V2 clip no analyzer produced (a file dragged
  //      straight onto V2).
  function shotStemsFor(clips) {
    const byId = new Map(timelineClips.map(c => [c.id, c]))
    return fuseGroups(clips).map(g => {
      const c = g.clips[0]
      const v1 = c?.v1Id ? byId.get(c.v1Id) : null
      const name = (v1 && (v1.displayName || v1.sourceName))
        || c?.v1Name
        || c?.displayName || c?.sourceName || ''
      return nameStem(name)
    })
  }

  async function renderShots(sourceClips, overlays, baseName, noAudio, noise, settings, naming = {}) {
    const groups = fuseGroups(sourceClips)
    const names = shotOutputNames(baseName, groups.length, {
      stems: naming.useClipNames ? shotStemsFor(sourceClips) : null,
      prefix: naming.prefix,
      suffix: naming.suffix,
    })
    for (let i = 0; i < groups.length; i++) {
      setV2ShotProgress({ done: i, total: groups.length })
      // Holds belong to the SEQUENCE, not to a clip: a head hold opens the
      // sequence and a tail/round hold closes it, which is why both the
      // frontend (sanitizeHoldPlacement) and the server keep them on the first
      // and last clip and ignore them anywhere else. A shot render makes every
      // clip both first and last of its own one-clip timeline, so a stale
      // mid-sequence hold — a Raise on what USED TO BE the last clip, before
      // another was appended — would suddenly render, making that shot longer
      // than the same stretch of the joined render. Apply the sequence's rule
      // to the sequence, not to each shot: the run still opens and closes
      // exactly as it does in one file.
      //
      // "First"/"last" are the SEQUENCE's, not the group's: with a fused run the
      // opening hold belongs to the first member of the first group and the
      // closing one to the last member of the last group, and every other member
      // is hold-free — the same rule the server applies inside one payload.
      const members = groups[i].clips
      const isFirst = i === 0
      const isLast = i === groups.length - 1
      const shotClips = members.map((c, k) => ({
        ...c,
        headHoldSec: isFirst && k === 0 ? (c.headHoldSec || 0) : 0,
        tailHoldSec: isLast && k === members.length - 1 ? (c.tailHoldSec || 0) : 0,
        roundHoldSec: isLast && k === members.length - 1 ? (c.roundHoldSec || 0) : 0,
      }))
      // The whole overlay list goes in; clipsToPayload pairs by clip id (which
      // the copy above keeps), so a shot with no V2 partner renders without one.
      const payload = clipsToPayload(shotClips, overlays)
      const result = await renderTimeline(payload, names[i], noAudio, [], noise, settings)
      if (result.error) {
        alert(
          `Render failed on shot ${i + 1} of ${groups.length}: ` + result.error
          + (result.detail ? '\n' + result.detail : '')
          + (i > 0 ? `\n\nThe ${i} shot${i === 1 ? '' : 's'} before it were written.` : '')
        )
        return false
      }
      // Logged and refreshed per shot rather than once at the end: a long
      // series should show up as it lands, which is also the only place the
      // final names (after any server-side de-duplication) are reported.
      setAnalyzeLog(prev => [
        { kind: 'info', text: `▣ Shot ${i + 1}/${groups.length} → ${result.output}` },
        ...prev,
      ])
      refresh()
    }
    return true
  }

  // A1 Noise is render-only and the preview can't play it, so the ONE thing
  // that tells the user it did anything is the server's own measurement of how
  // much silence it found. Reporting zero is the point: "nothing to fill" and
  // "the toggle is broken" sounded identical before this line existed, and the
  // first version of the feature was in fact broken in exactly that way.
  function logNoiseFill(result, label) {
    if (result?.noise_fill_sec == null) return
    const fill = result.noise_fill_sec
    const seq = result.sequence_sec
    // The level comes from the SERVER's echo, not from local state: what the log
    // reports is then the level that actually reached the filtergraph, so a
    // clamp or a stale field shows up here instead of being papered over.
    const gain = result.noise_gain_db
    const at = gain == null ? '' : ` at ${gain > 0 ? '+' : ''}${gain} dB`
    setAnalyzeLog(prev => [
      fill > 0
        ? { kind: 'info', text: `♪ ${label}: noise filled ${fill.toFixed(2)}s of silence in a ${seq.toFixed(2)}s sequence${at}` }
        : { kind: 'warn', text: `♪ ${label}: noise found no silence to fill — all ${seq.toFixed(2)}s already carries audio, so the render is unchanged` },
      ...prev,
    ])
  }

  // `naming` is the render dialog's series-naming block — `{useClipNames,
  // prefix, suffix}`, only ever acted on by the 1+ path below, since a
  // single-file render's whole name was typed into the field.
  async function handleRenderConfirm(outputName, noAudio = false, naming = {}) {
    setShowRenderDialog(false)
    setRendering(true)
    try {
      const isV2 = renderTarget === 'v2'
      const isComposite = renderTarget === 'composite'
      const sourceClips = isV2 ? track2Clips : timelineClips
      // Only a composite render attaches overlays; a plain V1 render still
      // renders V1 exactly as before (crop and all), so both are reachable.
      // A composite always comes from the A/B toggle, so it uses the
      // full-frame-aware match (abOverlays), not the always-on one.
      const overlays = isComposite ? abOverlays : []
      // A1 is locked to V1, so it only rides along on renders that CONTAIN the
      // V1 sequence: a plain V1 render and an A/B composite. V2 Render in mode
      // A renders the V2 track by itself, where a V1-length lane has no
      // meaning. noAudio also excludes it — the backend rejects that
      // combination outright, so don't send it. Order is the lane order.
      const beds = (isV2 || noAudio) ? [] : bedsToPayload(audioBeds)
      // Unlike the bed, noise fill is NOT V1-only: a V2 render has its own
      // holds and slow-downs, and their gaps deserve the same treatment. It is
      // suppressed only by noAudio, where there is no audio graph to fill (the
      // backend rejects that combination outright).
      const noise = !noAudio && noiseEnabled
      // Clamped ONCE per render, here, and handed to both paths below, so a 1+
      // series and a joined render can't disagree about the level.
      const settings = noiseSettings()
      // The 1 / 1+ switch belongs to the V2 group, so only its two targets read
      // it — V1 Render always writes one file, as it always has.
      if ((isV2 || isComposite) && v2ShotMode === '1+') {
        // A1 is defined against the WHOLE V1 sequence: one delay past the head
        // hold, one length, one run of clips. A single shot has none of that, so
        // laying the lane under each one would restart it at every cut — which
        // is not what the lane says. Shot renders leave it out, and say so when
        // there was something to leave out.
        if (beds.length > 0) {
          setAnalyzeLog(prev => [
            { kind: 'info', text: `▣ A1 is not included in a 1+ render — the lane is timed to the whole V1 sequence, not to a single shot. Use A1 Render for it.` },
            ...prev,
          ])
        }
        const ok = await renderShots(sourceClips, overlays, outputName, noAudio, noise, settings, naming)
        // Clean only when the whole series landed: a stopped series left some
        // of the track unrendered, and the dot is what says so. `silent` —
        // clearing dirty dots is bookkeeping the user didn't do, so it must not
        // consume the undo step their last real edit is waiting on.
        if (ok) {
          if (isV2) setTrack2Clips(prev => prev.map(c => ({ ...c, dirty: false })), { silent: true })
          else setTimelineClips(prev => prev.map(c => ({ ...c, dirty: false })), { silent: true })
        }
        return
      }
      const payload = clipsToPayload(sourceClips, overlays)
      const result = await renderTimeline(payload, outputName, noAudio, beds, noise, settings)
      if (result.error) { alert('Render failed: ' + result.error + (result.detail ? '\n' + result.detail : '')); return }
      logNoiseFill(result, isV2 ? 'V2' : isComposite ? 'A/B' : 'V1')
      // silent for the same reason as the 1+ path above.
      if (!isV2) {
        setTimelineClips(prev => prev.map(c => ({ ...c, dirty: false })), { silent: true })
      } else {
        setTrack2Clips(prev => prev.map(c => ({ ...c, dirty: false })), { silent: true })
      }
      refresh()
    } catch (e) {
      // Was try/finally with no catch: the finally cleared the spinner and the
      // rejection went nowhere, so a render that died — timed out, backend
      // restarted mid-encode — looked exactly like one that had finished, except
      // no file appeared. RenderDialog calls onConfirm without awaiting it, so
      // the rejection cannot be caught there; it has to be caught here.
      alert('Render failed: ' + e.message)
    } finally {
      setRendering(false)
      setV2ShotProgress(null)
    }
  }

  // A1 Render — the audio counterpart to V1 Render: writes the A1 track alone
  // to a .wav, timed to the V1 sequence (head-hold delay, padded/cut to the
  // sequence length, bed gain, and — with A1 Noise on — noise in exactly the
  // stretches the V1 render fills, which is why V1's clips are sent even though
  // none of their audio is rendered: they are what says where the picture's own
  // sound would be, and so where tone must stay out), so it lines up with the V1
  // file in another tool. No render dialog: there is
  // no quality or audio choice to make, so the button just renders. It reads
  // V1's clips because V1's edits are what give the track its length — an A1
  // render is meaningless without them, which is why the button is gated on
  // both a bed (or noise) and a V1 clip.
  async function handleRenderA1() {
    if (timelineClips.length === 0) return
    setRendering(true)
    try {
      const payload = clipsToPayload(timelineClips)
      const beds = bedsToPayload(audioBeds)
      // Named after the FIRST clip on the lane when there's no project name —
      // the one the render starts with, and the only stable choice as more are
      // appended.
      const base = projectName || (audioBeds[0] ? audioBeds[0].name.replace(/\.[^.]+$/, '') : 'render')
      const result = await renderA1(payload, `${base}_A1`, beds, noiseEnabled, noiseSettings())
      if (result.error) {
        alert('A1 Render failed: ' + result.error + (result.detail ? '\n' + result.detail : ''))
        return
      }
      // Nothing else reports where an A1 render landed (it writes no video, so
      // it never shows up as a dirty-clip change), hence a persistent log line.
      setAnalyzeLog(prev => [
        { kind: 'info', text: `♪ A1 rendered → ${result.output}` },
        ...prev,
      ])
      logNoiseFill(result, 'A1')
      refresh()
    } finally {
      setRendering(false)
    }
  }

  function startResize(side) {
    return function (e) {
      e.preventDefault()
      resizingRef.current = side
      // Mirrored into state purely so the divider can show it. The REF stays the
      // authority for the drag itself — onMove reads it on every pointermove, and
      // a state read there would be a stale closure. This costs one render at
      // pointerdown and one at pointerup, not one per move.
      setResizingSide(side)
      document.body.style.cursor = 'col-resize'

      function onMove(ev) {
        if (resizingRef.current === 'right') {
          const fromRight = window.innerWidth - ev.clientX
          setRightPanelWidth(Math.max(MIN_RIGHT_PANEL, Math.min(MAX_RIGHT_PANEL, fromRight)))
        } else if (resizingRef.current === 'left') {
          setLeftPanelWidth(Math.max(MIN_LEFT_PANEL, Math.min(MAX_LEFT_PANEL, ev.clientX)))
        }
      }
      function onUp() {
        resizingRef.current = null
        setResizingSide(null)
        document.body.style.cursor = ''
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    }
  }

  const [projectName, setProjectName] = useState(null)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const savingRef = useRef(false)

  // The FFmpeg Custom Settings window (top-bar gear) owns those settings; App
  // mirrors just two facts from it: the saved presets, because buildProject
  // writes them into the .nara file, and the active quality mode, because the
  // gear lights up while the custom mode is what Render will use. The window
  // reports both back through onSettingsChange, so this never goes stale
  // without a refetch.
  const [showFfmpegSettings, setShowFfmpegSettings] = useState(false)
  const [exportPresets, setExportPresets] = useState([])
  const [exportQuality, setExportQuality] = useState('lossless')

  useEffect(() => {
    getExportSettings().then(data => {
      setExportPresets(data.presets || [])
      setExportQuality(data.quality || 'lossless')
    })
  }, [])

  // This bundle's own version, from Vite's env channel (vite.config feeds it
  // from the repo-root VERSION file) — no fetch, so the header can draw it
  // before the backend has answered anything, and it stays right even with the
  // backend down. The one thing it CANNOT know is whether the server agrees, so
  // that number is fetched once and only ever used to flag a mismatch. Null
  // until it answers, and null forever if it never does.
  const [backendVersion, setBackendVersion] = useState(null)
  useEffect(() => {
    getVersion().then(d => setBackendVersion(d.version || null))
  }, [])
  const versionMismatch = backendVersion != null && backendVersion !== APP_VERSION

  // V1 APPENDS, exactly like A1: a dropped file lands after the last clip and
  // nothing is replaced. That's the opposite of handleAddToV2 below, and the
  // difference is the tracks, not an inconsistency — V2 is a single-slot track
  // (V2 Render collapses it to one file, so a second clip there has no
  // meaning), while V1 is a sequence being built up.
  //
  // "Single-slot" is about CLIPS as the user counts them, which since Reconstruct
  // is not the same as lane entries: a reconstructed clip is several entries
  // sharing a `fuseId`, drawn as one box and rendered as one file. Still one
  // slot. Count with clipMath.fuseGroups wherever the number is shown or used.
  //
  // Routed through handleAddToTimeline rather than duplicating its body so a
  // file dropped on V1 behaves identically to the same file added from the
  // Media Bin's +, including the audio route: dropping music on V1 puts it on
  // A1 instead of refusing it, since the bed is where an audio file can
  // actually go and A1's own lane is right below.
  async function handleAddToV1(file) {
    const result = await upload(file)
    if (result.error) { alert('Upload failed: ' + result.error); return }
    await handleAddToTimeline(result.name)
    refresh()
  }

  async function handleAddToV2(file) {
    const result = await upload(file)
    if (result.error) { alert('Upload failed: ' + result.error); return }
    await addToV2ByName(result.name)
    refresh()
  }

  // Shared tail of both routes onto V2 — a freshly uploaded file (above) and one
  // already sitting in input/ (dragged out of the Media Bin) — split apart for
  // the same reason addBedByName is: the drop from the bin has nothing to upload.
  //
  // V2 REPLACES rather than appends: it's a scratch track that means "this is the
  // clip to reverse/reconstruct against", so there is only ever one thing on it.
  async function addToV2ByName(name) {
    // V2 is a video track with no bed semantics to fall back on — an audio file
    // here has no video stream and would fail the render with a filtergraph
    // error long after the user forgot what they dropped. Extension-based to
    // match the lane's own `accept` list and the V1/A1 route, no probe needed.
    if (isAudioFile(name)) {
      setAnalyzeLog(prev => [
        { kind: 'warn', text: `⚠ "${name}" is audio — V2 takes video only. Drop it on V1 to run it underneath as the A1 bed instead` },
        ...prev,
      ])
      return
    }
    const info = await probe(name, 'input')
    if (info.error) { alert('Could not probe file: ' + info.error); return }
    // Sticky-tag this source as a V2 file for the Media Bin filter.
    setTrackTags(prev => tagTrack(name, 'v2', prev))
    const videoDur = info.video_duration || info.duration
    setTrack2Clips([{
      id: crypto.randomUUID(),
      sourceName: name,
      sourceDir: 'input',
      sourceDurationSec: videoDur,
      sourceWidth: info.width || null,
      sourceHeight: info.height || null,
      fps: info.fps || 30,
      inSec: 0,
      outSec: videoDur,
      headHoldSec: 0,
      tailHoldSec: 0,
      roundHoldSec: 0,
      reversed: false,
      speed: 1,
      crop: null,
      cropKeyframes: [],
      dirty: true,
    }])
    // No refresh() here — nothing changed on disk. The upload route above owns
    // that, and the bin-drop route is adding a file the listing already shows
    // (the new v2 tag comes off trackTags state, not the listing).
  }

  // A1 APPENDS: a new file starts where the last one on the lane ends, exactly
  // as a V1 clip starts where the previous clip ends. Nothing is replaced, so
  // building a bed out of several pieces (a music cue, then a voice-over) is a
  // matter of adding them in order — and the order they're added in is the order
  // they play until one is dragged somewhere else (handleMoveBed below).
  //
  // Shared tail of both routes onto A1: a file already sitting in input/ (the
  // bin's + button) and a freshly uploaded one (the A1 drop zone). Probes for
  // a real audio stream before accepting — the extension can lie, and a clip
  // with no audio stream would fail the render with a filtergraph error long
  // after the user forgot what they dropped.
  async function addBedByName(name) {
    const info = await probe(name, 'input')
    if (info.error) { alert('Could not probe file: ' + info.error); return false }
    if (!info.has_audio) {
      setAnalyzeLog(prev => [
        { kind: 'warn', text: `⚠ "${name}" has no audio stream — nothing to use on A1` },
        ...prev,
      ])
      return false
    }
    setTrackTags(prev => tagTrack(name, 'a1', prev))
    // Positioned INSIDE the updater, not from the `audioBeds` in scope:
    // Timeline.handleA1Files awaits this once per dropped file, so React state
    // still holds the pre-drop lane on the second call and a start computed out
    // here would stack every file on top of the first.
    //
    // The end of the LAST bed, not the sum of the durations: with a hole in the
    // lane those differ, and a new clip belongs after everything already there.
    setAudioBeds(prev => [...prev, {
      name,
      dir: 'input',
      // The container duration, not video_duration: an audio-only file has no
      // video stream, and for a file that does have one it's the audio that
      // matters here. This is what DRAWS the clip and what places the next one;
      // the render measures its own reach from the audio stream instead, so this
      // is read once here rather than re-probed per render.
      durationSec: info.duration,
      startSec: bedLaneEndSec(prev),
    }])
    return true
  }

  async function handleAddToA1(file) {
    const result = await upload(file)
    if (result.error) { alert('Upload failed: ' + result.error); return }
    await addBedByName(result.name)
    refresh()
  }

  // By index, not by name: the same file can legitimately sit on A1 twice (a
  // sting used at the head and again at the tail), so identity is position.
  //
  // Dropping the entry is the WHOLE edit: every surviving bed carries its own
  // startSec, so nothing moves and the render fills the hole it leaves with
  // silence (or noise). Before startSec existed, position was the running sum
  // of the preceding durations, so this same line pulled the rest of the lane
  // earlier.
  function handleRemoveBed(index) {
    setAudioBeds(prev => prev.filter((_, i) => i !== index))
    // Identity is position, so the selection has to follow the shift: without
    // this, removing a clip before the selected one would leave the ring — and
    // Split — on its neighbour instead.
    setSelectedBedIndex(sel => (
      sel == null || sel === index ? null : sel > index ? sel - 1 : sel
    ))
  }

  // The whole lane arrives already moved, because the gesture that produced it
  // needs the lane to decide where a clip can legally land — AudioBedBar runs
  // clipMath.moveBed against the lane as it was when the drag began, so each
  // update is a pure function of the cursor rather than of the update before it.
  // `gesture` folds the drag's stream of updates into one undo step, exactly as
  // an edge-drag trim does.
  //
  // Selection rides along, like V1's applyMove: a clip dragged past a neighbour
  // changes index (moveBed keeps the array sorted by start), and identity on A1
  // is position, so without this the ring — and Split — would be left on
  // whichever clip slid into the old slot. The PLAYHEAD deliberately doesn't
  // follow: on V1 it does because the preview should keep showing the clip being
  // moved, but here it marks where Split will cut, which a move has no opinion
  // about.
  // `gesture` is undefined when the move came from the toolbar's Move ◀ ▶ rather
  // than from a drag: one press is one edit, so it wants its own undo step.
  function handleMoveBed(beds, index, gesture) {
    setAudioBeds(beds, { coalesce: gesture })
    selectBed(index)
  }

  // All three V2 tools below work on `track2Clips[0]` — ONE file, one window.
  // A reconstructed clip is not that: it is N lane entries drawn as a single
  // seamless box (clipMath.fuseGroups), and [0] is only its first range. Letting
  // one through would re-cut that range and leave the others, i.e. break the
  // one-clip illusion in the worst possible way — one box, half of it
  // transformed. Nor can we flatten it first: a clip holds exactly ONE in/out
  // pair, so the ranges become one file only at V2 Render.
  function fusedV2Blocks(tool) {
    const group = fuseGroups(track2Clips)[0]
    if (!group || group.clips.length < 2) return false
    const lead = group.clips[0]
    alert(
      `V2 holds a reconstructed clip made of ${group.clips.length} ranges of `
      + `"${lead.displayName || lead.sourceName}" — ${tool} needs a single continuous file.\n\n`
      + 'Render V2 first (V2 Render, mode 1), which joins the ranges into one file, '
      + 'then drop that file back on V2 and run this again.'
    )
    return true
  }

  function handleAnalyze() {
    if (track2Clips.length === 0) { alert('Drop a file on the V2 track first.'); return }
    if (timelineClips.length === 0) { alert('V1 has no clips to analyze against.'); return }
    if (fusedV2Blocks('V2 Analyzer')) return
    const v2Source = track2Clips[0]
    const { segments, overflow } = analyzeAgainstV1(timelineClips, v2Source)
    if (segments.length === 0) {
      alert('Nothing to cut — none of V1\'s clips fit within the V2 file.')
      return
    }
    setTrack2Clips(segments)
    if (overflow > 0.001) {
      setAnalyzeLog(prev => [
        { kind: 'warn', text: `⚠ V1's cut points ran ${overflow.toFixed(2)}s past the end of "${v2Source.sourceName}" — the affected clip(s) were clamped to fit` },
        ...prev,
      ])
    }
  }

  // "V2 Batch Analyzer": V1's cut points applied to the one file on V2 as a
  // plain split — one V2 clip per V1 clip, nothing else carried over. See
  // batchCutAgainstV1 for why this is a different operation from V2 Analyzer
  // and not a variant of it: the file on V2 is the SEQUENCE joined into one
  // clip, so the cuts live at cumulative durations rather than at V1's own
  // IN/OUT points.
  function handleBatchAnalyze() {
    if (track2Clips.length === 0) { alert('Drop a file on the V2 track first.'); return }
    if (timelineClips.length === 0) { alert('V1 has no clips to take cut points from.'); return }
    if (fusedV2Blocks('V2 Batch Analyzer')) return
    // Pieces, not clips: a lone V1 clip with a head hold or a Raise on it still
    // has boundaries to cut at, and four clips with no holds have three.
    const pieces = sequencePieces(timelineClips)
    if (pieces.length < 2) {
      alert('V1 is one unbroken piece — there are no clip boundaries, holds or round-up to cut V2 at. Split V1 first, or use V2 Analyzer to conform V2 to V1\'s single clip.')
      return
    }
    const v2Source = track2Clips[0]
    const name = v2Source.displayName || v2Source.sourceName
    const { segments, kinds, overflow, leftoverSec } = batchCutAgainstV1(timelineClips, track2Clips)
    // One segment means every cut point landed past the end of V2's footage —
    // the file is shorter than V1's first piece, so there was nothing to cut.
    if (kinds.length < 2) {
      alert(`"${name}" is shorter than V1's first piece — none of V1's cut points fall inside it.`)
      return
    }
    setTrack2Clips(segments)
    const shots = kinds.filter(k => k === 'main').length
    const holds = kinds.length - shots
    const notes = [
      { kind: 'info', text: `▣ V2 Batch Analyzer: "${name}" cut into ${kinds.length} clips at V1's ${kinds.length - 1} cut points — ${shots} shot${shots === 1 ? '' : 's'}${holds > 0 ? ` + ${holds} hold${holds === 1 ? '' : 's'}` : ''}` },
    ]
    if (overflow > 0.001) {
      notes.push({ kind: 'warn', text: `⚠ V1's sequence runs ${overflow.toFixed(2)}s past the end of "${name}" — only ${kinds.length} of V1's ${pieces.length} pieces could be cut` })
    }
    if (leftoverSec > 0.001) {
      notes.push({ kind: 'info', text: `▣ "${name}" runs ${leftoverSec.toFixed(2)}s longer than V1's sequence — the extra footage stayed on the last clip rather than being trimmed off` })
    }
    // Groups, not clips: a fused run is one clip to the user, so counting raw
    // entries here would report a lane of 3 where the lane shows 2.
    const v2Groups = fuseGroups(track2Clips).length
    if (v2Groups > 1) {
      notes.push({ kind: 'warn', text: `⚠ V2 held ${v2Groups} clips — only the first was cut; the rest were left as they were` })
    }
    setAnalyzeLog(prev => [...notes, ...prev])
  }

  // "V2 Reconstruct": un-apply V1's decisions from the round-tripped file on V2,
  // including the MOVES — the shots come back in source order, so V1's [C][A][B]
  // hands V2 back A B C. reconstructFromV1 returns facts only; every word the
  // user reads is written here, same as handleBatchAnalyze above.
  function handleReconstruct() {
    if (timelineClips.length === 0) { alert('V1 has no clips to reconstruct from.'); return }
    if (track2Clips.length === 0) { alert('Drop the round-tripped file on V2 first — Reconstruct edits V2\'s own clip(s), it does not create new ones.'); return }
    if (fusedV2Blocks('V2 Reconstruct')) return

    const v2Source = track2Clips[0]
    const name = v2Source.displayName || v2Source.sourceName
    const r = reconstructFromV1(timelineClips, track2Clips)
    // Reference equality is the no-op signal (reconstructFromV1 returns V2's own
    // array when nothing survives), which is also why reduceEdit would spend an
    // undo step on nothing if we set it anyway.
    if (r.segments === track2Clips) {
      alert(`Nothing to reconstruct — none of V1's shots fall inside "${name}". Is this the file V1 rendered to?`)
      return
    }
    setTrack2Clips(r.segments)

    const shotCount = r.shots.reduce((n, s) => n + s.v1Indexes.length, 0)
    // RANGES, not clips. It is stored as r.shots.length lane entries only
    // because a clip carries exactly one in/out pair and these ranges are, by
    // construction, discontiguous in V2's file. Never call this number "clips"
    // to the user.
    const ranges = r.shots.length
    // How many BOXES the lane will actually draw, asked of the same function the
    // lane asks (fuseGroups) rather than assumed to be 1. Ranges fuse only where
    // they agree on speed and direction, so a reconstruction that un-stretched
    // some shots and not others legitimately comes back as more than one box —
    // one label cannot state two speeds. Everything below reads this instead of
    // promising "one clip".
    const boxes = fuseGroups(r.segments.slice(0, ranges)).length
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
    // 1/0.75 is 1.3333333333333333; three places is enough to name a speed.
    const speedLabel = n => `${Number(n.toFixed(3))}×`
    const dropNotes = [
      r.dropped.holds > 0 ? `${plural(r.dropped.holds, 'hold')} (${r.dropped.holdSec.toFixed(2)}s)` : null,
      r.dropped.duplicates > 0 ? `${plural(r.dropped.duplicates, 'duplicate')} (${r.dropped.duplicateSec.toFixed(2)}s)` : null,
    ].filter(Boolean)

    const notes = [{
      kind: 'info',
      text: `▣ V2 Reconstruct: ${plural(shotCount, 'shot')} restored from V1 as ${boxes === 1 ? 'ONE clip' : plural(boxes, 'clip')} on V2` +
        (ranges > 1 ? ` — ${ranges} chained ranges of "${name}"` : '') +
        (r.welds > 0 ? `, ${r.welds} welded back together` : '') +
        (dropNotes.length > 0 ? `, dropped ${dropNotes.join(' + ')}` : '') +
        (r.reordered ? '' : ' — already in source order'),
    }]

    if (ranges > 1 && boxes === 1) {
      notes.push({ kind: 'info', text: `▣ Nothing was re-rendered: the ${ranges} ranges are non-adjacent in "${name}", so they sit under one clip on the lane (the ⛓ ${ranges} badge) and are joined into a single file when you press V2 Render on mode 1. Delete removes the whole chain.` })
    } else if (ranges > 1) {
      notes.push({ kind: 'info', text: `▣ Nothing was re-rendered: the ${ranges} ranges are non-adjacent in "${name}" and draw as ${boxes} boxes, because one box can only state one speed and one direction — the run splits where the timing does. V2 Render on mode 1 still joins all of them into a single file; Delete removes one box at a time.` })
    }
    if (r.reordered) {
      const order = r.shots.map(s => s.v1Indexes.map(i => i + 1).join('+')).join(' → ')
      notes.push({ kind: 'info', text: `▣ Reconstruct order: V1 clips ${order} — the moves made on V1 were reversed, so V2 now runs in source order` })
    }
    if (r.sources.length > 1) {
      notes.push({ kind: 'info', text: `▣ V1 drew on ${r.sources.length} source files — V2's shots were regrouped per file (${r.sources.map(s => s.sourceName).join(', ')}), in the order each file first appears on V1` })
    }
    for (const s of r.sources) {
      if (s.unusedSec === null) continue
      notes.push({
        kind: 'info',
        text: `▣ "${s.sourceName}": V1 used ${s.usedSec.toFixed(2)}s of ${s.sourceDurationSec.toFixed(2)}s` +
          (s.unusedSec > 0.001 ? ` — ${s.unusedSec.toFixed(2)}s of the original was never on V1, and is not in this footage either` : ' — all of it'),
      })
    }
    if (r.restoredSpeeds.length > 0) {
      const restoredShots = r.shots.reduce((n, s) => n + (s.speed !== 1 ? s.v1Indexes.length : 0), 0)
      const { stretchedSec, unstretchedSec } = r.restoredSec
      const pairs = r.restoredSpeeds.map(s => `${speedLabel(s.from)} → ${speedLabel(s.to)}`).join(', ')
      notes.push({ kind: 'info', text: `▣ ${plural(restoredShots, 'shot')} was slowed on V1 and has been un-stretched (${pairs}): the frames the slow-down repeated are dropped again, so ${stretchedSec.toFixed(2)}s of stretched footage renders back to ${unstretchedSec.toFixed(2)}s — the original timing, frame for frame. A retime carries no audio in either direction, so there was no sound in this footage to bring back.` })
    }
    if (r.unrestoredSpeeds.length > 0) {
      notes.push({ kind: 'warn', text: `⚠ ${plural(r.unrestoredSpeeds.length, 'shot speed')} on V1 (${r.unrestoredSpeeds.map(speedLabel).join(', ')}) is too slow to undo — the reciprocal would be past what the render accepts — so those shots kept 1× and DO come back at their stretched length. No speed this app offers gets here, so the project file was edited by hand.` })
    }
    const croppedShots = r.sources.reduce((n, s) => n + s.croppedShots, 0)
    if (croppedShots > 0) {
      notes.push({ kind: 'warn', text: `⚠ ${plural(croppedShots, 'shot')} was cropped on V1 — the pixels outside the crop box are not in this footage and cannot be restored. Crop was reset. To put a processed REGION back over the original, use V2 as an overlay instead.` })
    }
    for (const s of r.sources) {
      if (s.overlapSec > 0.001) {
        notes.push({ kind: 'warn', text: `⚠ "${s.sourceName}": V1's clips overlap by ${s.overlapSec.toFixed(2)}s of source time — that footage appears twice on V2 and was kept as-is, since the two stretches are not the same pixels after a round trip` })
      }
    }
    if (r.overflow > 0.001) {
      // Both halves are reachable on their own: a single shot straddling the end
      // is truncated with nothing dropped, and a much shorter V2 drops whole
      // shots without truncating any.
      const truncated = r.shots.filter(s => s.truncatedSec > 0.001).length
      const lost = [
        r.dropped.pastEnd > 0 ? `${plural(r.dropped.pastEnd, 'shot')} fell entirely past it` : null,
        truncated > 0 ? `${plural(truncated, 'shot')} was cut short` : null,
      ].filter(Boolean)
      notes.push({ kind: 'warn', text: `⚠ V1's sequence runs ${r.overflow.toFixed(2)}s past the end of "${name}"${lost.length > 0 ? ` — ${lost.join(', and ')}` : ''}. Is this the file V1 rendered?` })
    }
    if (r.leftoverSec > 0.001) {
      // Deliberately the opposite disposition from V2 Batch Analyzer's line
      // above, which keeps the extra on its last segment: a cut discards
      // nothing, a reconstruction only returns footage V1 had a decision about.
      notes.push({ kind: 'info', text: `▣ "${name}" runs ${r.leftoverSec.toFixed(2)}s longer than V1's sequence — those frames were LEFT OUT of the reconstruction, since no V1 shot accounts for them` })
    }
    if (r.dropped.subFrame > 0) {
      notes.push({ kind: 'warn', text: `⚠ ${plural(r.dropped.subFrame, 'V1 shot')} is shorter than one frame of "${name}" — dropped rather than rounded up onto a neighbour` })
    }
    // Groups, not clips — see the same line in handleBatchAnalyze. Counted on
    // the PRE-reconstruct lane, so the clip this call just created is not in it.
    const v2Groups = fuseGroups(track2Clips).length
    if (v2Groups > 1) {
      notes.push({ kind: 'warn', text: `⚠ V2 held ${v2Groups} clips — only the first was reconstructed; the rest were left as they were` })
    }
    if (hasDirty) {
      notes.push({ kind: 'warn', text: '⚠ V1 has unrendered edits — Reconstruct reads V1\'s CURRENT order and cut lengths, so if V1 changed after the render that produced this file, every boundary above is on the wrong frame. Undo, re-render V1, and drop that file on V2 instead.' })
    }
    setAnalyzeLog(prev => [...notes, ...prev])
  }

  // version 9 is V1 clips that can carry `fuseId` too, plus the `fuseMerged` flag
  // that says a run was MERGED rather than reconstructed (and so may hold members
  // with different speeds, directions or crops — see clipMath.fuseGroups). Merge
  // puts one there when
  // the picked clips can't collapse into a single clip (different sources, or a
  // gap between their ranges), so V1 can now hold a fused run exactly as V2 has
  // since version 8 — same field, same meaning, same free ride through the
  // serializer, and absent still means "not fused". Bumped for the same reason 8
  // was: it changes how many FILES an A/B 1+ render writes, which draws its shots
  // from the V1 lane.
  // version 8 is V2 clips that can carry `fuseId`: several lane entries stamped
  // with one id are ONE clip to the user — drawn as a single seamless box and
  // rendered as a single file. It rides along for free (clips are serialized
  // wholesale) and absent means "not fused", so a version-7 file reopens
  // identically. It gets a bump anyway rather than being treated as a cosmetic
  // label, because the field changes how many FILES a 1+ V2 Render writes.
  // version 7 is A1 clips that can be SPLIT: a clip may carry `inSec`/`outSec`
  // saying which part of its file it plays. Nothing had to change to save them
  // (they ride along on the bed objects) and absent means the whole file, so a
  // version-6 lane reopens identically — the bump is the human-readable marker
  // that a lane in this file may hold two clips pointing at one file.
  // version 6 saves the room-tone settings — `noiseEnabled` and `noiseGainDb` —
  // because how a project's silence sounds is part of the project, not a
  // property of whoever last had it open. version 5 turned A1 into a lane:
  // `audioBeds` (an ordered array) replaces version 3's single `audioBed`
  // object, and version 4 added exportPresets. Nothing reads `version` — it's a
  // marker for humans reading a .nara — and older files still load unchanged
  // (handleLibraryOpen promotes a lone `audioBed` to a one-clip lane, defaults a
  // missing preset list to none, and defaults absent room-tone keys).
  //
  // The level is saved as the CLAMPED NUMBER, never the raw field text: a .nara
  // is read by the next session and by a human, and "-" or "999" is neither a
  // level nor something the server would accept.
  function noiseGainNumber(text) {
    return clampNoiseGainDb(text, NOISE_GAIN_DB_DEFAULT, NOISE_GAIN_DB_MIN, NOISE_GAIN_DB_MAX)
  }

  function buildProject() {
    return {
      version: 9, clips: timelineClips, track2Clips, audioBeds, selectedId, exportPresets,
      noiseEnabled,
      noiseGainDb: noiseGainNumber(noiseGainDb),
    }
  }

  // Baseline for "is there unsaved work?": the fingerprint as of the last save
  // or open. Seeded with the state the app itself starts in — three empty lanes,
  // noise off at its default level — so opening a project on a fresh app
  // asks nothing. A ref, not state: nothing renders from it.
  const savedWorkRef = useRef(workFingerprint({ noiseGainDb: NOISE_GAIN_DB_DEFAULT }))

  function currentWorkFingerprint() {
    return workFingerprint({
      clips: timelineClips, track2Clips, audioBeds,
      noiseEnabled, noiseGainDb: noiseGainNumber(noiseGainDb),
    })
  }

  async function handleSave() {
    let name = projectName
    // Saving a project that is already open writes straight back over its own
    // file — that IS what Save means, so it passes overwrite and never asks.
    // Only a name the user has just typed can land on a DIFFERENT project, so
    // only that case has to check.
    const overwrite = Boolean(projectName)
    if (!name) {
      name = prompt('Project name:', 'project')
      if (!name) return
    }
    // Built once and reused for the retry: buildProject() reads current state,
    // and the confirm below is blocking, so re-reading it after the answer could
    // pick up a different timeline than the one the user agreed to save.
    const payload = buildProject()
    let result = await saveProject(name, payload, overwrite)
    if (result.exists) {
      if (!confirm(`"${result.exists}" already exists. Replace it? This cannot be undone.`)) return
      result = await saveProject(name, payload, true)
    }
    if (result.error) { alert('Save failed: ' + result.error); return }
    setProjectName(result.name)
    // What's on disk now IS the work, so this is the point nothing is unsaved.
    // Taken from `payload` rather than from state: the state may have moved on
    // while the POST was in flight, and it's the payload that got written.
    savedWorkRef.current = workFingerprint(payload)
    setSaveStatus('Saved ' + new Date().toLocaleTimeString())
    setTimeout(() => setSaveStatus(''), 3000)
  }

  // Save As: always ask for a new name and save a copy under it, leaving the
  // currently-open project file untouched. The default seeds a "copy" name so
  // hitting Enter never overwrites the original. The active project switches
  // to the new name, so subsequent Saves target the copy. Typing the name of
  // SOME OTHER existing project used to replace it outright; now the server
  // refuses and the confirm below asks first.
  async function handleSaveAs() {
    const suggested = projectName
      ? projectName.replace(/\.nara$/, '') + ' copy'
      : 'project'
    const name = prompt('Save project as:', suggested)
    if (!name) return
    const payload = buildProject()
    let result = await saveProject(name, payload)
    if (result.exists) {
      if (!confirm(`"${result.exists}" already exists. Replace it? This cannot be undone.`)) return
      result = await saveProject(name, payload, true)
    }
    if (result.error) { alert('Save failed: ' + result.error); return }
    setProjectName(result.name)
    savedWorkRef.current = workFingerprint(payload)
    setSaveStatus('Saved ' + new Date().toLocaleTimeString())
    setTimeout(() => setSaveStatus(''), 3000)
  }

  // Cmd/Ctrl+S → Save, same as the Save button (including its prompt for a
  // name on a never-saved project).
  //
  // Lives here rather than in Timeline.jsx's shortcut block because the
  // Timeline UNMOUNTS whenever the AGENT or Actions tab is active — a
  // shortcut registered there would silently stop working on two of the
  // three tabs. Save is an app-level action, so it listens at the app level.
  //
  // Three details this has to get right:
  //   • preventDefault runs FIRST and unconditionally, before any of the
  //     bail-outs. Cmd+S is the browser's own "Save Page As"; letting it
  //     through on a no-op (nothing to save, a dialog open) would dump an
  //     HTML file picker on the user.
  //   • Unlike the Timeline shortcuts it deliberately still fires from
  //     INPUT/TEXTAREA. A modified key can't collide with typing, and every
  //     editor saves from a text field.
  //   • `savingRef` (not `saveStatus`) guards re-entry: handleSave is async
  //     and opens a blocking prompt() when unnamed, so a held or double
  //     Cmd+S would otherwise queue duplicate prompts and POSTs.
  const saveRef = useRef(null)
  saveRef.current = handleSave
  useEffect(() => {
    function onKeyDown(e) {
      if (!((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S'))) return
      e.preventDefault()
      if (e.repeat || savingRef.current) return
      // Match the Save button's own disabled/blocked conditions exactly, so
      // the shortcut is never a second path to something the button won't do.
      if (timelineClips.length === 0) return
      if (showRenderDialog || showLibrary || showAbout || showFfmpegSettings || footageLoss) return
      savingRef.current = true
      Promise.resolve(saveRef.current?.()).finally(() => { savingRef.current = false })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [timelineClips.length, showRenderDialog, showLibrary, showAbout, showFfmpegSettings, footageLoss])

  function handleLibraryOpen(name, project) {
    // A pre-version-5 project has a single `audioBed` object; it becomes a
    // one-clip lane, which renders the graph it always did. normalizeBeds
    // back-fills startSec for anything written before version 6, from the
    // cumulative sum that USED to be the lane's only notion of position — so an
    // older project reopens as the same lane it rendered as.
    const beds = normalizeBeds(project.audioBeds || (project.audioBed ? [project.audioBed] : []))
    // Opening replaces all three lanes AND clears the undo history, so anything
    // unsaved is gone for good — ask first. Compared by fingerprint rather than
    // by a flag, so a project opened and not touched — or edited and then edited
    // back — doesn't ask. Deliberately a plain confirm, not a three-way
    // save/discard/cancel: Save is one click away behind Cancel, and this is the
    // only path that silently threw work away.
    if (currentWorkFingerprint() !== savedWorkRef.current) {
      const ok = window.confirm(
        `There are unsaved changes on the timeline. Opening "${name}" replaces all three lanes `
        + 'and clears the undo history, so those changes cannot be recovered.\n\n'
        + 'Cancel to go back and save first, or OK to open anyway.')
      if (!ok) return
    }
    // One reset for all three lanes, so the freshly-loaded project starts with
    // an empty history — Cmd+Z must not walk back into the project that was
    // open before this one.
    resetTracks({
      v1: project.clips,
      v2: project.track2Clips || [],
      a1: beds,
    })
    // The project as loaded is now the saved state. Built from the SAME values
    // handed to the setters rather than read back from state, which is async and
    // still holds the previous project at this point.
    savedWorkRef.current = workFingerprint({
      clips: project.clips,
      track2Clips: project.track2Clips || [],
      audioBeds: beds,
      noiseEnabled: project.noiseEnabled === true,
      noiseGainDb: noiseGainNumber(
        project.noiseGainDb == null ? NOISE_GAIN_DB_DEFAULT : project.noiseGainDb),
    })
    setSelectedId(project.selectedId || null)
    // A1's selection is a position in the lane that was just replaced, so it
    // cannot survive the load.
    setSelectedBedIndex(null)
    setProjectName(name)
    setShowLibrary(false)
    // A1 Noise (version 6). Both operators are load-bearing on a pre-version-6
    // file, which has neither key: `=== true` so a missing switch is off rather
    // than truthy-undefined, and `== null` — NOT `||` — because 0 dB is a legal
    // level that `||` would silently promote to the default.
    setNoiseEnabled(project.noiseEnabled === true)
    setNoiseGainDb(String(
      project.noiseGainDb == null ? NOISE_GAIN_DB_DEFAULT : project.noiseGainDb))
    // The project's own export presets fold into the saved set (see
    // mergeExportPresets — the project's copy wins a name collision, and a
    // pre-version-4 project has none, so nothing happens). The POST is what
    // makes them survive a reload; a hand-edited .nara whose presets the
    // backend refuses is reported in the log rather than swallowed.
    const merged = mergeExportPresets(exportPresets, project.exportPresets)
    if (merged !== exportPresets) {
      setExportPresets(merged)
      setExportSettings({ presets: merged }).then(result => {
        if (result.error) {
          setAnalyzeLog(prev => [
            { kind: 'warn', text: `⚠ Export presets in "${name}" were rejected: ${result.error}` },
            ...prev,
          ])
        }
      })
    }
  }

  function handleExportProject() {
    const blob = new Blob([JSON.stringify(buildProject(), null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = projectName || 'project.nara'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  // Reads a .nara file picked from disk (the counterpart to
  // handleExportProject's download) and loads it the same way opening a
  // saved project from the Library does — same shape, same trust model
  // (the server's own /api/projects save route only checks clips is a
  // list, so client-side validation mirrors that, not more).
  async function handleImportProject(file) {
    let project
    try {
      project = JSON.parse(await file.text())
    } catch {
      alert('Import failed: not a valid .nara/JSON file.')
      return
    }
    if (!project || !Array.isArray(project.clips)) {
      alert('Import failed: file is missing a "clips" list.')
      return
    }
    const name = file.name.replace(/\.\w+$/, '')
    handleLibraryOpen(name, project)
  }

  function handleExportEdl() {
    const lines = ['TITLE: GENAI EDITOR', '']
    let recFrame = 0
    const fps = timelineClips[0]?.fps || 24
    function tc(seconds) {
      const totalFrames = Math.round(seconds * fps)
      const ff = totalFrames % fps
      const totalSec = Math.floor(totalFrames / fps)
      const ss = totalSec % 60
      const mm = Math.floor((totalSec % 3600) / 60)
      const hh = Math.floor(totalSec / 3600)
      return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}:${String(ff).padStart(2,'0')}`
    }
    timelineClips.forEach((c, i) => {
      const dur = (c.outSec - c.inSec) + (c.headHoldSec || 0) + (c.tailHoldSec || 0) + (c.roundHoldSec || 0)
      const durFrames = Math.round(dur * fps)
      const evt = String(i + 1).padStart(3, '0')
      const reel = (c.displayName || c.sourceName).slice(0, 8).padEnd(8)
      const srcIn = tc(c.inSec)
      const srcOut = tc(c.outSec)
      const recIn = tc(recFrame / fps)
      const recOut = tc((recFrame + durFrames) / fps)
      lines.push(`${evt}  ${reel}  V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`)
      if (c.reversed) lines.push(`* REVERSE`)
      if (c.headHoldSec) lines.push(`* HEAD HOLD ${c.headHoldSec.toFixed(2)}s`)
      if (c.tailHoldSec) lines.push(`* TAIL HOLD ${c.tailHoldSec.toFixed(2)}s`)
      if (c.roundHoldSec) lines.push(`* ROUND ${c.roundHoldSec.toFixed(2)}s`)
      lines.push('')
      recFrame += durFrames
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = (projectName || 'project').replace(/\.\w+$/, '') + '.edl'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  // The top bar's ⋯ drop-down. Every item is one of the four buttons that used to
  // sit in the row, with the same handler and the same disabled rule (nothing to
  // export with an empty V1) — Import and the settings window stay enabled
  // because both are how you GET something to work on. useCallback because
  // ContextMenu subscribes its document-level listeners keyed on `onClose`, so a
  // new identity each render would tear them down and re-add them ~every render.
  const closeProjectMenu = useCallback(() => setProjectMenuAt(null), [])
  //
  // Each item keeps its OWN glyph rather than becoming plain text: those four
  // icons are a designed set (see the comment above LibraryIcon) and anyone who
  // learned them in the toolbar should still recognise the row they moved to.
  const projectMenuItems = [
    {
      label: <span className="flex items-center gap-2"><ExportIcon />Export project (.nara)</span>,
      onClick: handleExportProject,
      disabled: timelineClips.length === 0,
    },
    {
      label: <span className="flex items-center gap-2"><ImportIcon />Import project…</span>,
      onClick: () => importInputRef.current?.click(),
    },
    {
      label: <span className="flex items-center gap-2"><ExportEdlIcon />Export EDL</span>,
      onClick: handleExportEdl,
      disabled: timelineClips.length === 0,
    },
    {
      separatorBefore: true,
      // Encoder settings, not project settings — hence the rule above it. The
      // ACTIVE marker repeats what the trigger's emerald says, because from
      // inside the menu the trigger is hidden behind it.
      label: (
        <span className="flex items-center gap-2">
          <GearIcon />FFmpeg Custom Settings…
          {exportQuality === 'custom' && <span className="ml-auto text-[9px] text-emerald-400">ACTIVE</span>}
        </span>
      ),
      onClick: () => setShowFfmpegSettings(true),
    },
    // Theme — the clip colours on the tracks. A display preference, so it sits
    // below the rule with the encoder settings rather than among the project
    // actions, and it persists to localStorage instead of into the .nara.
    { separatorBefore: true, heading: true, label: 'Theme' },
    ...CLIP_THEME_NAMES.map(name => ({
      // The swatches ARE the palette — mapped from clipPalette rather than
      // hand-copied, so a palette edit can't leave the menu advertising colours the
      // timeline no longer uses. They sit on a bg-neutral-950 strip because the
      // fills are translucent and the menu's own bg-neutral-800 would render every
      // one of them lighter than it will actually appear on a lane.
      label: (
        <span className="flex items-center gap-2">
          <span className="flex gap-px p-px rounded-sm bg-neutral-950">
            {clipPalette(name).map((entry, k) => (
              <span key={k} className={`w-1.5 h-2.5 ${entry.fill}`} />
            ))}
          </span>
          <span className="capitalize">{name}</span>
          {clipTheme === name && <span className="ml-auto text-[9px] text-emerald-400">✓</span>}
        </span>
      ),
      onClick: () => chooseClipTheme(name),
      // Stays open: the tracks repaint behind the menu, so this is the one item
      // where you want to click through all four and compare.
      keepOpen: true,
    })),
  ]

  const displayInfo = (() => {
    if (!binSelection?.info) return null
    const info = { ...binSelection.info, _name: binSelection.name }
    // When the selected clip is retimed, show the retimed duration and the frame
    // count the constant-fps render will actually contain — the fps normalization
    // duplicates frames to fill a stretch and drops them again on a Reconstruct
    // un-stretch, so dividing by speed is right in both directions.
    const speed = selectedClip?.speed
    if (selectedClip && speed && speed !== 1 && selectedClip.sourceName === binSelection.name) {
      if (info.duration) info.duration = info.duration / speed
      if (info.video_duration) info.video_duration = info.video_duration / speed
      if (info.nb_frames != null) info.nb_frames = Math.round(info.nb_frames / speed)
      info._name = `${binSelection.name} (${Math.round(speed * 100)}% speed)`
    }
    return info
  })()

  // The clip edit tools. Built here (they act on whichever track is focused,
  // which is state this file owns) but handed to Timeline as a node so they
  // render as the Timeline card's first row — the position the transport /
  // render bar used to occupy. The row's own layout classes travel with it;
  // Timeline only supplies the surrounding padding and divider.
  const editToolbar = (
    <div data-tour="editToolbar" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {/* Undo leads the row — moved out of the action bar's left group so it
          sits with the tools whose effects it reverses. Unlike the rest of the
          row it is deliberately NOT focusedTrack-aware, and that is the point:
          one shared history across V1/V2/A1 means this steps back the last edit
          wherever it happened, so it never depends on which lane the user
          happens to have clicked last. Cmd/Ctrl+Z fires from Timeline.jsx's key
          handler (same onUndo prop), so the two paths can't diverge. */}
      <button
        onClick={undoEdit}
        disabled={!canUndo}
        title="Undo last edit — any track (Cmd/Ctrl+Z)"
        className="w-5 h-5 flex items-center justify-center rounded text-[9px] text-neutral-400 hover:text-white hover:bg-neutral-700 disabled:opacity-40"
      >↩</button>
      <div className="w-px h-3.5 bg-neutral-700" />
      <HoldFrameForm clips={activeClips} setClips={setActiveClips} displayMode={timeDisplayMode} />
      <div className="w-px h-3.5 bg-neutral-700" />
      {/* onFootageLoss gated on V1: this form writes through setActiveClips, so
          it edits whichever lane is focused, and only V1's losses cost anything. */}
      <TrimForm selectedClip={activeSelectedClip} setClips={setActiveClips} displayMode={timeDisplayMode}
        onFootageLoss={focusedTrack === 1 ? handleFootageLoss : null} />
      <div className="w-px h-3.5 bg-neutral-700" />
      <DuplicateButton selectedClip={activeSelectedClip} clips={activeClips} setClips={setActiveClips} onSelectId={setActiveSelectedId} />
      <div className="w-px h-3.5 bg-neutral-700" />
      {/* Reorder without dragging. V2 gets no seek: like clicking a V2 clip, it
          leaves the playhead alone — V1 is the timeline of record. With an audio
          clip selected these move THAT clip along A1, the second tool (with
          Split) that an A1 selection redirects. */}
      <MoveClipButtons
        selectedClip={activeSelectedClip} clips={activeClips} setClips={setActiveClips}
        onSelectId={setActiveSelectedId}
        onSeek={focusedTrack === 1 ? (sec => timelineSeekRef.current?.(sec)) : null}
        selectedBedIndex={selectedBedIndex} beds={audioBeds} onMoveBed={handleMoveBed}
      />
      <div className="w-px h-3.5 bg-neutral-700" />
      <ReverseForm selectedClip={activeSelectedClip} setClips={setActiveClips} />
      <div className="w-px h-3.5 bg-neutral-700" />
      {/* The other tool an A1 selection redirects: with an audio clip selected,
          Split cuts that clip instead of the video one. */}
      <SpliceButton
        selectedClip={activeSelectedClip} clips={activeClips} setClips={setActiveClips}
        onSelectId={setActiveSelectedId}
        selectedBed={selectedBed} selectedBedIndex={selectedBedIndex}
        setBeds={setAudioBeds} laneClockRef={laneClockRef}
      />
      {/* Split's opposite, and next to it on purpose. The only tool that reads
          more than one selection: activeMergeIds is the primary selection plus
          whatever was Shift-clicked on the same lane. */}
      <MergeButton
        clips={activeClips} setClips={setActiveClips} ids={activeMergeIds}
        onSelectId={setActiveSelectedId} onMerged={clearMergePicks}
        selectedBed={selectedBed}
      />
      <div className="w-px h-3.5 bg-neutral-700" />
      <RaiseButton clips={activeClips} setClips={setActiveClips} />
      <div className="w-px h-3.5 bg-neutral-700" />
      <SpeedForm
        selectedClip={activeSelectedClip}
        setClips={setActiveClips}
        noiseEnabled={noiseEnabled}
        onToggleNoise={toggleNoise}
        noiseGainDb={noiseGainDb}
        onSetNoiseGainDb={setNoiseGainDb}
        compareEnabled={compareEnabled}
        onToggleCompare={toggleCompare}
      />
    </div>
  )

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-200">
      {/* Top toolbar. NO fill and NO bottom rule of its own (it had
          bg-neutral-900 + border-b border-neutral-800): the bar sits straight on
          the app canvas so the title, version, pane switch and the glyph buttons
          read as controls on the page rather than as a banded chrome strip above
          it — the same island-on-canvas logic the stage and the side columns
          already follow. Every control up here carries its own border and no
          fill, so they stay legible without a bar behind them; the only filled
          ones are the two deliberate ACTIVE states (custom encode, tour
          running), which stand out more for it. What separates the bar from the
          work area is now the columns' own 8px padding, not a line. */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        {/* Plain label, not a button: it used to open the About dialog, but a
            title with no affordance is a hidden control — the document-icon
            button on the right is now the only way in, and it looks like one. */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white tracking-tight">GENAI EDITOR</span>
          {/* The center dock's pane switch, and the ONLY one — it replaced a
              static "EDL mode" chip that was styled like a control and was not
              one, and then replaced the four-button tab bar that used to sit
              above the dock. It carried a "Mode" caption until 0.57.1; the
              dropdown names the pane it is showing, so the caption was a word
              spent saying what the control already said, and the version number
              now has that spot. `centerTab` is still the state everything reads;
              this is now its only writer besides the tour. Values are
              centerTab's own, not display strings — 'assistant' shows as Agent,
              which is how that pane has always been labelled. */}
          {/* The version sits where the word "Mode" used to, so the top-left is
              one product identity (title + version) followed by the control,
              rather than a caption for a dropdown that already says what it is.
              A plain <div>, not a <label>, precisely because there is no longer
              any label text — hence the select's aria-label, which is what now
              names it; its `title` is the visible explanation.
              Quiet metadata, not a label: 9px and muted, and deliberately with
              no border box of its own — an outlined pill here would read as a
              second control. This is the number a bug report is identified by,
              so it is always visible rather than buried in the About dialog (it
              is in there too). `APP_VERSION` comes from vite.config by way of
              the repo-root VERSION file; never hardcode it here.
              `data-tour="reformat"` lives here because the tour's Reformat step
              used to spotlight that tab button; this control is its anchor now,
              and like the tab bar it is visible whichever pane is up. */}
          <div data-tour="reformat" className="flex items-center gap-1.5">
            <span
              className={`text-[9px] font-mono ${versionMismatch ? 'text-amber-500' : 'text-neutral-600'}`}
              title={versionMismatch
                // Reachable and easy to miss: `npm run dev` keeps serving the
                // bundle it built while the Flask reloader picks a bumped VERSION
                // up immediately, so the two genuinely disagree until the page is
                // reloaded. Worth saying out loud — a stale bundle is the state in
                // which a bug report's version number lies.
                ? `Version mismatch — this page was built at ${APP_VERSION} but the backend is running ${backendVersion}. Reload the page; if it persists, restart the Vite dev server.`
                : `GenAI Editor ${APP_VERSION}${backendVersion ? ' — frontend and backend agree' : ''}`}
            >
              v{APP_VERSION}{versionMismatch ? ' ⚠' : ''}
            </span>
            <select
              value={centerTab}
              onChange={e => setCenterTab(e.target.value)}
              aria-label="Center pane"
              title="Which pane the center dock shows — Timeline, Agent, Reformat or Actions"
              className="text-[10px] rounded bg-neutral-950 border border-neutral-700 text-neutral-300 px-1 py-0.5"
            >
              <option value="timeline">Timeline</option>
              <option value="assistant">Agent</option>
              <option value="reformat">Reformat</option>
              <option value="actions">Actions</option>
            </select>
          </div>
        </div>
        <div data-tour="project" className="flex items-center gap-1.5">
          {projectName && (
            <span className="text-[9px] text-neutral-500 mr-1">{projectName}{saveStatus && <span className="text-emerald-500 ml-1.5">{saveStatus}</span>}</span>
          )}
          <button
            onClick={() => setShowLibrary(true)}
            title="Library — open a saved project"
            className="w-6 h-6 flex items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500"
          >
            <LibraryIcon />
          </button>
          <button
            onClick={handleSave}
            disabled={timelineClips.length === 0}
            title="Save — save project to the library (Cmd/Ctrl+S)"
            className="w-6 h-6 flex items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-40"
          >
            <SaveIcon />
          </button>
          <button
            onClick={handleSaveAs}
            disabled={timelineClips.length === 0}
            title="Save As — save a copy under a new name, without overwriting the current project"
            className="w-6 h-6 flex items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-40"
          >
            <SaveAsIcon />
          </button>
          {/* New sits with Save/Save As rather than off past the file actions:
              all four are things done TO the project you are in, and New is the
              one people reach for by muscle memory beside them.
              Gained a tooltip when it lost its label: it reloads the page, so an
              unsaved timeline goes with it, and that is worth knowing BEFORE the
              click now that the button is a glyph. */}
          <button
            onClick={() => location.reload()}
            title="New — start a fresh session (reloads the app; unsaved timeline edits are lost)"
            className="w-6 h-6 flex items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500"
          >
            <NewIcon />
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".nara,application/json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleImportProject(file)
              e.target.value = ''
            }}
          />
          <div className="w-px h-4 bg-neutral-700" />
          {/* One drop-down for the four occasional ones — Export, Import, Export
              EDL and FFmpeg Custom Settings. They were four more icon buttons in
              a row of ten, none of them reached mid-edit, and the encoder gear
              belongs with the exports it decides the contents of rather than
              beside New.
              It keeps the gear's emerald ACTIVE tint on the TRIGGER, not just on
              the menu item: "a custom two-pass encode is what Render will use" is
              a state that has to be visible without opening anything, which is
              the whole reason that button glowed. */}
          <button
            ref={projectMenuBtnRef}
            onClick={() => setProjectMenuAt(prev => {
              if (prev) return null
              const r = projectMenuBtnRef.current.getBoundingClientRect()
              // ContextMenu clamps itself back inside the viewport, so hanging it
              // off the left edge here is safe even though this button is inches
              // from the right edge of the window.
              return { x: r.left, y: r.bottom + 4 }
            })}
            title={exportQuality === 'custom'
              ? 'Project files & encoder — Export, Import, Export EDL, FFmpeg Custom Settings (custom encode is ACTIVE)'
              : 'Project files & encoder — Export, Import, Export EDL, FFmpeg Custom Settings'}
            className={`w-6 h-6 flex items-center justify-center rounded border ${
              exportQuality === 'custom'
                ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500'
                : projectMenuAt
                  // Open, but nothing is active: a plain held-down look, not the
                  // emerald, which means one specific thing in this bar.
                  ? 'bg-neutral-800 text-neutral-200 border-neutral-500'
                  : 'border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500'
            }`}
          >
            <MoreMenuIcon />
          </button>
          <ContextMenu
            position={projectMenuAt}
            ignoreRef={projectMenuBtnRef}
            onClose={closeProjectMenu}
            items={projectMenuItems}
          />
          <button
            onClick={startTour}
            disabled={tourActive}
            title="Take a guided tour of the app, one part at a time"
            className={`w-6 h-6 flex items-center justify-center rounded border ${tourActive ? 'bg-amber-500 text-neutral-950 border-amber-500' : 'border-neutral-700 text-neutral-400 hover:text-amber-400 hover:border-amber-500'} disabled:cursor-default`}
          >
            <BulbIcon />
          </button>
          {/* The only way into the About dialog, beside the tour: the GENAI
              EDITOR title used to open it too, but nothing about a title looks
              clickable, so the manual keeps just this visible affordance next
              to the tour it complements — the bulb walks the UI, this one
              explains the app. */}
          <button
            onClick={() => setShowAbout(true)}
            title="About GenAI Editor — the in-app manual (pipeline, crop presets, EDL, V2, assistant)"
            className="w-6 h-6 flex items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:text-indigo-300 hover:border-indigo-500"
          >
            <DocIcon />
          </button>
        </div>
      </div>

      <TourOverlay />

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: mirrors the right column's own shape exactly — preview
            video, then always-visible metadata, then the bin as a flex-1
            card, so Media Bin's list fills the same remaining height
            Export Bin's own list does (OutputPanel.jsx has the identical
            video/info/flex-1-bin structure). */}
        <div
          style={{ width: leftPanelWidth }}
          className="flex flex-col gap-2 p-2 overflow-y-auto shrink-0"
        >
          <div className="flex-1 min-h-0 flex flex-col">
            <MediaLibrary files={inputFiles} trackTags={trackTags} inUseNames={inUseSourceNames} onAddToTimeline={handleAddToTimeline} onCleared={handleCleared} onDeleted={refresh} onRenamed={handleSourceRenamed} onUpload={handleUpload}>
              <div data-tour="mediaInfoIn">
                <TechInfoPanel info={displayInfo} title="Media Info In" collapsible />
              </div>
            </MediaLibrary>
          </div>
        </div>

        {/* Drag handle to resize the left panel. The hairline inside it IS the
            edge between this column and the centre one — don't add a border on
            either neighbour's facing side. */}
        <PanelDivider onPointerDown={startResize('left')} dragging={resizingSide === 'left'} />

        {/* Center: Preview + toolbar + Timeline */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* An ISLAND, like the render bar below the stage: `mx-2 my-2` insets
              it by the same 8px, and `rounded-md border border-neutral-800` is
              the Timeline card's chrome, so every panel in this column reads as
              a card with the same edges. It used to be a full-bleed strip whose
              `border-b` doubled as the seam against the preview stage; the gap
              now does that job, and the stage itself stays edge to edge because
              it's a picture, not a panel. */}
          <div data-tour="previewHeader" className="flex items-center justify-between mx-2 my-2 px-2.5 py-1 rounded-md border border-neutral-800 bg-neutral-900">
            {/* The "Preview" label used to sit here; the two frame grabs took
                its place (the panel's position already says what it is). */}
            <FrameGrabButtons />
            <div className="flex items-center gap-2">
              <CropForm
                selectedClip={activeSelectedClip}
                setClips={setActiveClips}
                animateEnabled={cropAnimateOn}
                onToggleAnimate={() => setAnimateEnabled(v => !v)}
                freeEnabled={cropFreeOn}
                onToggleFree={() => setFreeEnabled(v => !v)}
              />
              {/* The Render button used to sit here; it now lives in the
                  Timeline's action bar as "V1 Render", beside V2 Render. */}
            </div>
          </div>
          {/* The stage is an ISLAND too, on the same 8px inset as the header
              above and the render bar below, with the same `rounded-md border
              border-neutral-800` chrome — so the column's left and right edges
              are one straight line instead of the stage bleeding past the cards.
              `overflow-hidden` is what makes the rounding visible: the black
              fill and the <video> are square children and would paint over the
              corners without it. The border also gives the corners something to
              read against — black on neutral-950 is nearly the same tone. */}
          <div ref={previewStageRef} data-tour="previewStage" className="relative flex-1 min-h-[50vh] mx-2 flex items-center justify-center overflow-hidden rounded-md border border-neutral-800 bg-black p-3">
            <PreviewPlayer />
            {/* Composited V2 regions, under the crop outline so the outline
                stays visible while dragging the box that positions them.
                One layer per overlay; each shows only while the shared
                <video> is decoding its own V1 source. */}
            {overlays.map(ov => (
              <OverlayPreview
                key={ov.v2Id}
                overlay={ov}
                stageRef={previewStageRef}
                visible={v2Visible}
                opacity={compareEnabled ? 0.5 : 1}
              />
            ))}
            {/* V2 Compare's full-frame layers, and only when there is no
                composite — a composite already puts V2 on screen, so compare
                just halves its opacity above instead of covering it. Same
                component either way: the clock sync, the drift nudging and the
                out-of-range hiding are the hard parts and they are identical
                whether the layer is a region or the whole frame. */}
            {compareLayers.map(ov => (
              <OverlayPreview
                /* Keyed by v1Id, not v2Id (0.74.0): a Compare layer is now one
                   per V1 CLIP carrying every V2 segment that overlaps it, and one
                   V2 clip can legitimately appear under several V1 clips — so
                   v2Id is not unique here and a duplicate key would silently drop
                   layers, i.e. reintroduce the blank stretches this fixed. */
                key={`cmp-${ov.v1Id}`}
                overlay={ov}
                stageRef={previewStageRef}
                visible={v2Visible}
                opacity={0.5}
                fit="contain"
              />
            ))}
            <CropOverlay selectedClip={activeSelectedClip} setClips={setActiveClips} stageRef={previewStageRef} animateEnabled={cropAnimateOn} freeEnabled={cropFreeOn} />
          </div>

          {/* The dock's pane switch used to be a four-button tab bar in this
              spot. It is now the pane menu in the top bar and nowhere else —
              one control, one place. Nothing else moved: the panes below still
              key off `centerTab`, and the row under this comment is still the
              Timeline's portal slot. */}

          {/* The Timeline's action bar lands here — Timeline.jsx portals it
              into this element (see `timelineBarSlot`), because every control
              in it is driven by that component's own playback transport. The
              row keeps this position's chrome; only its contents came from
              elsewhere. The element itself always stays mounted (a portal
              needs a stable target), but it drops its padding and borders on
              the other modes — the Timeline is unmounted then, so the row
              would otherwise show as an empty strip.
              It is drawn as an ISLAND, not a full-bleed strip: `mx-2` insets
              it by the same 8px the Timeline wrapper's `p-2` gives the card
              below, and `rounded-md border border-neutral-800` is that card's
              own chrome (Timeline.jsx's root), so the two read as two cards in
              one column instead of a banded header over a card. `mt-2` is the
              matching gap to the preview stage above, which stays edge to edge
              because it's a picture, not a panel. */}
          <div
            ref={setTimelineBarSlot}
            data-tour="renderBar"
            className={centerTab === 'timeline' ? 'mx-2 mt-2 px-2.5 py-1.5 rounded-md border border-neutral-800 bg-neutral-900' : ''}
          />

          {/* Timeline / AGENT / Actions pane content — only one visible at
              a time, per the top bar's pane menu. Timeline sets this wrapper's
              natural content height (shrink-0, unconstrained); switching
              to AGENT/Actions pins the wrapper to that SAME height
              (centerDockHeight, measured off Timeline via the ResizeObserver
              effect above) rather than letting ChatPanel/LogPanel stretch
              it taller — so toggling tabs never changes the dock's height.
              min-h-56 is still applied as a floor UNDERNEATH the pinned
              height (via Math.max, not instead of it): an empty Timeline
              (no clips) is naturally only ~150px tall, which would clip
              ChatPanel's own input row — 56 (14rem/224px) matches
              ChatPanel's minimum usable height (header + editing banner +
              its 100px message-area floor + input row), so AGENT/Actions
              stay usable even when Timeline itself is currently shorter
              than that. */}
          <div
            ref={centerDockRef}
            style={centerTab !== 'timeline' && centerDockHeight ? { height: Math.max(centerDockHeight, 224) } : undefined}
            className={`flex flex-col p-2 ${centerTab === 'timeline' ? 'shrink-0' : centerDockHeight ? 'shrink-0 overflow-hidden' : 'flex-1 min-h-56'}`}
          >
            {centerTab === 'timeline' && (
              <div data-tour="timeline">
                <Timeline
                  clips={timelineClips}
                  setClips={setTimelineClips}
                  clipTheme={clipTheme}
                  onAddToV1={handleAddToV1}
                  // The *ByName pair is the Media Bin drag route: those files are
                  // already in input/, so there is nothing to upload and only the
                  // by-name half of the matching handler runs.
                  onAddToV1ByName={handleAddToTimeline}
                  selectedId={selectedId}
                  selectedPart={selectedPart}
                  onSelectId={setSelectedId}
                  onSelectItem={selectItem}
                  hasDirty={hasDirty}
                  onUndo={undoEdit}
                  canUndo={canUndo}
                  track2Clips={track2Clips}
                  setTrack2Clips={setTrack2Clips}
                  selectedId2={selectedId2}
                  selectedPart2={selectedPart2}
                  onSelectItem2={selectItem2}
                  onPickForMerge={pickForMerge}
                  mergeMarkIds={mergeMarkIds}
                  focusedTrack={focusedTrack}
                  onFocusTrack={setFocusedTrack}
                  onAddToV2={handleAddToV2}
                  onAddToV2ByName={addToV2ByName}
                  onAnalyze={handleAnalyze}
                  onBatchAnalyze={handleBatchAnalyze}
                  onReconstruct={handleReconstruct}
                  onRenderV2={handleRenderV2Click}
                  onRender={handleRenderClick}
                  onRenderA1={handleRenderA1}
                  rendering={rendering}
                  timeDisplayMode={timeDisplayMode}
                  onToggleTimeDisplayMode={toggleTimeDisplayMode}
                  animateEnabled={cropAnimateOn}
                  v1Visible={v1Visible}
                  onToggleV1={toggleV1Visible}
                  v2Visible={v2Visible}
                  onToggleV2={toggleV2Visible}
                  hasOverlay={hasOverlay}
                  compareEnabled={compareEnabled}
                  v2RenderMode={v2RenderMode}
                  onSetV2RenderMode={setV2RenderMode}
                  v2ShotMode={v2ShotMode}
                  onSetV2ShotMode={setV2ShotMode}
                  v2ShotProgress={v2ShotProgress}
                  audioBeds={audioBeds}
                  onAddToA1={handleAddToA1}
                  onRemoveBed={handleRemoveBed}
                  onMoveBed={handleMoveBed}
                  selectedBedIndex={selectedBedIndex}
                  onSelectBed={selectBed}
                  laneClockRef={laneClockRef}
                  timelineSeekRef={timelineSeekRef}
                  a1Visible={a1Visible}
                  onToggleA1={toggleA1Visible}
                  a1Muted={a1Muted}
                  noiseEnabled={noiseEnabled}
                  barSlot={timelineBarSlot}
                  toolbar={editToolbar}
                  onFootageLoss={handleFootageLoss}
                  onSourceError={handlePlaybackSourceError}
                />
              </div>
            )}
            {centerTab === 'assistant' && (
              <div data-tour="agentDock" className="flex-1 min-h-0 flex flex-col">
                <ChatPanel onResult={handleEditResult} selectedClipName={selectedClip?.sourceName} />
              </div>
            )}
            {centerTab === 'reformat' && (
              <div className="flex-1 min-h-0 flex flex-col">
                <ReformatPanel onRendered={refresh} />
              </div>
            )}
            {centerTab === 'actions' && (
              <div data-tour="agentDock" className="flex-1 min-h-0 flex flex-col">
                <LogPanel messages={logMessages} />
              </div>
            )}
          </div>
        </div>

        {/* Drag handle to resize the right panel — same seam rule as the left. */}
        <PanelDivider onPointerDown={startResize('right')} dragging={resizingSide === 'right'} />

        {/* Right: Rendered output + media info */}
        <div
          style={{ width: rightPanelWidth }}
          data-tour="rightColumn"
          className="flex flex-col gap-2 p-2 overflow-y-auto shrink-0"
        >
          <OutputPanel files={outputFiles} inUseNames={inUseOutputNames} onCleared={refresh} />
        </div>
      </div>

      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}

      {footageLoss && (
        <FootageLossDialog
          lostSec={footageLoss.lostSec}
          sourceName={footageLoss.sourceName}
          onClose={handleFootageLossClose}
        />
      )}

      {showFfmpegSettings && (
        <FfmpegCustomSettings
          onClose={() => setShowFfmpegSettings(false)}
          onSettingsChange={({ presets, quality }) => {
            setExportPresets(presets)
            if (quality) setExportQuality(quality)
          }}
        />
      )}

      {showLibrary && (
        <ProjectLibrary
          onOpen={handleLibraryOpen}
          // Renaming the project that's currently open has to follow it here:
          // `projectName` is the file Save overwrites, so leaving it stale would
          // re-create the old name on the next Save.
          onRenamed={(from, to) => setProjectName(p => (p === from ? to : p))}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {showRenderDialog && (
        // "Render without audio" is offered on every target, not just V2: a V1
        // (or A/B) render is just as often wanted as picture only.
        // handleRenderConfirm drops the A1 bed and the room-tone fill when it's
        // checked — the backend rejects no-audio combined with either.
        <RenderDialog
          defaultName={(() => {
            const sourceClips = renderTarget === 'v2' ? track2Clips : timelineClips
            const base = sourceClips[0]?.sourceName || 'render.mp4'
            const dot = base.lastIndexOf('.')
            const stem = dot > 0 ? base.slice(0, dot) : base
            if (renderTarget === 'v2') return `${stem}-analyzed.mp4`
            if (renderTarget === 'composite') return `${stem}-composite.mp4`
            return `${stem}.mp4`
          })()}
          // Non-zero only for a 1+ V2 Render, which turns the one name below
          // into that many numbered files — the dialog previews them. V1 Render
          // never splits, so it never passes a count.
          //
          // GROUPS, not clips, and for the same reason renderShots iterates
          // groups: a fused run is one clip to the user and lands as one file.
          // Counting clips here would preview N names while G files appear —
          // and shotOutputNames derives its zero-pad width from this number,
          // so a wrong count also renames every file in the series.
          shotCount={renderTarget !== 'v1' && v2ShotMode === '1+'
            ? fuseGroups(renderTarget === 'v2' ? track2Clips : timelineClips).length
            : 0}
          // The clip name behind each shot, for the dialog's V1 name box —
          // through the same helper renderShots names the files with, off the
          // same track it renders (V2's clips in A, V1's in A/B), so a preview
          // can't credit a file to a clip the render wouldn't.
          shotStems={renderTarget !== 'v1' && v2ShotMode === '1+'
            ? shotStemsFor(renderTarget === 'v2' ? track2Clips : timelineClips)
            : []}
          showNoAudioOption
          onConfirm={handleRenderConfirm}
          onCancel={() => setShowRenderDialog(false)}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <MediaProvider>
      <TourProvider>
        <AppInner />
      </TourProvider>
    </MediaProvider>
  )
}
