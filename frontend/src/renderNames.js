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

// A filename without its extension. Used on the names the user sees on a clip
// (`displayName || sourceName`), so a clip called `shot.mov` can name a render
// that is written as `.mp4` — the container is the typed name's business, never
// the source's.
export function nameStem(name) {
  const trimmed = String(name ?? '').trim()
  const dot = trimmed.lastIndexOf('.')
  return dot > 0 ? trimmed.slice(0, dot) : trimmed
}

// Clean a Prefix/Suffix field into something that can go in an export filename.
// Path separators and control characters are dropped: the server takes the name
// as a plain basename inside the export directory and refuses anything else
// (ffmpeg_utils.check_output_name), and a slash would have it hide the render in
// a subdirectory instead — which is a 400 mid-series here, after some of the
// files have already been written. Everything else a user might type — spaces,
// `&`, accents — is a legal filename on this platform and is kept exactly as
// typed, the same rule the server applies; sanitizing those would silently
// rename the user's file.
//
// Spaces are NOT trimmed here, deliberately: a prefix of `SHOW 01 ` wants that
// trailing space, since it is a separator inside the finished name. Only the
// assembled name's own outer edges are trimmed (in shotOutputNames), which is
// where a stray space is a filename that reads as mangled rather than as spaced.
export function sanitizeAffix(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/[/\\\x00-\x1f\x7f]/g, '')
}

// Names for a shot-by-shot render (V2 Render's 1+ mode), one per cut in track
// order. Three things shape them, all decided in the render dialog:
//
//   - `stems` — the per-shot base names, when the dialog's **V1 name** box is
//     ticked (it is by default): each file is named after the clip it renders
//     rather than after the one name typed in the dialog. Null (the default
//     here, and what an untick sends) puts every file back on the typed name.
//   - `prefix`/`suffix` — wrapped around whichever base name that is, before the
//     index and always before the extension. Empty strings, i.e. nothing, by
//     default.
//   - the extension always comes from the typed name, never from a clip's own
//     file: `shot.mov` renders to `shot.mp4`.
//
// The index goes on LAST, so a series still sorts in cut order however it is
// named, and it is zero-padded to at least two digits because `_2` sorting after
// `_10` is the classic way to lose the very ordering a shot series exists to
// preserve — wider than two only past 99 cuts.
//
// With clip names in play the index is added only where it is NEEDED — where two
// or more shots would otherwise land on the same name (several cuts of one
// source file, or a duplicated clip). A shot whose name is already unique in the
// series stays bare, which is the whole point of naming files after clips; and
// where the number does appear it is the shot's own position, so it still says
// which cut the file is. Without clip names every file is numbered, exactly as
// this function always did — one typed name for N files has nothing else to tell
// them apart by.
//
// Collisions with files ALREADY in the export directory are still not handled
// here: the server appends its own `_1`, `_2`… to any name that already exists,
// so re-rendering a series never overwrites the one before it.
export function shotOutputNames(baseName, count, { stems = null, prefix = '', suffix = '' } = {}) {
  const n = Math.max(0, count | 0)
  const name = withDefaultExt(baseName)
  const dot = name.lastIndexOf('.')
  const typedStem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : '.mp4'
  const pre = sanitizeAffix(prefix)
  const suf = sanitizeAffix(suffix)
  const perShot = Array.isArray(stems) ? stems : null
  const width = Math.max(2, String(Math.max(n, 1)).length)
  // A clip with no name of its own falls back to the typed stem rather than
  // producing `prefix + suffix` with nothing in between.
  //
  // The assembled name is trimmed as a WHOLE rather than affix by affix: a
  // prefix of `SHOW 01 ` keeps the separator space it was typed with, while a
  // finished name that would start or end in a space — which reads as mangled
  // rather than as spaced, and which some tools quietly rewrite — doesn't get
  // one.
  const bases = Array.from({ length: n }, (_, i) => {
    const stem = perShot ? (sanitizeAffix(nameStem(perShot[i])).trim() || typedStem) : typedStem
    return `${pre}${stem}${suf}`.trim() || typedStem
  })
  const seen = new Map()
  bases.forEach(b => seen.set(b, (seen.get(b) || 0) + 1))
  return bases.map((b, i) => (!perShot || seen.get(b) > 1)
    ? `${b}_${String(i + 1).padStart(width, '0')}${ext}`
    : `${b}${ext}`)
}
