// Output filenames, derived from the one name the user types in the render
// dialog. Pure string work with no knowledge of the timeline — the callers know
// how many files they are about to write, this decides what they're called.

// A render always writes a container, so a bare name lands on .mp4. Shared by
// the dialog's submit and by everything that previews the name back to the user,
// so what is shown and what is written can't drift apart.
export function withDefaultExt(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return ''
  return trimmed.includes('.') ? trimmed : `${trimmed}.mp4`
}

// Names for a shot-by-shot render (Render V2's 1+ mode): the typed name with a
// zero-padded index inserted before the extension, one per cut in track order.
//
// Zero-padded to at least two digits so the series sorts in cut order in the
// Export Bin and in Finder — `_2` sorting after `_10` is the classic way to
// lose the very ordering a shot series exists to preserve — and wider than two
// only past 99 cuts.
//
// Collisions are deliberately not handled here: the server appends its own
// `_1`, `_2`… to any name that already exists in the export directory, so
// re-rendering a series never overwrites the one before it.
export function shotOutputNames(baseName, count) {
  const n = Math.max(0, count | 0)
  const name = withDefaultExt(baseName)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : '.mp4'
  const width = Math.max(2, String(Math.max(n, 1)).length)
  return Array.from({ length: n }, (_, i) =>
    `${stem}_${String(i + 1).padStart(width, '0')}${ext}`)
}
