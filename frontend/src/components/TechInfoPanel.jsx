import { useState } from 'react'

function formatBytes(bytes) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0, n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return n.toFixed(1) + ' ' + units[i]
}

function Section({ label, rows }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500 mb-0.5">{label}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="text-neutral-300 truncate">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// `collapsible` opts a panel into the disclosure chevron — down (▾) for
// expanded, right (▸) for collapsed, the whole header row being the hit
// target. Off by default so the Reformat panel's "Selected Clip" copy of
// this component, which sits in a fixed three-column row where there is no
// space to reclaim, keeps rendering exactly as it did.
//
// The open/closed state is deliberately LOCAL and not persisted: panel
// widths and the center dock's tab aren't either (only file favorites and
// track tags reach localStorage, and those are facts about files rather
// than about layout), so persisting this one would make it the odd control
// that remembers. Both collapsible panels sit above a `flex-1 min-h-0` bin
// card, so collapsing hands the freed height to that list with no layout
// math here.
export default function TechInfoPanel({ info, title = 'Media Info', collapsible = false }) {
  const [open, setOpen] = useState(true)
  // A non-collapsible panel has no way to close, so it must never read as
  // closed regardless of this state.
  const expanded = !collapsible || open

  const header = collapsible ? (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      aria-expanded={open}
      title={open ? `Collapse ${title}` : `Expand ${title}`}
      className={`w-full flex items-center gap-1 px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-300 ${expanded ? 'border-b border-neutral-800' : ''}`}
    >
      {/* Fixed width because ▾ and ▸ are not the same width — without it the
          title shifts sideways on every toggle. */}
      <span className="w-2 shrink-0 text-center text-[10px] leading-none">{open ? '▾' : '▸'}</span>
      {title}
    </button>
  ) : (
    <div className="px-2 py-1 border-b border-neutral-800 text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
      {title}
    </div>
  )

  if (!info) {
    return (
      <div className="rounded-md bg-neutral-900 border border-neutral-800">
        {header}
        {expanded && (
          <div className="p-2 font-mono text-[9px]">
            <p className="text-neutral-600">Select a clip to see its metadata.</p>
          </div>
        )}
      </div>
    )
  }

  const fileRows = [
    ['File name', info._name || '—'],
    ['Format', info.format_name || '—'],
    ['File size', formatBytes(info.size_bytes)],
    ['Duration', info.duration ? info.duration.toFixed(3) + 's' : '—'],
    ['Total Frames', info.nb_frames != null ? info.nb_frames : '—'],
    ['Bit Rate', info.bit_rate ? Math.round(info.bit_rate / 1000).toLocaleString() + ' kb/s' : '—'],
  ]

  const videoRows = [
    ['Video Codec', info.video_codec || '—'],
    ['Profile', info.video_profile || '—'],
    ['Resolution', info.width && info.height ? `${info.width}×${info.height}` : '—'],
    ['Frame Rate', info.fps ? info.fps.toFixed(2) + ' fps' : '—'],
    ['Pixel Format', info.pix_fmt || '—'],
    ['Bit Depth', info.bits_per_raw_sample ? info.bits_per_raw_sample + '-bit' : '—'],
    ['Video Bitrate', info.video_bit_rate ? Math.round(info.video_bit_rate / 1000).toLocaleString() + ' kb/s' : '—'],
  ]

  const audioRows = [
    ['Audio Codec', info.audio_codec || (info.has_audio === false ? 'none' : '—')],
    ['Sample Rate', info.audio_sample_rate ? info.audio_sample_rate + ' Hz' : '—'],
    ['Channels', info.audio_channels != null ? info.audio_channels : '—'],
  ]

  return (
    <div className="rounded-md bg-neutral-900 border border-neutral-800">
      {header}
      {expanded && (
        <div className="p-2 font-mono text-[9px] space-y-2">
          <Section label="File" rows={fileRows} />
          <Section label="Video" rows={videoRows} />
          <Section label="Audio" rows={audioRows} />
        </div>
      )}
    </div>
  )
}
