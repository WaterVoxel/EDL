// Favorites are a client-only UI preference (which files to pin to the top),
// persisted in localStorage per panel (input vs output use separate keys
// since the same filename could theoretically exist in both dirs).
function storageKey(dir) {
  return `nara-favorites-${dir}`
}

export function loadFavorites(dir) {
  try {
    const raw = localStorage.getItem(storageKey(dir))
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

export function saveFavorites(dir, favoriteSet) {
  try {
    localStorage.setItem(storageKey(dir), JSON.stringify([...favoriteSet]))
  } catch {
    // localStorage unavailable (e.g. private mode) — favorites just won't persist.
  }
}

export function toggleFavorite(dir, name, currentSet) {
  const next = new Set(currentSet)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  saveFavorites(dir, next)
  return next
}

// Both sticky client states below are keyed by FILENAME, so a rename on disk
// would otherwise silently drop them. These move the entry to the new name.
export function renameFavorite(dir, oldName, newName, currentSet) {
  if (!currentSet.has(oldName)) return currentSet
  const next = new Set(currentSet)
  next.delete(oldName)
  next.add(newName)
  saveFavorites(dir, next)
  return next
}

// Sorts files with favorites always first, then by the chosen field.
// sortBy: 'name' | 'date'. sortDir: 'asc' | 'desc'.
export function sortFiles(files, favorites, sortBy, sortDir) {
  const dir = sortDir === 'desc' ? -1 : 1
  return [...files].sort((a, b) => {
    const aFav = favorites.has(a.name)
    const bFav = favorites.has(b.name)
    if (aFav !== bFav) return aFav ? -1 : 1
    if (sortBy === 'date') return (a.modified - b.modified) * dir
    return a.name.localeCompare(b.name) * dir
  })
}

export function filterFiles(files, query) {
  if (!query) return files
  const q = query.toLowerCase()
  return files.filter(f => f.name.toLowerCase().includes(q))
}

// Mirrors ffmpeg_utils.AUDIO_EXTENSIONS — keep the two in sync. Used to route
// the Media Bin's "add to timeline" by file type: an audio file has no video
// stream, so it can only ever be a bed on A1, never a V1 clip.
export const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.aiff']

export function isAudioFile(name) {
  if (!name) return false
  const lower = name.toLowerCase()
  return AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext))
}

// Track tags mark which timeline track(s) a source file has been placed on.
// A file in input/ is not inherently V1 or V2 — the tag is STAMPED the first
// time the file enters a track (V1 via the bin's +/drag → handleAddToTimeline;
// V2 via the V2 dropzone → handleAddToV2) and is STICKY: it persists in
// localStorage even after the clip is removed. A file can carry both. Files
// never placed on any track stay untagged and only appear under the "All"
// bin filter. Stored as { [filename]: ['v1', 'v2'] }.
const TRACK_TAGS_KEY = 'nara-track-tags'

