import { useEffect, useRef, useState } from 'react'
import { getExportSettings, setExportSettings } from '../api'
import {
  settingsToForm, formToSettings, matchingPresetName,
  profileForCodec, profileForPixFmt, previewBitrate,
} from '../exportPresets'

/* The FFmpeg Custom Settings window — the top bar's gear button.
 *
 * This edits ONE quality mode: "custom" (fu.EXPORT_QUALITIES), a two-pass
 * size-capped export whose flags come from these fields instead of being
 * hardcoded in ffmpeg_utils.py like every other mode's. Applying anything here
 * also switches the export quality to "custom", so the next Render uses it —
 * that is the whole point of the window, and the sibling Export Settings dialog
 * (Export Bin's ⚙) is where you switch back to Lossless/Match/High.
 *
 * Two things about this mode worth knowing while reading the fields:
 *   - The bitrate is (target_bytes × 8 × safety) ÷ duration ÷ 1000, and the
 *     WHOLE byte budget goes to video — the AAC track is muxed on top of it.
 *     The safety headroom is what absorbs that (and container overhead), and
 *     the backend's measure-and-retry loop is what actually guarantees the cap.
 *   - maxrate defaults BELOW the average bitrate (0.95×), so VBV holds the real
 *     output a little under target rather than letting it drift over. With the
 *     0.90 default headroom, expect files at roughly 0.85 of the cap.
 *
 * Named presets live in .export_settings.json AND ride along inside the .nara
 * project file (App.jsx's buildProject), so a project carries its delivery
 * settings with it. Import/Export here are plain client-side JSON files, the
 * same blob-download / hidden-file-input pair the project Export/Import uses.
 *
 * Every dropdown's contents come from the server (custom_options) rather than
 * being duplicated here: the lists are exactly what fu.normalize_export_settings
 * will accept, so the UI cannot offer a value the backend then rejects.
 *
 * The settings-shape logic — form conversion, preset identity, the codec/profile
 * /pixel-format coherence rules, the bitrate preview — lives in
 * ../exportPresets.js so it can be tested without a DOM.
 */

// The reference duration the flag preview is computed at. A render's real
// duration isn't known here (no timeline in scope), and showing the formula
// against one concrete number is far more legible than showing the formula
// alone — 60 s is short enough to keep the arithmetic checkable by eye.
const PREVIEW_SEC = 60

const FILE_KIND = 'nara-export-settings'

