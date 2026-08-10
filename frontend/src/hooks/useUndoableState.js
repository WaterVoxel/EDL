import { useState, useCallback } from 'react'

const MAX_HISTORY = 50

// Undoable state: every set() snapshots the previous value onto a history
// stack (capped at MAX_HISTORY); undo() pops it back. Present and past live
// in one state object so updaters stay pure (StrictMode-safe — a double-run
// produces the identical result rather than a double history push).
export function useUndoableState(initial) {
  const [container, setContainer] = useState({ present: initial, past: [] })

  const set = useCallback((updater) => {
    setContainer(({ present, past }) => {
      const next = typeof updater === 'function' ? updater(present) : updater
      if (next === present) return { present, past }
      return { present: next, past: [...past.slice(-(MAX_HISTORY - 1)), present] }
    })
  }, [])

  const undo = useCallback(() => {
    setContainer(({ present, past }) => {
      if (past.length === 0) return { present, past }
      return { present: past[past.length - 1], past: past.slice(0, -1) }
    })
  }, [])

  const reset = useCallback((value) => {
    setContainer({ present: value, past: [] })
  }, [])

  return {
    state: container.present,
    set,
    undo,
    reset,
    canUndo: container.past.length > 0,
  }
}
