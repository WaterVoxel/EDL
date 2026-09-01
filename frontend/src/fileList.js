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
// Bin folders (Media Bin over input/, Export Bin over output/)
// ---------------------------------------------------------------------------
// A bin folder is a VIEW over the directory, not a directory on disk. The file
// stays exactly where it is and keeps its filename, so moving it between
// folders changes nothing a clip depends on.
//
// That is the whole reason it works this way. A clip records its source as a
// bare filename (`sourceName`), so a real subdirectory would turn `cam.mp4`
// into `B-Roll/cam.mp4` as far as every clip, every undo step behind it and
// every saved .nara is concerned — the exact breakage MediaLibrary.handleRename
// refuses outright. Virtual folders mean even a file currently on the timeline
// can be filed away, which is the file you most want to organise.
//
// Stored the way the other sticky per-file bin state already is: localStorage,
// keyed by filename, as { [folderName]: { parent, files: [filename, ...] } }. A
// file belongs to at most one folder — moveFilesToBinFolder strips it from every
// other folder first — and a filename that is no longer in input/ is simply
// ignored when laying the list out, so nothing here needs pruning.
//
// `parent` is what makes folders nest: null for a top-level folder, otherwise
// the name of the folder it sits in. Names stay GLOBALLY unique (they are the
// keys), so unlike a real filesystem you cannot have two "Raw" folders under
// different parents — uniqueFolderName numbers the second one instead. That
// keeps every entry point here, and every piece of view state in MediaLibrary
// (collapse, rename, drag, the context menu), keyed by a plain name rather than
// a path or an id, which is the whole reason nesting was a small change.
//
// The pre-nesting shape stored the member array directly ({ [name]: [file] }).
// loadBinFolders still reads it and treats those folders as top-level, so an
// existing bin keeps its folders across the upgrade with nothing to migrate.
//
// `scope` is which list's folders these are — 'input' for the Media Bin,
// 'output' for the Export Bin, 'projects' for the Project Library — and it only
// ever picks the storage key. Each holds a completely separate tree for the same
// reason favorites do (storageKey above): the same filename can exist in more
// than one directory and means a different file in
// each. It defaults to 'input' throughout, and 'input' keeps the original
// un-namespaced key, so an existing bin's folders survive with nothing to
// migrate. Every function below is otherwise scope-blind: it takes the tree it
// is operating on as an argument, exactly as before.
const BIN_FOLDERS_KEY = 'nara-bin-folders'

function foldersKey(scope) {
  return scope === 'input' ? BIN_FOLDERS_KEY : `${BIN_FOLDERS_KEY}-${scope}`
}

export const DEFAULT_FOLDER_NAME = 'New Folder'

// True when `candidate` sits somewhere inside `ancestor`. The one question every
// folder move has to ask: a folder dropped into its own descendant would take
// that branch with it and detach the lot from the tree.
export function isDescendantFolder(candidate, ancestor, folders) {
  const seen = new Set()
  let cur = folders[candidate]?.parent ?? null
  while (cur != null && !seen.has(cur)) {
    if (cur === ancestor) return true
    seen.add(cur)
    cur = folders[cur]?.parent ?? null
  }
  return false
}

