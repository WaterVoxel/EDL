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
