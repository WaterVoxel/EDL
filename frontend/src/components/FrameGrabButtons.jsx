import { useRef, useState } from 'react'
import { useMedia } from '../context/MediaContext'
import { formatTimecode } from '../timecode'

/* The Preview header's two icon-only frame grabs: save the current frame as a
 * PNG, or put it on the clipboard. They replaced the header's "Preview" label,
 * which said nothing the panel's position didn't already say.
 *
 * Both read the SHARED <video> (MediaContext's videoRef — the center preview
 * the timeline playback engine drives), not the clip data, so the image is
 * exactly the frame on screen, at full source resolution rather than at the
 * size the preview happens to be scaled to. Two consequences to know:
 *   - V2 overlay layers and the crop box are NOT baked in. Those are separate
 *     DOM elements sitting OVER the video (OverlayPreview / CropOverlay), not
 *     pixels inside it; compositing them here would mean reimplementing the
 *     render's overlay/crop math against a canvas. Render V2 in A/B mode is
 *     what bakes an overlay into pixels.
 *   - The PNG is whatever the browser decoded — frame-exact, but no more
 *     color-managed than the preview itself. For a bit-exact still, render.
 *
 * The capture crops to activePreview.info's TRUE width/height instead of the
 * element's videoWidth/videoHeight, mirroring what PreviewPlayer's clip-path
 * does on screen: a bitstream padded out to a 16px macroblock boundary would
 * otherwise put that padding fringe into the PNG (see the comment there).
 *
 * Canvas tainting isn't a risk — every source is same-origin through the Vite
 * proxy (/input, /output, /preview), so the canvas stays readable.
 */

const FLASH_MS = 1400

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 19.5h16" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M6 15.5H5.5A2 2 0 0 1 3.5 13.5V5.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2V6" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  )
}

export default function FrameGrabButtons() {
  const { videoRef, activePreview } = useMedia()
  // An icon-only button has no room for a status line, so the result is a
  // short color + icon flash, with the full message in the tooltip until it
  // clears. { which: 'save'|'copy', ok: bool, msg }.
  const [flash, setFlash] = useState(null)
  const timerRef = useRef(null)

  function signal(which, ok, msg) {
    clearTimeout(timerRef.current)
    setFlash({ which, ok, msg })
    timerRef.current = setTimeout(() => setFlash(null), FLASH_MS)
  }

  // The frame as a canvas at the source's true display size, or null when
  // there's nothing decoded yet. Not gated on a disabled prop: whether the
  // shared element holds a decodable frame isn't React state (the playback
  // hook assigns .src imperatively), so the check happens at click time and
  // reports through the same flash the successes use.
  function grabCanvas() {
    const video = videoRef.current
    if (!video || !video.videoWidth || video.readyState < 2) return null
    const w = Math.min(activePreview?.info?.width || video.videoWidth, video.videoWidth)
    const h = Math.min(activePreview?.info?.height || video.videoHeight, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h, 0, 0, w, h)
    return canvas
  }

  function frameName() {
    const stem = (activePreview?.name || 'frame').replace(/\.[^.]+$/, '')
    const fps = activePreview?.info?.fps || 30
    // Colons are legal in macOS filenames but Finder displays them as "/",
    // so the timecode goes in dash-separated.
    const tc = formatTimecode(videoRef.current?.currentTime || 0, fps).replace(/:/g, '-')
    return `${stem}_${tc}.png`
  }

  function handleDownload() {
    const canvas = grabCanvas()
    if (!canvas) { signal('save', false, 'No frame in the preview yet'); return }
    const name = frameName()
    canvas.toBlob(blob => {
      if (!blob) { signal('save', false, 'Could not encode the frame'); return }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Revoked on a delay, not synchronously: WebKit can cancel a download
      // whose blob URL is released before it has finished reading it.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      signal('save', true, `Saved ${name} (${canvas.width}×${canvas.height})`)
    }, 'image/png')
  }

  async function handleCopy() {
    const canvas = grabCanvas()
    if (!canvas) { signal('copy', false, 'No frame in the preview yet'); return }
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      signal('copy', false, "This browser can't put images on the clipboard — use the download button")
      return
    }
    try {
      // ClipboardItem is handed the toBlob PROMISE rather than an awaited
      // blob on purpose: WebKit only honors clipboard.write inside the
      // click's own turn, so awaiting the PNG encode first would make it
      // reject as a write without a user gesture. Chrome and Safari both
      // accept Promise<Blob> as an item value.
      const blob = new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('could not encode the frame'))), 'image/png')
      })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      signal('copy', true, `Copied ${canvas.width}×${canvas.height} frame — paste it anywhere`)
    } catch (e) {
      signal('copy', false, 'Copy failed: ' + (e?.message || e))
    }
  }

  const sizeNote = activePreview?.info?.width
    ? ` (${activePreview.info.width}×${activePreview.info.height})`
    : ''
  // Emerald/red mirror the rest of the app: success and destructive/failed.
  function tone(which) {
    if (flash?.which !== which) return 'text-neutral-400 hover:text-white hover:bg-neutral-700'
    return flash.ok ? 'text-emerald-400' : 'text-red-400'
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Same label styling the header's old "Preview" span had, and the one
          the toolbar rows use for their group names — it says what the two
          icons act on rather than what the panel is. */}
      <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap">IMAGE</span>
      {/* The pair keeps its own tighter gap so they read as one group next to
          the label, rather than as three evenly spaced items. */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={handleDownload}
          title={flash?.which === 'save'
            ? flash.msg
            : `Download this frame as a PNG${sizeNote} — full source resolution, without the crop box or V2 overlay layers`}
          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${tone('save')}`}
        >
          {flash?.which === 'save' && flash.ok ? <CheckIcon /> : <DownloadIcon />}
        </button>
        <button
          onClick={handleCopy}
          title={flash?.which === 'copy'
            ? flash.msg
            : `Copy this frame to the clipboard${sizeNote} — paste it into another app`}
          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${tone('copy')}`}
        >
          {flash?.which === 'copy' && flash.ok ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  )
}