export default function FfmpegCustomSettings({ onClose, onSettingsChange }) {
  const [form, setForm] = useState(null)
  const [options, setOptions] = useState(null)
  const [defaults, setDefaults] = useState(null)
  const [presets, setPresets] = useState([])
  const [selected, setSelected] = useState('')   // preset name shown in the dropdown
  const [name, setName] = useState('')           // the Name field, for Save/Export
  const [quality, setQuality] = useState('lossless')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState(null)
  const importRef = useRef(null)

  useEffect(() => {
    getExportSettings().then(data => {
      setForm(settingsToForm(data.custom))
      setOptions(data.custom_options)
      setDefaults(data.custom_defaults)
      setPresets(data.presets || [])
      setQuality(data.quality || 'lossless')
      const active = matchingPresetName(data.presets || [], data.custom)
      setSelected(active)
      setName(active)
    })
  }, [])

  function field(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setStatus(null)
    setError(null)
  }

  // Bit depth has to agree between profile and pixel format or the encoder
  // aborts mid-render (the backend rejects the pair outright), so these two
  // dropdowns correct each other instead of letting an invalid pair be typed
  // in and only fail on Apply.
  function pickCodec(codec) {
    setForm(f => ({ ...f, codec, profile: profileForCodec(f.profile, codec, options) }))
    setStatus(null)
    setError(null)
  }

  function pickPixFmt(pixFmt) {
    setForm(f => ({
      ...f,
      pix_fmt: pixFmt,
      profile: profileForPixFmt(f.profile, pixFmt, f.codec, options),
    }))
    setStatus(null)
    setError(null)
  }

  async function post(body, okMessage) {
    setBusy(true)
    setError(null)
    setStatus(null)
    const result = await setExportSettings(body)
    setBusy(false)
    if (result.error) { setError(result.error); return null }
    if (result.presets) setPresets(result.presets)
    if (result.quality) setQuality(result.quality)
    onSettingsChange?.({ presets: result.presets || [], quality: result.quality })
    if (okMessage) setStatus(okMessage)
    return result
  }

  // Selecting a preset loads it into the form AND makes it the settings the
  // next export uses — the dropdown is the switch, not just a form filler.
  async function handleSelect(presetName) {
    setSelected(presetName)
    if (!presetName) return
    const preset = presets.find(p => p.name === presetName)
    if (!preset) return
    setForm(settingsToForm(preset.settings))
    setName(preset.name)
    await post({ custom: preset.settings, quality: 'custom' },
               `Loaded "${preset.name}" — exports use it now`)
  }

  async function handleSavePreset() {
    const trimmed = name.trim()
    if (!trimmed) { setError('Give the preset a name first'); return }
    const settings = formToSettings(form)
    // Case-insensitive collision check, because macOS's own default
    // filesystem is case-insensitive and the backend rejects "A" + "a" as
    // duplicates — better to ask than to be refused.
    const existing = presets.find(p => p.name.toLowerCase() === trimmed.toLowerCase())
    if (existing && !window.confirm(`Overwrite the saved preset "${existing.name}"?`)) return
    const next = existing
      ? presets.map(p => (p === existing ? { name: existing.name, settings } : p))
      : [...presets, { name: trimmed, settings }]
    const result = await post({ presets: next }, `Saved "${existing ? existing.name : trimmed}"`)
    if (result) setSelected(existing ? existing.name : trimmed)
  }

  async function handleDeletePreset() {
    if (!selected) return
    if (!window.confirm(`Delete the saved preset "${selected}"? The current settings stay as they are.`)) return
    const result = await post({ presets: presets.filter(p => p.name !== selected) },
                              `Deleted "${selected}"`)
    if (result) { setSelected(''); setName('') }
  }

  async function handleApply() {
    const result = await post({ custom: formToSettings(form), quality: 'custom' })
    if (result) onClose()
  }

  async function handleStopUsing() {
    await post({ quality: 'lossless' }, 'Exports are back to Lossless')
  }

  function handleExportFile() {
    const label = name.trim() || 'ffmpeg-export-settings'
    const settings = formToSettings(form)
    // Nothing validates a file on its way out, so a half-typed field would
    // become a JSON `null` that only fails on some later import. Refuse now.
    const blank = Object.keys(settings).find(k => typeof settings[k] === 'number' && Number.isNaN(settings[k]))
    if (blank) { setError(`${blank} is empty — fill it in before exporting`); return }
    const payload = { kind: FILE_KIND, version: 1, name: label, settings }
    setError(null)
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${label.replace(/[^\w.-]+/g, '_')}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus(`Wrote ${link.download}`)
  }

  async function handleImportFile(file) {
    if (!file) return
    let payload
    try {
      payload = JSON.parse(await file.text())
    } catch {
      setError('That file is not valid JSON')
      return
    }
    if (!payload || typeof payload !== 'object' || !payload.settings) {
      setError('That file has no export settings in it')
      return
    }
    const label = (payload.name || file.name.replace(/\.json$/i, '')).trim() || 'Imported'
    setForm(settingsToForm({ ...defaults, ...payload.settings }))
    setName(label)
    // The imported settings go straight into the dropdown, so the round trip
    // ends where a saved preset would. The backend validates them here — an
    // edited-by-hand file is caught now rather than at Render.
    const existing = presets.find(p => p.name.toLowerCase() === label.toLowerCase())
    const entry = { name: existing ? existing.name : label, settings: { ...defaults, ...payload.settings } }
    const next = existing ? presets.map(p => (p === existing ? entry : p)) : [...presets, entry]
    const result = await post({ presets: next }, `Imported "${entry.name}"`)
    if (result) setSelected(entry.name)
  }

  const loading = !form || !options

  // The exact flags this form produces for a PREVIEW_SEC render, so the
  // multipliers and the formula are visible rather than described.
  const preview = loading ? null : previewBitrate(form, PREVIEW_SEC)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl w-[34rem] max-h-[88vh] flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-200">FFmpeg Custom Settings</h3>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-white hover:bg-neutral-700 text-[13px]"
          >×</button>
        </div>

        {loading ? (
          <p className="px-4 py-6 text-[11px] text-neutral-500">Loading…</p>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            <p className="text-[10px] text-neutral-500 leading-relaxed">
              Two-pass ABR under a hard size cap, verified by measuring the finished file (it
              re-encodes at a lower bitrate if it overshoots). Applying makes these the flags every
              Render uses, in place of the built-in quality modes.
            </p>

            {/* ---- saved presets ---- */}
            <div className="flex flex-col gap-1.5 pb-3 border-b border-neutral-800">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Saved presets</span>
              <div className="flex gap-1.5">
                <select
                  value={selected}
                  onChange={e => handleSelect(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">— none —</option>
                  {presets.map(p => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.settings.codec}, {p.settings.target_mib} MiB)
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleDeletePreset}
                  disabled={!selected || busy}
                  title="Delete the selected preset"
                  className="px-2 py-1.5 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-500 disabled:opacity-40"
                >Delete</button>
              </div>
              <div className="flex gap-1.5">
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Name these settings…"
                  className="flex-1 min-w-0 px-2 py-1.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  onClick={handleSavePreset}
                  disabled={busy}
                  title="Save the settings below under this name"
                  className="px-2.5 py-1.5 text-[10px] rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
                >Save</button>
                <button
                  onClick={handleExportFile}
                  title="Write these settings out to a .json file"
                  className="px-2 py-1.5 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500"
                >Export</button>
                <button
                  onClick={() => importRef.current?.click()}
                  disabled={busy}
                  title="Load a settings file and add it to the dropdown"
                  className="px-2 py-1.5 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-40"
                >Import</button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={e => { handleImportFile(e.target.files?.[0]); e.target.value = '' }}
                />
              </div>
              <p className="text-[9px] text-neutral-500">Presets are saved with the project too, so a .nara file carries its delivery settings.</p>
            </div>

            {/* ---- size cap ----
                Plain text inputs rather than the toolbar's NumericStepper: these
                are typed-once configuration values spanning 0.1 to a million,
                not frame-by-frame nudges, and the stepper's w-11 box would
                truncate them. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Size cap</span>
              <div className="flex gap-3">
                <label className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-400">Target size (MiB)</span>
                  <input
                    value={form.target_mib}
                    onChange={e => field('target_mib', e.target.value)}
                    inputMode="decimal"
                    className="px-2 py-1.5 text-[11px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
                <label className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-400">Safety headroom</span>
                  <input
                    value={form.safety}
                    onChange={e => field('safety', e.target.value)}
                    inputMode="decimal"
                    className="px-2 py-1.5 text-[11px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
              </div>
              <p className="text-[9px] text-neutral-500">
                The cap is hard — the finished file is measured against it. Headroom is the fraction of
                the budget actually spent (0.90 leaves 10% for container overhead and for the audio
                track, which is muxed on top of the video bitrate rather than taken out of it).
              </p>
            </div>

            {/* ---- codec ---- */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Codec</span>
              <div className="flex gap-3">
                <label className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-400">Codec</span>
                  <select
                    value={form.codec}
                    onChange={e => pickCodec(e.target.value)}
                    className="px-2 py-1.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                  >
                    {options.codecs.map(c => (
                      <option key={c} value={c}>{c === 'libx265' ? 'libx265 (HEVC)' : 'libx264 (H.264)'}</option>
                    ))}
                  </select>
                </label>
                <label className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-400">Preset</span>
                  <select
                    value={form.preset}
                    onChange={e => field('preset', e.target.value)}
                    className="px-2 py-1.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                  >
                    {options.encoder_presets.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex gap-3">
                <label className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-400">Profile</span>
                  <select
                    value={form.profile}
                    onChange={e => field('profile', e.target.value)}
                    className="px-2 py-1.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                  >
                    {(options.profiles[form.codec] || []).map(p => (
                      <option key={p} value={p}>{p === 'auto' ? 'auto (from pixel format)' : p}</option>
                    ))}
                  </select>
                </label>
                <label className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-400">Pixel format</span>
                  <select
                    value={form.pix_fmt}
                    onChange={e => pickPixFmt(e.target.value)}
                    className="px-2 py-1.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                  >
                    {options.pix_fmts.map(p => (
                      <option key={p} value={p}>
                        {p}{options.ten_bit_pix_fmts.includes(p) ? ' (10-bit)' : ' (8-bit)'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-[9px] text-neutral-500">
                Software encoding only — this is an Apple Silicon target, and VideoToolbox has no
                two-pass mode. p010le is accepted but converted: libx265 itself only takes
                yuv420p10le. Profile and pixel format follow each other so their bit depths agree.
              </p>
            </div>

            {/* ---- rate control ---- */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Rate control</span>
              <div className="flex gap-3">
                <label className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-400">maxrate × bitrate</span>
                  <input
                    value={form.maxrate_mult}
                    onChange={e => field('maxrate_mult', e.target.value)}
                    inputMode="decimal"
                    className="px-2 py-1.5 text-[11px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
                <label className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-400">bufsize × bitrate</span>
                  <input
                    value={form.bufsize_mult}
                    onChange={e => field('bufsize_mult', e.target.value)}
                    inputMode="decimal"
                    className="px-2 py-1.5 text-[11px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-200 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
              </div>
              <p className="text-[9px] text-neutral-500 font-mono">
                bitrate = (target × 8 × safety) ÷ duration ÷ 1000
              </p>
              {preview && (
                <p className="text-[9px] text-neutral-400 font-mono">
                  a {PREVIEW_SEC}s render → -b:v {preview.kbps}k  -maxrate {preview.maxrate}k  -bufsize {preview.bufsize}k
                </p>
              )}
            </div>

            {/* ---- extra args ---- */}
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Advanced extra args</span>
              <input
                value={form.extra_args}
                onChange={e => field('extra_args', e.target.value)}
                placeholder="-tag:v hvc1 -movflags +faststart"
                className="px-2 py-1.5 text-[11px] font-mono rounded bg-neutral-950 border border-neutral-700 text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-[9px] text-neutral-500">
                Raw ffmpeg flags, added to both passes and checked by the same validator the
                assistant's commands go through. Flags this window already owns (-c:v, -b:v, -preset,
                -vf, -pass…) are refused. Worth knowing:{' '}
                <span className="font-mono text-neutral-400">-tag:v hvc1</span> is what makes an HEVC
                .mp4 play in QuickTime and Finder.
              </p>
            </div>

            {/* ---- state ---- */}
            <div className="flex flex-col gap-1 pt-1">
              {quality === 'custom' ? (
                <p className="text-[10px] text-emerald-400">
                  Active — every Render and export uses these settings.{' '}
                  <button onClick={handleStopUsing} disabled={busy} className="underline text-neutral-400 hover:text-neutral-200 disabled:opacity-50">
                    Stop using
                  </button>
                </p>
              ) : (
                <p className="text-[10px] text-neutral-500">
                  Not active — exports currently use the <span className="text-neutral-300">{quality}</span> mode.
                  Apply to switch to these settings.
                </p>
              )}
              {status && <p className="text-[10px] text-neutral-400">{status}</p>}
              {error && <p className="text-[10px] text-red-400">{error}</p>}
            </div>
          </div>
        )}

        <div className="shrink-0 flex justify-between items-center gap-2 px-4 py-2 border-t border-neutral-800">
          <button
            onClick={() => defaults && setForm(settingsToForm(defaults))}
            disabled={loading}
            className="text-[9px] text-neutral-500 hover:text-neutral-300 underline disabled:opacity-40"
          >
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-[11px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200"
            >
              Close
            </button>
            <button
              onClick={handleApply}
              disabled={busy || loading}
              className="px-3 py-1 text-[11px] rounded bg-emerald-600 text-white hover:bg-emerald-500 font-medium disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Apply & use for export'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
