// The draggable seam between two columns. One component for both side dividers,
// since two hand-styled copies of a 12px strip are how the two edges of one app
// end up looking like different features.
//
// The style is a three-step progression over things that are ALREADY THERE at
// rest, which is the whole point of it:
//
//   - the hairline says "there are two panels here" — it is the panels' shared
//     edge, so the neighbouring panel must not draw a border on this side too.
//   - the short centred grip says "this particular edge moves".
//   - hover, keyboard focus and dragging only BRIGHTEN those two. Nothing appears
//     that wasn't visible before.
//
// A strip that is transparent until hovered reads as empty space, so the handle
// can only be found by chance; a strip that is bright at rest reads as a
// permanent rule. Both failures are what this progression avoids.
//
// The hit area is 12px but the layout cost is zero: `-mx-1.5` pulls back exactly
// the 6px of padding added on each side of the 1px seam, so widening the target
// never pushes the panels apart. The two spans are `aria-hidden` because they are
// the drawing, not the control — the control is the parent, and a screen reader
// has nothing to do with either.
//
// `focus-visible:outline-none` + the `group-focus-visible` steps replace the
// browser ring with the same brightening hover uses. They light up only once the
// handle is focusable; it is not today (a focus stop that ignores arrow keys is
// worse than none), and the states are here so that making it focusable is a
// one-line change rather than a restyle.
export default function PanelDivider({ onPointerDown, dragging = false }) {
  // Both parts step up together on hover/focus, then again while dragging — the
  // hairline to the accent and the grip past it, so the edge you have hold of is
  // unambiguous while the pointer is outside the 12px strip, which it is for most
  // of a drag.
  //
  // The hover step is TWO shades (800 → 600), not one. A 1px line is a handful of
  // pixels of colour, and 800 → 700 on it was a change you had to already know
  // about to see — the grip carried the whole hover state on its own. Same reason
  // both go indigo on the drag rather than another neutral step.
  const quiet = 'bg-neutral-800 group-hover:bg-neutral-600 group-focus-visible:bg-neutral-600'
  return (
    <div
      onPointerDown={onPointerDown}
      title="Drag to resize"
      /* z-10 because -mx-1.5 makes this overlap both neighbours by 6px, and the
         panel AFTER it in the DOM has positioned descendants of its own that would
         otherwise paint over that half of the target — the strip would look 12px
         wide and behave like 6px on one side. */
      className="group relative z-10 -mx-1.5 flex w-3 shrink-0 flex-col items-center justify-center cursor-col-resize touch-none focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-2 w-px transition-colors ${dragging ? 'bg-indigo-500' : quiet}`}
      />
      <span
        aria-hidden="true"
        className={`relative h-7 w-[3px] rounded-full transition-colors ${dragging ? 'bg-indigo-400' : quiet}`}
      />
    </div>
  )
}
