import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTour } from '../context/TourContext'

const PAD = 6
const GAP = 10 // space between the spotlight and the tooltip
const TOOLTIP_WIDTH = 280

// Full-screen dark scrim with a rectangular "hole" cut out around the
// current step's target (via a clip-path built from four scrim rectangles
// rather than an SVG mask, so no extra asset/complexity), plus a tooltip
// box anchored below/above the hole and Back/Next/Skip controls. The scrim
// itself intercepts all clicks — only the spotlighted element (rendered
// above the scrim via a z-index-lifted clone position, not by poking a real
// hole a click could fall through) and the nav buttons are interactive,
// so the rest of the app is inert while the tour runs.
export default function TourOverlay() {
  const { active, stepIndex, steps, next, back, end } = useTour()
  const [rect, setRect] = useState(null)
  const tooltipRef = useRef(null)
  const [tooltipSize, setTooltipSize] = useState({ width: TOOLTIP_WIDTH, height: 120 })

  const step = active ? steps[stepIndex] : null

  useEffect(() => {
    if (!step) { setRect(null); return }

    function measure() {
      const el = document.querySelector(`[data-tour="${step.id}"]`)
      if (!el) { setRect(null); return }
      const r = el.getBoundingClientRect()
      setRect({
        left: r.left - PAD, top: r.top - PAD,
        width: r.width + PAD * 2, height: r.height + PAD * 2,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    const el = document.querySelector(`[data-tour="${step.id}"]`)
    if (el) ro.observe(el)
    return () => { window.removeEventListener('resize', measure); ro.disconnect() }
  }, [step])

  useEffect(() => {
    if (!active) return
    function onKeyDown(e) {
      if (e.key === 'Escape') end()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') back()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, next, back, end])

  // Placement below depends on the measured tooltip height, so recompute
  // after every render where the tooltip is present. Runs before paint so
  // there's no visible jump from an initial guess to the final spot. The
  // no-dep form is deliberate (the tooltip's height changes with each
  // step's text, not with any single tracked value) — the size guard below
  // makes it converge in one correction rather than loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = tooltipRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width !== tooltipSize.width || r.height !== tooltipSize.height) {
      setTooltipSize({ width: r.width, height: r.height })
    }
  })

  if (!active || !step) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const isLast = stepIndex === steps.length - 1
  const tooltipWidth = TOOLTIP_WIDTH
  const th = tooltipSize.height

  // Choose a side that has room for the WHOLE tooltip so it never overlaps
  // the spotlight (the previous fixed ±90/100 guesses overlapped tall
  // spotlights like the full-height Media Bin). Preference: below → above →
  // right → left → center. Below/above clamp horizontally; right/left clamp
  // vertically; each keeps the tooltip fully on-screen.
  let tooltipTop, tooltipLeft
  if (!rect) {
    tooltipTop = vh / 2 - th / 2
    tooltipLeft = vw / 2 - tooltipWidth / 2
  } else {
    const spotBottom = rect.top + rect.height
    const spotRight = rect.left + rect.width
    const clampX = x => Math.min(Math.max(x, 8), vw - tooltipWidth - 8)
    const clampY = y => Math.min(Math.max(y, 8), vh - th - 8)
    if (spotBottom + GAP + th <= vh) {
      tooltipTop = spotBottom + GAP
      tooltipLeft = clampX(rect.left)
    } else if (rect.top - GAP - th >= 0) {
      tooltipTop = rect.top - GAP - th
      tooltipLeft = clampX(rect.left)
    } else if (spotRight + GAP + tooltipWidth <= vw) {
      tooltipLeft = spotRight + GAP
      tooltipTop = clampY(rect.top)
    } else if (rect.left - GAP - tooltipWidth >= 0) {
      tooltipLeft = rect.left - GAP - tooltipWidth
      tooltipTop = clampY(rect.top)
    } else {
      tooltipTop = clampY(vh / 2 - th / 2)
      tooltipLeft = clampX(vw / 2 - tooltipWidth / 2)
    }
  }

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Dimming scrim, split into up to 4 rectangles around the spotlight
          hole so the hole area stays visually bright (no dark overlay).
          A fifth, transparent click-blocker sits exactly over the hole
          itself — the tour blocks ALL app interaction while running, so
          even the spotlighted element must not be clickable; only the
          highlight ring is visual. */}
      {rect ? (
        <>
          <div className="absolute bg-black/70" style={{ left: 0, top: 0, width: vw, height: Math.max(rect.top, 0) }} />
          <div className="absolute bg-black/70" style={{ left: 0, top: rect.top + rect.height, width: vw, height: Math.max(vh - (rect.top + rect.height), 0) }} />
          <div className="absolute bg-black/70" style={{ left: 0, top: rect.top, width: Math.max(rect.left, 0), height: rect.height }} />
          <div className="absolute bg-black/70" style={{ left: rect.left + rect.width, top: rect.top, width: Math.max(vw - (rect.left + rect.width), 0), height: rect.height }} />
          <div
            className="absolute rounded-md ring-2 ring-amber-400"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/70" />
      )}

      <div
        ref={tooltipRef}
        style={{ left: tooltipLeft, top: tooltipTop, width: tooltipWidth }}
        className="absolute bg-neutral-900 border border-amber-500 rounded-md shadow-xl p-3 flex flex-col gap-2"
      >
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-400">
            Step {stepIndex + 1} of {steps.length}
          </span>
          <button onClick={end} className="text-[10px] text-neutral-500 hover:text-neutral-200">Skip ×</button>
        </div>
        <p className="text-[11px] text-neutral-200 leading-relaxed">{step.text}</p>
        <div className="flex items-center justify-end gap-1.5 mt-1">
          <button
            onClick={back}
            disabled={stepIndex === 0}
            className="px-2.5 py-1 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-30"
          >Back</button>
          <button
            onClick={next}
            className="px-2.5 py-1 text-[10px] font-medium rounded bg-amber-500 text-neutral-950 hover:bg-amber-400"
          >{isLast ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  )
}
