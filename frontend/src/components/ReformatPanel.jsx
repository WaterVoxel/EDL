import { useState } from 'react'
import { reformat } from '../api'
import { useMedia } from '../context/MediaContext'
import { REFORMAT_RESOLUTIONS, REFORMAT_RATIOS, reformatOutputDims } from '../reformatMath'
import RenderDialog from './RenderDialog'
import TechInfoPanel from './TechInfoPanel'

function stem(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

// Reformat is a one-shot, non-timeline operation on whatever's currently
// selected in the Media Bin (never modified — Render always writes a
// brand-new file): pick a resolution tier + aspect ratio and scale down
// to fit inside that combination's bounding box (contain-fit, no upscale,
// no letterboxing — see reformatMath.js / ffmpeg_utils.reformat_scale_dims).
// "adaptive" ratio keeps the source's OWN aspect ratio instead of
// reshaping to one of the 6 fixed ratios (reformat_adaptive_dims).
// Deliberately no video picker of its own — MediaLibrary.jsx already
// writes the clicked file into the shared MediaContext's activePreview,
// so this just reads that instead of re-implementing selection.
// Three columns, left to right: selected-clip info (mirrors Media Info
// In/Out via the same TechInfoPanel), the video itself, then the
// reformat controls + Render — reading left to right as "what" / "look
// at it" / "do the thing," the same order Trim etc. implicitly follow
// (select on the left panels, act via the toolbar on the right).
export default function ReformatPanel({ onRendered }) {
  // Reformat operates on the MEDIA BIN selection (binSelection), not the
  // center preview's activePreview — the two are decoupled so bin picks
  // don't disturb the timeline preview.
  const { binSelection } = useMedia()
  const [resolution, setResolution] = useState('720p')
  const [ratio, setRatio] = useState('16:9')
  const [showDialog, setShowDialog] = useState(false)
  const [rendering, setRendering] = useState(false)

  const previewUrl = binSelection
    ? (binSelection.info?.browser_playable === false
      ? `/preview/${binSelection.dir}/${encodeURIComponent(binSelection.name)}`
      : `/${binSelection.dir}/${encodeURIComponent(binSelection.name)}`)
    : null

  const outDims = binSelection?.info
    ? reformatOutputDims(resolution, ratio, binSelection.info.width, binSelection.info.height)
    : null

  const infoForPanel = binSelection?.info ? { ...binSelection.info, _name: binSelection.name } : null

  async function handleConfirm(outputName) {
    setShowDialog(false)
    setRendering(true)
    try {
      const result = await reformat(binSelection.name, binSelection.dir, resolution, ratio, outputName)
      if (result.error) { alert('Reformat failed: ' + result.error + (result.detail ? '\n' + result.detail : '')); return }
      onRendered()
    } finally {
      setRendering(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex gap-2">
      {/* Left: selected-clip metadata — same component/shape as Media Info
          In/Out, own scroll so a tall info panel never squeezes the other
          two columns in this short, fixed-height dock. */}
      <div className="w-64 shrink-0 min-h-0 overflow-y-auto">
        <TechInfoPanel info={infoForPanel} title="Selected Clip" />
      </div>

      {/* Middle: the video. Fills whatever height/width this column has
          (this panel lives in the short, fixed-height, overflow-hidden
          Timeline/AGENT/Actions dock — pinned to Timeline's own content
          height, floored at 224px — so an aspect-ratio/vh-based box here
          would overflow instead of fitting it). */}
      <div className="flex-1 min-h-0 min-w-0 rounded-md bg-black border border-neutral-800 flex items-center justify-center">
        {previewUrl
          ? <video key={previewUrl} src={previewUrl} controls className="max-w-full max-h-full object-contain" />
          : <span className="text-[10px] text-neutral-600">Select a video in the Media Bin</span>}
      </div>

      {/* Right: reformat controls + Render. */}
      <div className="w-56 shrink-0 min-h-0 flex flex-col gap-2 rounded-md bg-neutral-900 border border-neutral-800 p-2.5">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Reformat</span>
        {!binSelection && (
          <p className="text-[10px] text-neutral-600">Select a video in the Media Bin to reformat it.</p>
        )}
        <label className="text-[10px] text-neutral-400">Resolution</label>
        <select
          value={resolution}
          onChange={e => setResolution(e.target.value)}
          className="px-2 py-1 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-300"
        >
          {REFORMAT_RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <label className="text-[10px] text-neutral-400">Aspect ratio</label>
        <select
          value={ratio}
          onChange={e => setRatio(e.target.value)}
          className="px-2 py-1 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-300"
        >
          {REFORMAT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {outDims && <span className="text-[10px] text-neutral-500">Output: {outDims.w}×{outDims.h}</span>}
        <div className="flex-1" />
        <button
          onClick={() => setShowDialog(true)}
          disabled={!binSelection || rendering}
          title="Scale the selected video down to fit the chosen aspect ratio and send it to the Export Bin"
          className="px-2.5 py-1.5 text-[11px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500"
        >
          {rendering ? 'Rendering…' : '▶ Render'}
        </button>
      </div>

      {showDialog && (
        <RenderDialog
          defaultName={`${stem(binSelection.name)}-${resolution}-${ratio.replace(':', 'x')}.mp4`}
          onConfirm={handleConfirm}
          onCancel={() => setShowDialog(false)}
        />
      )}
    </div>
  )
}
