/* Pure logic behind the FFmpeg Custom Settings window (FfmpegCustomSettings.jsx)
 * and the project's export-preset persistence (App.jsx).
 *
 * Import-clean, so node can test it directly — same arrangement as clipMath.js
 * and overlayMatch.js. The rules here mirror fu.normalize_export_settings in
 * ffmpeg_utils.py; the backend is still the authority (it validates every POST),
 * this just keeps the UI from offering it something it will refuse.
 */

// The settings keys, in wire order. Preset identity is compared over exactly
// these, and the POST body is built from exactly these — a key not listed here
// is not part of a settings dict.
export const SETTING_KEYS = ['target_mib', 'safety', 'codec', 'preset', 'profile',
                             'pix_fmt', 'maxrate_mult', 'bufsize_mult', 'extra_args']

export const NUMERIC_KEYS = ['target_mib', 'safety', 'maxrate_mult', 'bufsize_mult']

// libx265 and libx264 use different names for the same profile, so switching
// codec REMAPS rather than resetting: dropping a 10-bit setup back to "auto" on
// a codec change would quietly stop asserting 10-bit at all. main12 has no
// H.264 equivalent, so it lands on high10 (the deepest x264 offers).
const PROFILE_EQUIVALENTS = { main10: 'high10', high10: 'main10', main12: 'high10' }

/* Form values are STRINGS while the window is open — a controlled numeric input
 * has to be able to hold "0." and "" mid-typing, which a number can't. */
export function settingsToForm(settings) {
  const form = {}
  for (const key of SETTING_KEYS) form[key] = String(settings?.[key] ?? '')
  return form
}

export function formToSettings(form) {
  const settings = {}
  for (const key of SETTING_KEYS) {
    settings[key] = NUMERIC_KEYS.includes(key) ? parseFloat(form[key]) : form[key]
  }
  return settings
}

export function sameSettings(a, b) {
  return !!a && !!b && SETTING_KEYS.every(k => String(a[k] ?? '') === String(b[k] ?? ''))
}

/* Which saved preset (if any) the given settings ARE, so the dropdown can show
 * the active one without the server having to store a pointer to it — one less
 * piece of state to keep in sync with the settings themselves. */
export function matchingPresetName(presets, settings) {
  return presets.find(p => sameSettings(p.settings, settings))?.name || ''
}

/* Keep the profile valid for the codec (called when the codec dropdown moves). */
export function profileForCodec(profile, codec, options) {
  const allowed = options?.profiles?.[codec] || []
  if (allowed.includes(profile)) return profile
  const mapped = PROFILE_EQUIVALENTS[profile]
  return mapped && allowed.includes(mapped) ? mapped : 'auto'
}

/* Keep the profile's bit depth matching the pixel format's (called when the
 * pixel-format dropdown moves). The backend rejects a mismatched pair outright,
 * so correcting it here is the difference between the two dropdowns cooperating
 * and the user being refused on Apply. "auto" fits any depth and is left alone. */
export function profileForPixFmt(profile, pixFmt, codec, options) {
  if (profile === 'auto') return profile
  const tenBitPix = (options?.ten_bit_pix_fmts || []).includes(pixFmt)
  const tenBitProfiles = options?.ten_bit_profiles || []
  if (tenBitPix === tenBitProfiles.includes(profile)) return profile
  const allowed = options?.profiles?.[codec] || []
  const wanted = tenBitPix
    ? allowed.find(p => tenBitProfiles.includes(p))
    : allowed.find(p => p !== 'auto' && !tenBitProfiles.includes(p))
  return wanted || 'auto'
}

/* The flags a form would produce for a render of `durationSec`, mirroring
 * custom_target_bitrate_kbps() + render_custom_two_pass() in ffmpeg_utils.py.
 * Returns null when the fields aren't (yet) a usable number, which is the normal
 * state of a half-typed input rather than an error worth reporting. */
export function previewBitrate(form, durationSec) {
  const targetMib = parseFloat(form.target_mib)
  const safety = parseFloat(form.safety)
  const kbps = Math.trunc((targetMib * 1024 * 1024 * 8 * safety) / durationSec / 1000)
  if (!Number.isFinite(kbps) || kbps <= 0) return null
  const maxrate = Math.trunc(kbps * parseFloat(form.maxrate_mult))
  const bufsize = Math.trunc(kbps * parseFloat(form.bufsize_mult))
  if (!Number.isFinite(maxrate) || !Number.isFinite(bufsize)) return null
  return { kbps, maxrate, bufsize }
}

/* Fold a project's saved presets into the local set (App.jsx, on open/import).
 *
 * A project carries its delivery settings, but opening one must not wipe the
 * presets the user built up locally — so this merges instead of replacing, and
 * the project's copy wins a name collision (it is the more specific one for the
 * work now on the timeline). Names collide case-insensitively, because the
 * backend refuses "A" and "a" as duplicates.
 *
 * Returns `current` UNCHANGED (same reference) when the incoming list adds
 * nothing, so the caller can skip the POST with a `!==` check.
 */
export function mergeExportPresets(current, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) return current
  const merged = [...current]
  let changed = false
  for (const preset of incoming) {
    if (!preset?.name || !preset.settings) continue
    const at = merged.findIndex(p => p.name.toLowerCase() === preset.name.toLowerCase())
    if (at < 0) {
      merged.push(preset)
      changed = true
    } else if (!sameSettings(merged[at].settings, preset.settings)) {
      // Keep the name already on record (its capitalisation is what the saved
      // set and the dropdown show) and take the project's values.
      merged[at] = { name: merged[at].name, settings: preset.settings }
      changed = true
    }
  }
  return changed ? merged : current
}
