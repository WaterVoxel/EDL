import { sequencePosToPx, sequenceClipBounds, sequenceVideoStartSec } from '../../clipMath'

/* The A1 audio lane, drawn as one bar per clip on it, laid end to end under V1.
 *
 * A1 is SEQUENTIAL like V1: clip 2 starts exactly where clip 1's audio ends,
 * and the render concatenates them in this same order. What no clip on it has
 * is editable timing of its own — the whole run starts where V1's PICTURE
 * starts, and the render pads it with silence or cuts it at the sequence's end.
 * So these deliberately aren't TimelineClips: there are no head/tail/round
 * segments, no edge-drag trim, and no reorder. Order is the order they were
 * added, and the only per-clip edit is remove.
 *
 * What the lane DOES have to show is how its total length compares to the
 * sequence, which is the one thing the user can't otherwise see and the one
 * thing that changes what they hear:
 *
 *   shorter  → the clips, then a hatched remainder with nothing of A1's own in it
 *   longer   → the overhang past the sequence edge, hatched red and never heard
 *   equal    → flush, no annotation
 *
 * `noiseEnabled` (the A1 Room Tone toggle) relabels both annotated gaps — the
 * head hold and the short-lane remainder — to amber "noise", so the lane tracks
 * the button. Both labels are exactly true: room tone fills silence and only
 * silence, and these two annotations are precisely the stretches where this lane
 * has no sound. The remainder in particular is measured against how far the
 * lane's AUDIO reaches, which is what the render measures too, so a bed whose
 * file is padded with silence gets tone from where the sound stops.
 *
 * What the lane cannot draw is the silence on V1's side — a clip whose source
 * has no audio stream, or a slow-motion body — which room tone also fills. This
 * bar annotates A1's own gaps; the render's fill is the union of both tracks'.
 *
 * A1 is LINKED to V1 twice over. Geometrically: every horizontal measurement
 * goes through sequencePosToPx, the same per-clip-width + inter-clip-gap layout
 * V1's flex row produces. Measuring the lane as one continuous `sequenceSec *
 * pps` span instead would drift 2px left of the picture per clip boundary (and
 * more under a clip floored to MIN_CLIP_PX), so the bars would stop sitting
 * under the frame they play with. Temporally: the lane STARTS at V1's video
 * start (past any head hold), mirroring the render's adelay — so removing or
 * resizing the hold moves it with the picture. V1's clip dividers and hold
 * markers come from the same bounds, making the link visible rather than merely
 * asserted.
 *
 * Each clip's span comes from its probed container duration, which is what the
 * lane's running offsets are built from. The render instead joins the decoded
 * audio streams, so a file whose audio stream is shorter than its container
 * puts the bars a few ms off what is rendered. The bar is a reference, not the
 * authority; the total is clamped by apad/atrim either way.
 */