export function loadTrackTags() {
  try {
    const raw = localStorage.getItem(TRACK_TAGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveTrackTags(tags) {
  try {
    localStorage.setItem(TRACK_TAGS_KEY, JSON.stringify(tags))
  } catch {
    // localStorage unavailable — tags just won't persist.
  }
}

// "Don't show this again" for the V1 footage-loss warning — the popup that
// explains why Reconstruct cannot recover trimmed or deleted footage. Lives
// beside the other persisted UI prefs above rather than in its own module: this
// file is already where localStorage is spoken, and a second storage mechanism
// for one boolean would be the wrong call. Absent the flag the warning still
// only fires once per session, so the pref only ever silences it further.
const HIDE_FOOTAGE_LOSS_KEY = 'nara-hide-footage-loss-warning'

export function loadHideFootageLossWarning() {
  try {
    return localStorage.getItem(HIDE_FOOTAGE_LOSS_KEY) === '1'
  } catch {
    // localStorage unavailable (e.g. private mode) — fall back to warning once
    // per session, which is the sane degradation rather than never warning.
    return false
  }
}

export function saveHideFootageLossWarning(hide) {
  try {
    if (hide) localStorage.setItem(HIDE_FOOTAGE_LOSS_KEY, '1')
    else localStorage.removeItem(HIDE_FOOTAGE_LOSS_KEY)
  } catch {
    // localStorage unavailable — the choice just won't outlive this session.
  }
}

// Stamp `name` with `track` ('v1' | 'v2') if not already tagged, persisting
// the result. Returns a new tags object, or the same object unchanged (and
// no write) when the tag was already present — so callers can skip a
// needless state update.
export function tagTrack(name, track, current) {
  const existing = current[name] || []
  if (existing.includes(track)) return current
  const next = { ...current, [name]: [...existing, track] }
  saveTrackTags(next)
  return next
}

// Carry a renamed file's tags over to its new name (unioned with anything
// already stamped there by an earlier file of that name). Returns the same
// object unchanged, with no write, when the old name carried no tags.
export function renameTrackTag(oldName, newName, current) {
  const existing = current[oldName]
  if (!existing || !existing.length) return current
  const merged = [...new Set([...(current[newName] || []), ...existing])]
  const next = { ...current, [newName]: merged }
  delete next[oldName]
  saveTrackTags(next)
  return next
}

// Keep only files matching the chosen track view. 'all' passes everything;
// 'v1'/'v2' keep only files stamped with that tag.
export function filterByTrack(files, track, tags) {
  if (track === 'all') return files
  return files.filter(f => (tags[f.name] || []).includes(track))
}

// ---------------------------------------------------------------------------
// Media Bin folders
// ---------------------------------------------------------------------------
// A bin folder is a VIEW over input/, not a directory on disk. The file stays
// exactly where it is and keeps its filename, so moving it between folders
// changes nothing a clip depends on.
//
// That is the whole reason it works this way. A clip records its source as a
// bare filename (`sourceName`), so a real subdirectory would turn `cam.mp4`
// into `B-Roll/cam.mp4` as far as every clip, every undo step behind it and
// every saved .nara is concerned — the exact breakage MediaLibrary.handleRename
// refuses outright. Virtual folders mean even a file currently on the timeline
// can be filed away, which is the file you most want to organise.
//
// Stored the way the other sticky per-file bin state already is: localStorage,
// keyed by filename, as { [folderName]: [filename, ...] }. A file belongs to at
// most one folder — moveToBinFolder strips it from every other folder first —
// and a filename that is no longer in input/ is simply ignored when laying the
// list out, so nothing here needs pruning.
const BIN_FOLDERS_KEY = 'nara-bin-folders'

export const DEFAULT_FOLDER_NAME = 'New Folder'

export function loadBinFolders() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BIN_FOLDERS_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    // Shape-guard every entry: this value is hand-editable in devtools and a
    // malformed one must not take the whole bin down with it.
    const out = {}
    for (const [name, members] of Object.entries(parsed)) {
      if (name && Array.isArray(members)) out[name] = members.filter(m => typeof m === 'string')
    }
    return out
  } catch {
    return {}
  }
}

function saveBinFolders(folders) {
  try {
    localStorage.setItem(BIN_FOLDERS_KEY, JSON.stringify(folders))
  } catch {
    // localStorage unavailable — folders just won't persist.
  }
}

// Folders are keyed by name, so two can't share one. Number the newcomer
// instead of rejecting it: a second "New Folder" is a thing people make on
// purpose, and silently merging it into the first would lose the distinction.
export function uniqueFolderName(base, folders) {
  if (!folders[base]) return base
  let n = 2
  let candidate = `${base} ${n}`
  while (folders[candidate]) candidate = `${base} ${++n}`
  return candidate
}

// Returns { folders, name } — `name` is what the folder ended up called, which
// the caller needs in order to put it straight into rename mode.
export function createBinFolder(base, folders) {
  const name = uniqueFolderName(base || DEFAULT_FOLDER_NAME, folders)
  const next = { ...folders, [name]: [] }
  saveBinFolders(next)
  return { folders: next, name }
}

// Also returns the resulting name, which differs from `newName` when that name
// was taken. Returns the same object unchanged (and writes nothing) for a no-op
// rename, so the caller can skip a needless state update.
export function renameBinFolder(oldName, newName, folders) {
  if (!(oldName in folders)) return { folders, name: oldName }
  const trimmed = (newName || '').trim()
  if (!trimmed || trimmed === oldName) return { folders, name: oldName }
  const name = uniqueFolderName(trimmed, folders)
  // Rebuilt in key order rather than spread-and-delete so the folder keeps its
  // place in the stored object. Display sorts by name regardless; this is for
  // whoever reads the raw value.
  const next = {}
  for (const [key, members] of Object.entries(folders)) {
    if (key === oldName) next[name] = members
    else next[key] = members
  }
  saveBinFolders(next)
  return { folders: next, name }
}

// Removes the grouping only. The files are in input/ and stay there; they just
// show at the top level again.
export function deleteBinFolder(name, folders) {
  if (!(name in folders)) return folders
  const next = { ...folders }
  delete next[name]
  saveBinFolders(next)
  return next
}

// Move `fileName` into `folderName`, or to the top level when it's null.
// Stripping the file out of every folder first is what guarantees it can only
// ever be in one — otherwise it would render as two rows sharing a React key.
export function moveToBinFolder(fileName, folderName, folders) {
  // A folder that vanished mid-drag, or a drop where the file already is.
  if (folderName != null && !(folderName in folders)) return folders
  if (folderOfFile(fileName, folders) === folderName) return folders
  const next = {}
  let changed = false
  for (const [key, members] of Object.entries(folders)) {
    const kept = members.filter(m => m !== fileName)
    if (kept.length !== members.length) changed = true
    next[key] = kept
  }
  if (folderName != null) {
    next[folderName] = [...next[folderName], fileName]
    changed = true
  }
  if (!changed) return folders
  saveBinFolders(next)
  return next
}

export function folderOfFile(name, folders) {
  for (const [folder, members] of Object.entries(folders)) {
    if (members.includes(name)) return folder
  }
  return null
}

// A file renamed on disk has to keep its folder, exactly as renameFavorite and
// renameTrackTag keep the ★ and the track tag — otherwise the file silently
// jumps back to the top level.
export function renameBinFolderFile(oldName, newName, folders) {
  const owner = folderOfFile(oldName, folders)
  if (!owner) return folders
  const next = { ...folders, [owner]: folders[owner].map(m => (m === oldName ? newName : m)) }
  saveBinFolders(next)
  return next
}

// Lays the bin out as one flat list of rows in display order, so the component
// still renders a single <ul> and the keyboard walk stays an index step:
//   { type: 'folder', name, count, open }
//   { type: 'file', file, folder: <folderName|null> }
//
// Folders come first as a block, sorted by name — a folder has no mtime, so
// the Date sort orders the files inside them rather than the folders
// themselves. Sorting and both filters run through the same sortFiles /
// filterFiles / filterByTrack used before folders existed, applied within each
// container, so favourites still float to the top of wherever they live.
//
// While a filter is active every folder is forced open and folders with no
// match drop out entirely: a query has to be able to reach a file inside a
// collapsed folder or that file is simply unfindable.
//
// `pinnedFolder` survives that cull. It's the folder being named: a brand-new
// folder is empty by definition, so creating one while a filter is active would
// otherwise hide the very row whose name is waiting to be typed.
export function buildBinRows({ files, folders, favorites, query, trackFilter, trackTags, sortBy, sortDir, collapsed = new Set(), pinnedFolder = null }) {
  const filtering = Boolean(query) || trackFilter !== 'all'
  const matched = filterByTrack(filterFiles(files, query), trackFilter, trackTags)
  const arrange = list => sortFiles(list, favorites, sortBy, sortDir)
  const dir = sortDir === 'desc' ? -1 : 1
  const rows = []
  const filed = new Set()

  for (const name of Object.keys(folders).sort((a, b) => a.localeCompare(b) * dir)) {
    const members = new Set(folders[name])
    const inside = arrange(matched.filter(f => members.has(f.name)))
    for (const f of inside) filed.add(f.name)
    if (filtering && inside.length === 0 && name !== pinnedFolder) continue
    const open = filtering || !collapsed.has(name)
    rows.push({ type: 'folder', name, count: inside.length, open })
    if (open) for (const f of inside) rows.push({ type: 'file', file: f, folder: name })
  }
  // Everything a folder didn't claim, at the top level, under the same sort.
  for (const f of arrange(matched.filter(f => !filed.has(f.name)))) {
    rows.push({ type: 'file', file: f, folder: null })
  }
  return rows
}
