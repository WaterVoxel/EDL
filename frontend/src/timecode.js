export function formatTimecode(seconds, fps = 30) {
  if (seconds == null || Number.isNaN(seconds)) return '--:--:--:--'
  const s = Math.max(0, seconds)
  const totalFrames = Math.round(s * fps)
  const frames = totalFrames % Math.round(fps)
  const totalSeconds = Math.floor(totalFrames / Math.round(fps))
  const hh = Math.floor(totalSeconds / 3600)
  const mm = Math.floor((totalSeconds % 3600) / 60)
  const ss = totalSeconds % 60
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(frames)}`
}

export function formatSeconds(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—'
  return seconds.toFixed(2) + 's'
}

// Parses either a plain number of seconds ("12.5") or a colon-delimited
// timecode ("SS:FF", "MM:SS:FF", or "HH:MM:SS:FF", matching the format
// formatTimecode displays). Returns seconds, or null if unparseable.
export function parseTimecode(str, fps = 30) {
  if (str == null) return null
  const trimmed = String(str).trim()
  if (trimmed === '') return null

  if (!trimmed.includes(':')) {
    const n = parseFloat(trimmed)
    return Number.isNaN(n) ? null : n
  }

  const parts = trimmed.split(':').map(p => p.trim())
  if (parts.length < 2 || parts.length > 4 || parts.some(p => p === '' || Number.isNaN(Number(p)))) {
    return null
  }
  const nums = parts.map(Number)
  const frames = nums.pop()
  const seconds = nums.pop()
  const minutes = nums.length ? nums.pop() : 0
  const hours = nums.length ? nums.pop() : 0
  return hours * 3600 + minutes * 60 + seconds + frames / fps
}