export function loadBinFolders(scope = 'input') {
  try {
    const parsed = JSON.parse(localStorage.getItem(foldersKey(scope)) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    // Shape-guard every entry: this value is hand-editable in devtools and a
    // malformed one must not take the whole bin down with it.
    const out = {}
    for (const [name, value] of Object.entries(parsed)) {
      if (!name) continue
      // The pre-nesting shape: the value WAS the member array.
      if (Array.isArray(value)) {
        out[name] = { parent: null, files: value.filter(m => typeof m === 'string') }
        continue
      }
      if (!value || typeof value !== 'object') continue
      out[name] = {
        parent: typeof value.parent === 'string' ? value.parent : null,
        files: Array.isArray(value.files) ? value.files.filter(m => typeof m === 'string') : [],
      }
    }
    // A parent that no longer exists, or one that closes a loop, would make the
    // tree unwalkable — buildBinRows would never reach those folders and, worse,
    // a cycle would recurse forever. Both go back to the top level. Fixing one
    // link breaks its cycle, so a second pass isn't needed.
    for (const name of Object.keys(out)) {
      const p = out[name].parent
      if (p == null) continue
      if (!out[p] || p === name || isDescendantFolder(p, name, out)) out[name] = { ...out[name], parent: null }
    }
    return out
  } catch {
    return {}
  }
}

function saveBinFolders(folders, scope) {
  try {
    localStorage.setItem(foldersKey(scope), JSON.stringify(folders))
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
// the caller needs in order to put it straight into rename mode. `parent` nests
// the new folder inside an existing one; an unknown parent means top level
// rather than an error, since the only way to pass one is a stale menu.
export function createBinFolder(base, folders, parent = null, scope = 'input') {
  const name = uniqueFolderName(base || DEFAULT_FOLDER_NAME, folders)
  const next = { ...folders, [name]: { parent: parent && folders[parent] ? parent : null, files: [] } }
  saveBinFolders(next, scope)
  return { folders: next, name }
}

// Also returns the resulting name, which differs from `newName` when that name
// was taken. Returns the same object unchanged (and writes nothing) for a no-op
// rename, so the caller can skip a needless state update.
export function renameBinFolder(oldName, newName, folders, scope = 'input') {
  if (!(oldName in folders)) return { folders, name: oldName }
  const trimmed = (newName || '').trim()
  if (!trimmed || trimmed === oldName) return { folders, name: oldName }
  const name = uniqueFolderName(trimmed, folders)
  // Rebuilt in key order rather than spread-and-delete so the folder keeps its
  // place in the stored object. Display sorts by name regardless; this is for
  // whoever reads the raw value.
  const next = {}
  for (const [key, entry] of Object.entries(folders)) {
    // Children point at their parent BY NAME, so a rename has to follow through
    // to them or the whole branch below would fall out of the tree.
    const patched = entry.parent === oldName ? { ...entry, parent: name } : entry
    if (key === oldName) next[name] = patched
    else next[key] = patched
  }
  saveBinFolders(next, scope)
  return { folders: next, name }
}

// Removes the grouping only. The files are in input/ and stay there; they just
// show one level up — in the removed folder's parent, or at the top level when
// it had none. Its subfolders move up with them, keeping their own contents:
// removing a level should not scatter a three-deep branch across the bin.
export function deleteBinFolder(name, folders, scope = 'input') {
  if (!(name in folders)) return folders
  const up = folders[name].parent ?? null
  const next = {}
  for (const [key, entry] of Object.entries(folders)) {
    if (key === name) continue
    next[key] = (entry.parent ?? null) === name ? { ...entry, parent: up } : entry
  }
  // Files land in the parent by being listed there. At the top level there is no
  // entry to list them in — being in no folder IS the top level.
  if (up != null && next[up]) next[up] = { ...next[up], files: [...next[up].files, ...folders[name].files] }
  saveBinFolders(next, scope)
  return next
}

// Move every name in `fileNames` into `folderName`, or to the top level when
// it's null, in one write. Stripping the files out of every folder first is what
// guarantees each can only ever be in one — otherwise a file would render as two
// rows sharing a React key.
export function moveFilesToBinFolder(fileNames, folderName, folders, scope = 'input') {
  // A folder that vanished mid-drag.
  if (folderName != null && !(folderName in folders)) return folders
  // Files already where they are being dropped aren't a move; if that's all of
  // them, the whole drop is a no-op and the caller can skip a state update.
  const moving = [...new Set(fileNames)].filter(n => folderOfFile(n, folders) !== folderName)
  if (moving.length === 0) return folders
  const cut = new Set(moving)
  const next = {}
  for (const [key, entry] of Object.entries(folders)) {
    const kept = entry.files.filter(m => !cut.has(m))
    next[key] = kept.length === entry.files.length ? entry : { ...entry, files: kept }
  }
  if (folderName != null) next[folderName] = { ...next[folderName], files: [...next[folderName].files, ...moving] }
  saveBinFolders(next, scope)
  return next
}

// Re-parent a folder: `parentName` null puts it back at the top level. Returns
// the same object unchanged (and writes nothing) for anything that isn't a real
// move, including the one that would corrupt the tree — dropping a folder into
// its own descendant, which would cut that branch loose from the root.
export function moveFolderToParent(name, parentName, folders, scope = 'input') {
  if (!(name in folders)) return folders
  if (parentName != null && !(parentName in folders)) return folders
  if (parentName === name) return folders
  if ((folders[name].parent ?? null) === (parentName ?? null)) return folders
  if (parentName != null && isDescendantFolder(parentName, name, folders)) return folders
  const next = { ...folders, [name]: { ...folders[name], parent: parentName ?? null } }
  saveBinFolders(next, scope)
  return next
}

export function folderOfFile(name, folders) {
  for (const [folder, entry] of Object.entries(folders)) {
    if (entry.files.includes(name)) return folder
  }
  return null
}

// A file renamed on disk has to keep its folder, exactly as renameFavorite and
// renameTrackTag keep the ★ and the track tag — otherwise the file silently
// jumps back to the top level.
export function renameBinFolderFile(oldName, newName, folders, scope = 'input') {
  const owner = folderOfFile(oldName, folders)
  if (!owner) return folders
  const entry = folders[owner]
  const next = { ...folders, [owner]: { ...entry, files: entry.files.map(m => (m === oldName ? newName : m)) } }
  saveBinFolders(next, scope)
  return next
}

// Lays the bin out as one flat list of rows in display order, so the component
// still renders a single <ul> and the keyboard walk stays an index step:
//   { type: 'folder', name, count, depth, open, parent }
//   { type: 'file', file, folder: <folderName|null>, depth }
//
// Nesting is why this walks the tree: each folder emits its subfolders (whole
// subtrees, recursively) before its own files, and `depth` — 0 at the top level,
// counting the containers above the row — is what the component indents by.
//
// Folders come first as a block within each level, sorted by name: a folder has
// no mtime, so the Date sort orders the files inside them rather than the
// folders themselves. Sorting and both filters run through the same sortFiles /
// filterFiles / filterByTrack used before folders existed, applied within each
// container, so favourites still float to the top of wherever they live.
//
// A folder's `count` is its whole subtree — its own matching files plus every
// descendant's. Closed is now the default, so a folder that holds nothing
// directly but has fifty files two levels down has to say fifty, not zero.
//
// While a filter is active every folder is forced open and folders whose subtree
// holds no match drop out entirely: a query has to be able to reach a file
// inside a collapsed folder or that file is simply unfindable.
//
// `pinnedFolder` and its ancestors survive that cull. It's the folder being
// named: a brand-new folder is empty by definition, so creating one while a
// filter is active would otherwise hide the very row whose name is waiting to be
// typed — and hiding the parent it was created inside would hide it just as well.
// `trackFilter`/`trackTags` default to the no-op pair (filterByTrack passes
// everything through on 'all') because the Export Bin has no track tags at all —
// a render isn't "used on V1" the way a source file is. Everything else here is
// identical for both bins.
export function buildBinRows({ files, folders, favorites, query, trackFilter = 'all', trackTags = {}, sortBy, sortDir, collapsed = new Set(), pinnedFolder = null }) {
  const filtering = Boolean(query) || trackFilter !== 'all'
  const matched = filterByTrack(filterFiles(files, query), trackFilter, trackTags)
  const arrange = list => sortFiles(list, favorites, sortBy, sortDir)
  const dir = sortDir === 'desc' ? -1 : 1
  const filed = new Set()

  // Each folder's own matching files, and each folder's children, resolved once
  // up front — the walk below would otherwise re-scan every file per level.
  const inside = new Map()
  const children = new Map()
  for (const [name, entry] of Object.entries(folders)) {
    const members = new Set(entry.files)
    const mine = arrange(matched.filter(f => members.has(f.name)))
    inside.set(name, mine)
    for (const f of mine) filed.add(f.name)
    const parent = entry.parent ?? null
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(name)
  }
  for (const list of children.values()) list.sort((a, b) => a.localeCompare(b) * dir)

  const subtreeCount = name =>
    inside.get(name).length + (children.get(name) ?? []).reduce((n, c) => n + subtreeCount(c), 0)

  // The chain from the folder being named up to the root, all of it exempt from
  // the filter cull.
  const pinned = new Set()
  for (let cur = pinnedFolder; cur != null && !pinned.has(cur); cur = folders[cur]?.parent ?? null) pinned.add(cur)

  const rows = []
  const seen = new Set()
  const walk = (parent, depth) => {
    for (const name of children.get(parent) ?? []) {
      // Belt and braces: loadBinFolders and moveFolderToParent both refuse to
      // build a cycle, and a cycle here would recurse until the stack blew.
      if (seen.has(name)) continue
      seen.add(name)
      const count = subtreeCount(name)
      if (filtering && count === 0 && !pinned.has(name)) continue
      const open = filtering || !collapsed.has(name)
      rows.push({ type: 'folder', name, count, depth, open, parent })
      if (!open) continue
      walk(name, depth + 1)
      for (const f of inside.get(name)) rows.push({ type: 'file', file: f, folder: name, depth: depth + 1 })
    }
  }
  walk(null, 0)
  // Everything a folder didn't claim, at the top level, under the same sort.
  for (const f of arrange(matched.filter(f => !filed.has(f.name)))) {
    rows.push({ type: 'file', file: f, folder: null, depth: 0 })
  }
  return rows
}
