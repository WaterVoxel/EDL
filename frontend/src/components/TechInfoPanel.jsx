function formatBytes(bytes) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0, n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return n.toFixed(1) + ' ' + units[i]
}

export default function TechInfoPanel({ info }) {
  if (!info) return null

  const rows = [
    ['File', info._name || '—'],
    ['Format', info.format_name || '—'],
    ['Duration', info.duration ? info.duration.toFixed(3) + 's' : '—'],
    ['Resolution', info.width && info.height ? `${info.width}×${info.height}` : '—'],
    ['Frame rate', info.fps ? info.fps.toFixed(2) + ' fps' : '—'],
    ['Video codec', info.video_codec || '—'],
    ['Audio codec', info.audio_codec || (info.has_audio === false ? 'none' : '—')],
    ['Audio sample rate', info.audio_sample_rate ? info.audio_sample_rate + ' Hz' : '—'],
    ['Audio channels', info.audio_channels != null ? info.audio_channels : '—'],
    ['Bit rate', info.bit_rate ? Math.round(info.bit_rate / 1000) + ' kb/s' : '—'],
    ['File size', formatBytes(info.size_bytes)],
  ]

  return (
    <div className="mt-2 p-2 rounded-md bg-neutral-800 border border-neutral-700 font-mono text-[11px]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="text-neutral-300">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
