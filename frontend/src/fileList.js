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
