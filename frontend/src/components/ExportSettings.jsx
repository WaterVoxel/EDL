import { useState, useEffect } from 'react'
import { getExportSettings, setExportSettings, browseDirectory } from '../api'

const QUALITY_HINTS = {
  lossless: 'Bit-exact copy of every pixel — largest files (often 2-3× the source size).',
  match: 'Targets the source\'s own bitrate — output size ≈ source size.',
  high: 'CRF 18, visually lossless — usually smaller than the source.',
  under50mb: 'Guarantees the file stays under 50MB (verified after encoding, not just estimated) — two-pass encoding spends every available bit on quality within that hard cap. Only reaches for this when the other modes would exceed 50MB.',
  under50mb_hevc: 'Same 50MB guarantee, but H.265/10-bit instead of H.264 — noticeably better quality at the same size, at the cost of a much slower two-pass encode. Not natively browser-playable, so in-app preview transcodes it to H.264 on the fly.',
  custom: 'The same size-verified two-pass encode, but every flag is yours: cap, codec, preset, profile, pixel format, rate-control multipliers and raw extra args. Edit them in the FFmpeg Custom Settings window (the gear in the top bar), where they can also be saved as named presets.',
}

// The exact ffmpeg flags each quality mode passes, mirroring encode_args()
// and render_size_capped() in ffmpeg_utils.py. Values that depend on the
// source file or render duration are shown as <placeholders> rather than
// invented numbers, since this panel has no specific file loaded.
const FFMPEG_SETTINGS = {
  lossless: [
    '-c:v libx264',
    '-qp 0  (constant quantizer — round-trips bit-exact even for 10-bit sources; -crf 0 does not)',
    '-preset medium',
    '-c:a aac  -b:a <source bitrate, min 192kbps>  -ar <source rate>  -ac <source channels>',
  ],
  match: [
    '-c:v libx264',
    '-b:v <source\'s own video bitrate>',
    '-maxrate <1.5× that bitrate>  -bufsize <2× that bitrate>',
    '-preset medium',
    '(falls back to -crf 18 if the source reports no usable bitrate)',
    '-c:a aac  -b:a <source bitrate, min 192kbps>  -ar <source rate>  -ac <source channels>',
  ],
  high: [
    '-c:v libx264',
    '-crf 18  (visually lossless)',
    '-preset medium',
    '-c:a aac  -b:a <source bitrate, min 192kbps>  -ar <source rate>  -ac <source channels>',
  ],
  under50mb: [
    'Two-pass encode, bitrate computed from the render\'s duration to fit under 50MB:',
    'Pass 1 — -c:v libx264 -b:v <computed> -maxrate <1.1×> -bufsize <2×> -preset slow -pass 1 -passlogfile <tmp> -an -f null',
    'Pass 2 — same -c:v/-b:v/-maxrate/-bufsize -pass 2 -passlogfile <tmp>',
    '-c:a aac  -b:a <computed, min 96kbps>  -ar <source rate>  -ac <source channels>',
    'Real output size is measured after encoding; bitrate shrinks 15% and retries (up to 4 attempts) if it still overshoots.',
  ],
  under50mb_hevc: [
    'Same two-pass, size-verified approach as "Under 50MB", but:',
    '-c:v libx265  -profile:v main10  (10-bit yuv420p10le intermediate)',
    '-b:v <computed>  -maxrate <1.1×>  -bufsize <2×>  -preset medium',
    'Two-pass via -x265-params "pass=1:stats=<tmp>" / "pass=2:stats=<tmp>"  (libx265 has no -pass/-passlogfile)',
    '-c:a aac  -b:a <computed, min 96kbps>  -ar <source rate>  -ac <source channels>',
    'Not browser-playable — in-app preview transcodes it to H.264 on the fly.',
  ],
  // The only mode whose flags aren't fixed here, so this lists the shape and
  // the panel prints the configured values underneath (see `custom` state).
  custom: [
    'Two-pass, size-verified, with every value taken from the FFmpeg Custom Settings window (gear, top bar):',
    'Pass 1 — -c:v <codec> -b:v <computed> -maxrate <mult×> -bufsize <mult×> -preset <preset> [-profile:v <profile>] <extra args> -an -f null /dev/null',
    'Pass 2 — the same flags plus the stats file and the audio track',
    'bitrate = (target bytes × 8 × safety) ÷ duration ÷ 1000, with the whole budget given to video',
    '-c:a aac  -b:a <source bitrate, min 96kbps>  -ar <source rate>  -ac <source channels>',
    'Size is measured after encoding; bitrate shrinks 15% and retries (up to 4 attempts) if it overshoots.',
  ],
}

