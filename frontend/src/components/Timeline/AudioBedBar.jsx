import { sequencePosToPx, sequenceClipBounds, sequenceVideoStartSec } from '../../clipMath'

/* The A1 audio bed, drawn as one bar under V1.
 *
 * A bed has no editable timing of its own — the render starts it where V1's
 * PICTURE starts and pads it with silence or cuts it to the sequence's end. So
 * this deliberately isn't a TimelineClip: there are no head/tail/round
 * segments, no edge-drag trim, and no reorder. What it DOES have to show is
 * how the bed's own length compares to the sequence, which is the one thing
 * the user can't otherwise see and the one thing that changes what they hear:
 *
 *   shorter  → the bed, then a hatched remainder that renders as silence
 *   longer   → the bed clipped at the sequence edge, with a cut marker
 *   equal    → flush, no annotation
 *
 * A1 is LINKED to V1 twice over. Geometrically: every horizontal measurement
 * goes through sequencePosToPx, the same per-clip-width + inter-clip-gap layout
 * V1's flex row produces. Measuring the bed as one continuous `sequenceSec *
 * pps` span instead would drift 2px left of the picture per clip boundary (and
 * more under a clip floored to MIN_CLIP_PX), so the bar would stop sitting
 * under the frame it plays with. Temporally: the bar STARTS at V1's video start
 * (past any head hold) and ENDS at the sequence end, mirroring the render's
 * adelay — so removing or resizing the hold moves the bar with the picture.
 * Clip dividers and hold markers come from the same bounds, making the link
 * visible rather than merely asserted.
 */
export default function AudioBedBar({ bed, clips, sequenceSec, pps, gapPx, muted = false, onRemove }) {
  const bedSec = bed.durationSec || 0
  // Where V1's picture starts — the bed is delayed to here by the render, so
  // the space the bed has to fill is the sequence MINUS the head hold.
  const startSec = sequenceVideoStartSec(clips)
  const availSec = Math.max(sequenceSec - startSec, 0)
  // 1 frame at 60fps of slack — a bed cut to length by an external tool lands
  // a few ms off and shouldn't be labelled "shorter" over rounding dust.
  const EPS = 0.017
  const state = bedSec < availSec - EPS ? 'short'
    : bedSec > availSec + EPS ? 'long'
      : 'exact'

  // Lane width and every internal edge measured in V1's own coordinate space.
  const seqPx = sequencePosToPx(clips, sequenceSec, pps, gapPx)
  const startPx = sequencePosToPx(clips, startSec, pps, gapPx)
  // Visible bed span: from V1's video start, never past the sequence edge,
  // since anything past it is cut and never heard.
  const bedEndPx = sequencePosToPx(clips, Math.min(startSec + bedSec, sequenceSec), pps, gapPx)
  const bedPx = Math.max(bedEndPx - startPx, 0)
  const bounds = sequenceClipBounds(clips, pps, gapPx)

  return (
    <div className="relative h-full flex-shrink-0 group" style={{ width: Math.max(seqPx, 24) }}>
      <div
        className={`absolute top-0 bottom-0 rounded border border-emerald-500 bg-gradient-to-b from-emerald-700 to-emerald-900 overflow-hidden ${muted ? 'opacity-40' : ''}`}
        style={{ left: startPx, width: Math.max(bedPx, 18) }}
        title={
          `${bed.name} — ${bedSec.toFixed(2)}s`
          + (startSec > 0 ? `, starting ${startSec.toFixed(2)}s in with V1's picture (after the head hold)` : '')
        }
      >
        <div className="absolute inset-0 flex items-center gap-1 px-1.5 pointer-events-none">
          <span className="text-[8px] text-emerald-100 font-medium truncate">
            {bed.name}
          </span>
          <span className="text-[8px] text-emerald-200/80 font-mono shrink-0">{bedSec.toFixed(1)}s</span>
        </div>
      </div>

      {/* Silence the render pads on when the bed runs out early. */}
      {state === 'short' && (
        <div
          className="absolute top-0 bottom-0 rounded-r border border-l-0 border-emerald-900/60 overflow-hidden flex items-center justify-center"
          style={{
            left: startPx + bedPx,
            width: Math.max(seqPx - startPx - bedPx, 0),
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(16,185,129,0.14) 0 3px, transparent 3px 6px)',
          }}
          title={`Silence — the bed is ${(availSec - bedSec).toFixed(2)}s shorter than the space it has to fill`}
        >
          <span className="text-[7px] text-emerald-600/90 font-mono uppercase tracking-wide truncate px-1">silence</span>
        </div>
      )}

      {/* The head hold, which the bed is delayed PAST — labelled, because an
          empty gap at the head of the lane otherwise reads as a bug rather
          than as the bed waiting for the picture to start. */}
      {startPx > 0 && (
        <div
          className="absolute top-0 bottom-0 left-0 rounded-l border border-r-0 border-fuchsia-500/40 bg-fuchsia-500/10 overflow-hidden flex items-center justify-center"
          style={{ width: startPx }}
          title={`The bed waits out V1's ${startSec.toFixed(2)}s head hold and starts with the picture`}
        >
          <span className="text-[7px] text-fuchsia-400/90 font-mono uppercase tracking-wide truncate px-1">hold</span>
        </div>
      )}

      {/* The rest of the link to V1: a divider at each clip boundary and a
          tinted span under each remaining hold. The bed plays straight through
          these (only the HEAD hold offsets it), so they're reference marks, not
          bed segments — hence pointer-events-none and no click targets. */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {bounds.map((b, i) => (
          <div key={b.id}>
            {b.tailPx > 0 && (
              <div
                className="absolute top-0 bottom-0 bg-fuchsia-500/15 border-l border-fuchsia-500/30"
                style={{ left: b.left + b.width - b.tailPx, width: b.tailPx }}
              />
            )}
            {i > 0 && (
              <div
                className="absolute top-0 bottom-0 w-px bg-neutral-950/70"
                style={{ left: b.left }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Everything past the sequence edge is cut at render. */}
      {state === 'long' && (
        <div
          className="absolute top-0 bottom-0 right-0 w-1 bg-red-500/80"
          title={`Cut — the bed runs ${(bedSec - sequenceSec).toFixed(2)}s past the end of the sequence`}
        />
      )}

      <button
        onClick={e => { e.stopPropagation(); onRemove?.() }}
        title="Remove the audio bed"
        className="absolute top-0 right-0 w-3.5 h-3.5 flex items-center justify-center bg-black/50 hover:bg-red-600 text-white text-[9px] leading-none opacity-0 group-hover:opacity-100 z-20"
      >×</button>
    </div>
  )
}