export default function AudioBedBar({ beds, clips, sequenceSec, pps, gapPx, muted = false, noiseEnabled = false, onRemove }) {
  // Where V1's picture starts — A1 is delayed to here by the render, so the
  // space it has to fill is the sequence MINUS the head hold.
  const startSec = sequenceVideoStartSec(clips)
  const availSec = Math.max(sequenceSec - startSec, 0)
  const totalBedSec = beds.reduce((sum, b) => sum + (b.durationSec || 0), 0)
  // 1 frame at 60fps of slack — a file cut to length by an external tool lands
  // a few ms off and shouldn't be labelled "shorter" over rounding dust.
  const EPS = 0.017
  const state = totalBedSec < availSec - EPS ? 'short'
    : totalBedSec > availSec + EPS ? 'long'
      : 'exact'

  // Lane width and every internal edge measured in V1's own coordinate space.
  const seqPx = sequencePosToPx(clips, sequenceSec, pps, gapPx)
  const startPx = sequencePosToPx(clips, startSec, pps, gapPx)

  // Timeline position → lane px. Inside the sequence that is V1's own layout.
  // PAST the sequence there are no clips left to measure against, so the
  // overhang is drawn at the plain pixels-per-second rate — the only meaning
  // available there, and it only ever describes audio the render discards.
  // Drawing the overhang rather than clipping it at the edge is deliberate: a
  // clip that starts past the end would otherwise have zero width, which would
  // leave it invisible AND un-removable.
  const posToPx = (sec) => sec <= sequenceSec
    ? sequencePosToPx(clips, sec, pps, gapPx)
    : seqPx + (sec - sequenceSec) * pps

  // Every clip placed at its running offset. Only the WIDTH gets a minimum (so
  // a 0.2s sting still has a clickable × ); the left edge stays true, exactly
  // as V1 floors a clip's box without moving the clips after it.
  const MIN_SEG_PX = 16
  const segs = []
  let cursor = 0
  beds.forEach((bed, index) => {
    const durSec = bed.durationSec || 0
    const fromSec = startSec + cursor
    const left = posToPx(fromSec)
    cursor += durSec
    segs.push({
      bed,
      index,
      durSec,
      fromSec,
      left,
      width: Math.max(posToPx(fromSec + durSec) - left, MIN_SEG_PX),
      // Any part of this clip past the sequence edge is cut at render.
      cut: fromSec + durSec > sequenceSec + EPS,
    })
  })

  const bedPx = Math.max(posToPx(Math.min(startSec + totalBedSec, sequenceSec)) - startPx, 0)
  const laneEndPx = segs.length > 0 ? segs[segs.length - 1].left + segs[segs.length - 1].width : seqPx
  const lanePx = Math.max(seqPx, laneEndPx, 24)
  const bounds = sequenceClipBounds(clips, pps, gapPx)

  return (
    <div className="relative h-full flex-shrink-0" style={{ width: lanePx }}>
      {segs.map(seg => (
        <div
          key={`${seg.index}-${seg.bed.name}`}
          className={`group absolute top-0 bottom-0 rounded border border-emerald-500 bg-gradient-to-b from-emerald-700 to-emerald-900 overflow-hidden ${muted ? 'opacity-40' : ''}`}
          style={{ left: seg.left, width: seg.width, zIndex: 10 }}
          title={
            `${segs.length > 1 ? `A1 clip ${seg.index + 1} — ` : ''}${seg.bed.name} — ${seg.durSec.toFixed(2)}s`
            + `, starting ${seg.fromSec.toFixed(2)}s into the sequence`
            + (seg.index === 0 && startSec > 0 ? ` (with V1's picture, after the head hold)` : '')
            + (seg.cut ? ` — runs past the end of the sequence, so ${Math.min(seg.fromSec + seg.durSec - sequenceSec, seg.durSec).toFixed(2)}s of it is cut` : '')
          }
        >
          <div className="absolute inset-0 flex items-center gap-1 px-1.5 pointer-events-none">
            <span className="text-[8px] text-emerald-100 font-medium truncate">
              {seg.bed.name}
            </span>
            <span className="text-[8px] text-emerald-200/80 font-mono shrink-0">{seg.durSec.toFixed(1)}s</span>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onRemove?.(seg.index) }}
            title="Remove this clip from A1 — the clips after it move up"
            className="absolute top-0 right-0 w-3.5 h-3.5 flex items-center justify-center bg-black/50 hover:bg-red-600 text-white text-[9px] leading-none opacity-0 group-hover:opacity-100 z-20"
          >×</button>
        </div>
      ))}

      {/* What the render pads on when the lane runs out early: silence with the
          toggle off, room tone with it on. Nothing of A1's is playing here, so
          this is exactly the kind of stretch the fill is for and the label can
          say so without qualification. */}
      {state === 'short' && (
        <div
          className="absolute top-0 bottom-0 rounded-r border border-l-0 border-emerald-900/60 overflow-hidden flex items-center justify-center"
          style={{
            left: startPx + bedPx,
            width: Math.max(seqPx - startPx - bedPx, 0),
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(16,185,129,0.14) 0 3px, transparent 3px 6px)',
          }}
          title={
            (noiseEnabled ? 'Room tone' : 'Silence')
            + ` — A1 is ${(availSec - totalBedSec).toFixed(2)}s shorter than the space it has to fill`
            + (noiseEnabled ? ', so room tone fills it instead of digital silence' : '')
          }
        >
          <span className={`text-[7px] font-mono uppercase tracking-wide truncate px-1 ${noiseEnabled ? 'text-amber-500/90' : 'text-emerald-600/90'}`}>
            {noiseEnabled ? 'noise' : 'silence'}
          </span>
        </div>
      )}

      {/* The head hold, which A1 is delayed PAST — labelled, because an empty
          gap at the head of the lane otherwise reads as a bug rather than as
          the audio waiting for the picture to start. With A1 Room Tone on it
          reads "noise": A1 has not started and the held frame brings no sound of
          its own, so the fill reaches here. The block stays fuchsia (it is still
          structurally the head hold, matching V1's hold segments and the
          tail-hold marks below) and only the word goes amber, the color the
          toggle itself uses. */}
      {startPx > 0 && (
        <div
          className="absolute top-0 bottom-0 left-0 rounded-l border border-r-0 border-fuchsia-500/40 bg-fuchsia-500/10 overflow-hidden flex items-center justify-center"
          style={{ width: startPx }}
          title={noiseEnabled
            ? `Room tone — A1 waits out V1's ${startSec.toFixed(2)}s head hold and starts with the picture, so the hold has no sound of its own and room tone fills it`
            : `A1 waits out V1's ${startSec.toFixed(2)}s head hold and starts with the picture`}
        >
          <span className={`text-[7px] font-mono uppercase tracking-wide truncate px-1 ${noiseEnabled ? 'text-amber-400/90' : 'text-fuchsia-400/90'}`}>
            {noiseEnabled ? 'noise' : 'hold'}
          </span>
        </div>
      )}

      {/* The rest of the link to V1: a divider at each clip boundary and a
          tinted span under each remaining hold. A1 plays straight through
          these (only the HEAD hold offsets it), so they're reference marks, not
          A1 segments — hence pointer-events-none and no click targets. */}
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

      {/* Everything past the sequence edge is cut at render. Drawn OVER the
          bars (and pointer-events-none, so their × stays reachable) so the part
          of a clip that survives and the part that doesn't are both visible on
          the clip itself. */}
      {state === 'long' && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none border-l-2 border-red-500/80 flex items-center justify-end"
          style={{
            left: seqPx,
            width: Math.max(lanePx - seqPx, 2),
            zIndex: 15,
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(239,68,68,0.45) 0 3px, rgba(10,10,10,0.72) 3px 6px)',
          }}
          title={`Cut — A1 runs ${(totalBedSec - availSec).toFixed(2)}s past the end of the sequence and this much is never heard`}
        >
          <span className="text-[7px] font-mono uppercase tracking-wide truncate px-1 text-red-300">cut</span>
        </div>
      )}
    </div>
  )
}