export default function ExportSettings({ onClose }) {
  const [dir, setDir] = useState('')
  const [defaultDir, setDefaultDir] = useState('')
  const [quality, setQuality] = useState('lossless')
  const [saving, setSaving] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState(null)
  const [showFfmpegInfo, setShowFfmpegInfo] = useState(false)
  // Read-only here: the custom mode's values are edited in the gear window.
  // This panel only reports what they currently are, so picking "Custom" isn't
  // a jump into the unknown.
  const [custom, setCustom] = useState(null)

  useEffect(() => {
    getExportSettings().then(data => {
      setDir(data.output_dir || '')
      setDefaultDir(data.default_output_dir || '')
      setQuality(data.quality || 'lossless')
      setCustom(data.custom || null)
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    const result = await setExportSettings({ output_dir: dir.trim(), quality })
    setSaving(false)
    if (result.error) {
      setError(result.error)
    } else {
      onClose()
    }
  }

  async function handleBrowse() {
    setBrowsing(true)
    setError(null)
    const result = await browseDirectory(dir || defaultDir)
    setBrowsing(false)
    if (result.error) {
      setError(result.error)
    } else if (!result.cancelled && result.path) {
      setDir(result.path)
    }
  }

  function handleReset() {
    setDir('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-4 w-96 flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-neutral-200">Export Settings</h3>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-neutral-400">Export quality</label>
            <button
              onClick={() => setShowFfmpegInfo(v => !v)}
              title="Show ffmpeg settings for this mode"
              className="w-4 h-4 flex items-center justify-center rounded text-[11px] leading-none text-neutral-500 hover:text-yellow-300 hover:bg-neutral-700"
            >
              💡
            </button>
          </div>
          <select
            value={quality}
            onChange={e => { setQuality(e.target.value); setShowFfmpegInfo(false) }}
            className="px-2 py-1.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
          >
            <option value="lossless">Lossless (bit-exact, largest)</option>
            <option value="match">Match source (≈ source size)</option>
            <option value="high">High quality (visually lossless, smallest)</option>
            <option value="under50mb">Under 50MB (max quality within a hard size cap)</option>
            <option value="under50mb_hevc">Under 50MB (HEVC, higher quality, slower)</option>
            <option value="custom">Custom (your own two-pass encode settings)</option>
          </select>
          <p className="text-[9px] text-neutral-500">{QUALITY_HINTS[quality]}</p>
          {quality === 'custom' && custom && (
            <p className="text-[9px] text-emerald-400 font-mono">
              {custom.target_mib} MiB · {custom.codec} · {custom.preset} · {custom.profile} ·{' '}
              {custom.pix_fmt} · safety {custom.safety} · maxrate {custom.maxrate_mult}× · bufsize{' '}
              {custom.bufsize_mult}×{custom.extra_args ? ` · ${custom.extra_args}` : ''}
            </p>
          )}
          {showFfmpegInfo && (
            <ul className="mt-1 p-2 rounded bg-neutral-950 border border-neutral-700 text-[9px] text-neutral-400 font-mono flex flex-col gap-1 list-disc list-inside">
              {FFMPEG_SETTINGS[quality].map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-neutral-400">Export directory</label>
          <div className="flex gap-1.5">
            <input
              value={dir}
              onChange={e => setDir(e.target.value)}
              placeholder={defaultDir}
              className="flex-1 px-2.5 py-1.5 text-[11px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
            />
            <button
              onClick={handleBrowse}
              disabled={browsing}
              title="Browse for folder"
              className="px-2 py-1.5 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-50"
            >
              {browsing ? '…' : 'Browse'}
            </button>
          </div>
          <p className="text-[9px] text-neutral-500">
            Leave empty to use the default: <span className="text-neutral-400">{defaultDir}</span>
          </p>
          {dir && (
            <button
              onClick={handleReset}
              className="self-start text-[9px] text-neutral-500 hover:text-neutral-300 underline"
            >
              Reset to default
            </button>
          )}
        </div>

        {error && <p className="text-[10px] text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onClose}
            className="px-3 py-1 text-[11px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 text-[11px] rounded bg-indigo-600 text-white hover:bg-indigo-500 font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
