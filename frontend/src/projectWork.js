// The WORK in a project — everything a user would lose — reduced to one
// comparable string. It answers exactly one question: "is there unsaved work
// on the lanes?", asked before something replaces the whole timeline (see
// App.jsx handleLibraryOpen, which also clears the undo history).
//
// What counts as work here, and what deliberately doesn't:
//   • The three lanes, A1 Noise's switch and its level ARE the work. They are
//     the edit decisions, and each one is written to a .nara — so anything that
//     would come back from a save belongs in the fingerprint.
//   • `dirty` is normalized away. It means "not yet rendered", so a Render
//     clears it on every clip without the user editing anything; left in, a
//     render would read as unsaved work.
//   • The SELECTION is not work. Clicking a different clip loses nothing, and
//     prompting over it would only teach the user to dismiss the prompt.
//   • Export presets are not work. Opening a project MERGES them into the saved
//     set (see mergeExportPresets) rather than replacing them, so they survive.
//
// Compared as a string rather than field by field because the two things being
// compared are a whole project's worth of nested structures, and a fingerprint
// makes "unchanged" the default answer — an edit anywhere in a clip shows up
// without this file needing to know that field exists.
export function workFingerprint({
  clips, track2Clips, audioBeds, noiseEnabled = false, noiseGainDb = null,
} = {}) {
  return stableString({
    v1: asArray(clips).map(withoutDirty),
    v2: asArray(track2Clips).map(withoutDirty),
    a1: asArray(audioBeds).map(withoutDirty),
    noiseEnabled: noiseEnabled === true,
    // The CLAMPED NUMBER, matching what a save writes — the caller passes it
    // that way, and a stray string would otherwise fingerprint differently
    // from the identical number.
    noiseGainDb: noiseGainDb == null ? null : Number(noiseGainDb),
  })
}

// A hand-edited .nara can hold anything at all in these keys. Nothing here is
// the right place to complain about that, but nothing here should throw over it
// either — a missing or wrongly-typed lane fingerprints as an empty one.
function asArray(value) {
  return Array.isArray(value) ? value : []
}

function withoutDirty(item) {
  if (!item || typeof item !== 'object') return item
  const { dirty: _dirty, ...rest } = item
  return rest
}

// JSON with object keys sorted, so two structures that differ only in property
// order — a .nara read back off disk vs. the objects held in state — still
// compare equal. Plain JSON.stringify preserves insertion order, which would
// make that difference look like an edit.
function stableString(value) {
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableString(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
