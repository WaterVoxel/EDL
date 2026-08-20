import { useState, useCallback, useRef } from 'react'

const MAX_HISTORY = 50

// ONE undo history shared by every track, not one stack per track. Undo is a
// single button and a single Cmd/Ctrl+Z, so it has to mean "step back the last
// thing I did" regardless of which lane that was — a per-track stack would make
// the shortcut do different things depending on which lane happened to be
// focused, which is exactly the confusion it exists to avoid. The tracks live
// in one state object so a snapshot is atomic: undoing restores every lane to
// the moment before that edit, and no interleaving of lanes can produce a
// history entry that half-applies.
//
// Present and past live in one container so updaters stay pure (StrictMode-safe
// — a double-run produces the identical result rather than a double push).
//
// `initial` is an object of named slices, e.g. { v1: [], v2: [], a1: [] }. The
// key set is fixed at mount; each key gets a setter with the plain React
// `set(updater)` signature, so call sites read exactly like a useState setter.

// The whole decision — push, fold, or don't record — as a pure function, so it
// can be unit-tested in node without a renderer (see the frontend-build skill).
// opts:
//   silent:   update without consuming an undo step. For bookkeeping the user
//             did not perform, e.g. clearing dirty flags after a render;
//             without it, the first Cmd+Z after every render just re-dirties
//             the clips instead of undoing the last real edit.
//   coalesce: a token identifying ONE gesture. A pointer drag fires an update
//             per pointermove (crop-box drags, edge-drag trims), so without
//             this a single drag pushes dozens of entries and shoves the rest
//             of the history off the end of the stack — undo then costs one
//             press per mouse sample. Same token as the last push → fold into
//             it. Tokens must be unique per gesture (see nextGesture), or two
//             successive drags of the same thing would merge into one.
export function reduceEdit(container, key, next, opts) {
  const { present, past, tag } = container
  if (next === present[key]) return container
  const nextPresent = { ...present, [key]: next }
  if (opts?.silent) return { present: nextPresent, past, tag }
  if (opts?.coalesce != null && opts.coalesce === tag) {
    return { present: nextPresent, past, tag }
  }
  return {
    present: nextPresent,
    past: [...past.slice(-(MAX_HISTORY - 1)), present],
    tag: opts?.coalesce ?? null,
  }
}

// Pop one entry. tag is cleared so the next coalescing gesture starts a fresh
// entry rather than folding into whatever the popped one was tagged with.
export function reduceUndo(container) {
  const { present, past } = container
  if (past.length === 0) return { present, past, tag: null }
  return { present: past[past.length - 1], past: past.slice(0, -1), tag: null }
}

export function useUndoableTracks(initial) {
  const [container, setContainer] = useState(() => ({ present: initial, past: [], tag: null }))

  const setSlice = useCallback((key, updater, opts) => {
    setContainer(c => reduceEdit(
      c,
      key,
      typeof updater === 'function' ? updater(c.present[key]) : updater,
      opts,
    ))
  }, [])

  // Built once and never rebuilt, so each setter's identity is stable for the
  // component's lifetime — they're passed as props and read in effect deps.
  const settersRef = useRef(null)
  if (settersRef.current === null) {
    settersRef.current = {}
    for (const key of Object.keys(initial)) {
      settersRef.current[key] = (updater, opts) => setSlice(key, updater, opts)
    }
  }

  const undo = useCallback(() => setContainer(reduceUndo), [])

  // Wholesale replacement with NO history: loading a project, or clearing after
  // the source files were deleted from disk. Undoing across either would
  // restore clips pointing at media that is gone or belongs to another project.
  const reset = useCallback((values) => {
    setContainer({ present: values, past: [], tag: null })
  }, [])

  return {
    tracks: container.present,
    setters: settersRef.current,
    undo,
    reset,
    canUndo: container.past.length > 0,
  }
}

// Gesture tokens for `coalesce`. A module counter rather than a timestamp or a
// random id: it needs to be unique per gesture and comparable by ===, nothing
// more, and this stays deterministic in tests.
let gestureSeq = 0
export function nextGesture(label) {
  gestureSeq += 1
  return `${label}:${gestureSeq}`
}
