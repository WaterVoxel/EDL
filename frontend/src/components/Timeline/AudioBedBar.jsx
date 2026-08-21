import {
  sequencePosToPx, sequenceClipBounds, sequenceVideoStartSec, normalizeBeds,
  bedLaneEndSec, bedPlayedSec, bedInSec, bedOutSec,
} from '../../clipMath'

/* A stretch of the lane with nothing of A1's own in it: silence with A1 Room Tone
 * off, room tone with it on. One component for all three kinds — the head hold,
 * a hole left by a removed clip, and the remainder past a short lane — because
 * the render treats them identically (it fills MEASURED silence, wherever it
 * falls), so drawing them differently would suggest a distinction that isn't
 * there. Only the caller's border/rounding differs, to match what it abuts. */
function GapBlock({ left, width, noiseEnabled, title, className = '' }) {
  return (
    <div
      className={`absolute top-0 bottom-0 overflow-hidden flex items-center justify-center ${className}`}
      style={{
        left,
        width: Math.max(width, 0),
        backgroundImage:
          'repeating-linear-gradient(45deg, rgba(16,185,129,0.14) 0 3px, transparent 3px 6px)',
      }}
      title={title}
    >
      <span className={`text-[7px] font-mono uppercase tracking-wide truncate px-1 ${noiseEnabled ? 'text-amber-500/90' : 'text-emerald-600/90'}`}>
        {noiseEnabled ? 'noise' : 'silence'}
      </span>
    </div>
  )
}

/* The A1 audio lane, drawn as one bar per clip on it, laid end to end under V1.
 *
 * Each clip sits at its own `startSec` — LANE seconds, measured from where V1's
 * picture starts. Clips are added end to end, so a lane normally reads as one
 * continuous run, but the positions are EXPLICIT: removing a clip leaves the
 * others exactly where they were and opens a hole, drawn hatched like any other
 * stretch the render has to fill. What no clip on it has is editable timing of
 * its own — the whole run starts where V1's PICTURE starts, and the render pads
 * it with silence or cuts it at the sequence's end. So these deliberately aren't
 * TimelineClips: there are no head/tail/round segments, no edge-drag trim, no
 * drag-to-reposition and no reorder. The two per-clip edits are remove and
 * SPLIT: clicking a clip selects it (for the toolbar's Split button, which cuts
 * it at the playhead) and, because the click also reaches the lane underneath,
 * moves the playhead to where you clicked — so "click where you want the cut,
 * then press Split" is one gesture. A split clip is two clips playing adjoining
 * parts of one file, which is why a clip's span is its PLAYED length rather than
 * its file's duration.
 *
 * What the lane DOES have to show is how its total length compares to the
 * sequence, which is the one thing the user can't otherwise see and the one
 * thing that changes what they hear:
 *
 *   shorter  → the clips, then a hatched remainder with nothing of A1's own in it
 *   longer   → the overhang past the sequence edge, hatched red and never heard
 *   equal    → flush, no annotation
 *
 * All three compare against where the lane ENDS, not the sum of its durations:
 * with a hole in it those differ, and a lane that ends flush with the sequence
 * would otherwise be called "short" and grow a remainder it doesn't have.
 *
 * `noiseEnabled` (the A1 Room Tone toggle) relabels every annotated gap — the
 * head hold, each interior hole, and the short-lane remainder — to amber "noise",
 * so the lane tracks the button. Each label is exactly true: room tone fills
 * silence and only silence, and these annotations are precisely the stretches
 * where this lane has no sound. The remainder in particular is measured against
 * how far the lane's AUDIO reaches, which is what the render measures too, so a
 * bed whose file is padded with silence gets tone from where the sound stops.
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
 * Each clip's span comes from its probed container duration, which is also what
 * placed the clip after it when it was added. The render instead measures each
 * clip's own audio stream, so a file whose audio stream is shorter than its
 * container puts the bars a few ms off what is rendered. The bar is a reference,
 * not the authority; the total is clamped by apad/atrim either way.
 */
export default function AudioBedBar({
  beds, clips, sequenceSec, pps, gapPx, muted = false, noiseEnabled = false,
  onRemove, selectedIndex = null, onSelect,
}) {
  // Where V1's picture starts — A1 is delayed to here by the render, so the
  // space it has to fill is the sequence MINUS the head hold.
  const startSec = sequenceVideoStartSec(clips)
  const availSec = Math.max(sequenceSec - startSec, 0)
  // Normalized here as well as at add/load time: idempotent and identity-
  // preserving, so it costs nothing on an already-positioned lane and it means
  // this bar can draw a project written before startSec existed.
  const lane = normalizeBeds(beds)
  const laneEndSec = bedLaneEndSec(lane)
  // 1 frame at 60fps of slack — a file cut to length by an external tool lands
  // a few ms off and shouldn't be labelled "shorter" over rounding dust.
  const EPS = 0.017
  const state = laneEndSec < availSec - EPS ? 'short'
    : laneEndSec > availSec + EPS ? 'long'
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
  const segs = lane.map((bed, index) => {
    // The PLAYED length: a clip that has been split occupies only the part of
    // its file it kept, and the clip after it was placed against that.
    const durSec = bedPlayedSec(bed)
    const fromSec = startSec + (bed.startSec || 0)
    const left = posToPx(fromSec)
    return {
      bed,
      index,
      durSec,
      fromSec,
      left,
      width: Math.max(posToPx(fromSec + durSec) - left, MIN_SEG_PX),
      // Any part of this clip past the sequence edge is cut at render.
      cut: fromSec + durSec > sequenceSec + EPS,
      // Plays only part of its file — a half of a split clip. Worth saying in the
      // tooltip, because two bars can carry the same file name.
      trimmed: bedInSec(bed) > 0 || Number.isFinite(bed.outSec),
    }
  })

  // Holes INSIDE the lane — what a removed clip leaves behind. Measured between
  // consecutive clips rather than tracked as their own objects, so there is
  // nothing to keep in sync: the positions are the source of truth and a hole is
  // just the space they don't cover. The stretch before the first clip counts
  // too (removing clip 1 puts the hole at the head), and it is a hole in the LANE
  // — distinct from the head-hold block, which is the space before the lane
  // starts at all.
  const holes = []
  segs.forEach((seg, i) => {
    const prevEndSec = i === 0 ? startSec : segs[i - 1].fromSec + segs[i - 1].durSec
    if (seg.fromSec - prevEndSec > EPS) {
      holes.push({ key: `hole-${i}`, fromSec: prevEndSec, toSec: seg.fromSec })
    }
  })

  const bedPx = Math.max(posToPx(Math.min(startSec + laneEndSec, sequenceSec)) - startPx, 0)
  const laneEndPx = segs.length > 0 ? segs[segs.length - 1].left + segs[segs.length - 1].width : seqPx
  const lanePx = Math.max(seqPx, laneEndPx, 24)
  const bounds = sequenceClipBounds(clips, pps, gapPx)

  return (
    <div className="relative h-full flex-shrink-0" style={{ width: lanePx }}>
      {segs.map(seg => (
        <div
          key={`${seg.index}-${seg.bed.name}`}
          /* No stopPropagation: the click is MEANT to reach the lane behind
             this bar, whose handler moves the playhead to where it landed. One
             click therefore both selects the clip and puts the playhead where
             Split will cut it. The × below does stop it, since removing a clip
             is not a place to put the playhead. */
          onClick={() => onSelect?.(seg.index)}
          className={`group absolute top-0 bottom-0 rounded border border-emerald-500 bg-gradient-to-b from-emerald-700 to-emerald-900 overflow-hidden ${muted ? 'opacity-40' : ''} ${seg.index === selectedIndex ? 'ring-2 ring-sky-400 brightness-110' : ''}`}
          style={{ left: seg.left, width: seg.width, zIndex: seg.index === selectedIndex ? 12 : 10 }}
          title={
            `${segs.length > 1 ? `A1 clip ${seg.index + 1} — ` : ''}${seg.bed.name} — ${seg.durSec.toFixed(2)}s`
            + `, starting ${seg.fromSec.toFixed(2)}s into the sequence`
            + (seg.index === 0 && startSec > 0 ? ` (with V1's picture, after the head hold)` : '')
            + (seg.trimmed ? ` — plays ${bedInSec(seg.bed).toFixed(2)}s to ${bedOutSec(seg.bed).toFixed(2)}s of the file` : '')
            + (seg.cut ? ` — runs past the end of the sequence, so ${Math.min(seg.fromSec + seg.durSec - sequenceSec, seg.durSec).toFixed(2)}s of it is cut` : '')
            + `. Click to select it, then Split to cut it at the playhead`
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
            title="Remove this clip from A1 — every other clip stays where it is, and the gap this leaves plays as silence (or as room tone, with A1 Room Tone on)"
            className="absolute top-0 right-0 w-3.5 h-3.5 flex items-center justify-center bg-black/50 hover:bg-red-600 text-white text-[9px] leading-none opacity-0 group-hover:opacity-100 z-20"
          >×</button>
        </div>
      ))}

      {/* Each hole a removed clip left. Same hatched treatment as the remainder
          past a short lane, because the render fills both the same way. */}
      {holes.map(hole => (
        <GapBlock
          key={hole.key}
          left={posToPx(hole.fromSec)}
          width={posToPx(hole.toSec) - posToPx(hole.fromSec)}
          noiseEnabled={noiseEnabled}
          className="border-y border-emerald-900/60"
          title={
            (noiseEnabled ? 'Room tone' : 'Silence')
            + ` — a ${(hole.toSec - hole.fromSec).toFixed(2)}s gap where an A1 clip was removed; the clips around it kept their positions`
            + (noiseEnabled ? ', and room tone fills it instead of digital silence' : '')
          }
        />
      ))}

      {/* What the render pads on when the lane runs out early: silence with the
          toggle off, room tone with it on. Nothing of A1's is playing here, so
          this is exactly the kind of stretch the fill is for and the label can
          say so without qualification. */}
      {state === 'short' && (
        <GapBlock
          left={startPx + bedPx}
          width={seqPx - startPx - bedPx}
          noiseEnabled={noiseEnabled}
          className="rounded-r border border-l-0 border-emerald-900/60"
          title={
            (noiseEnabled ? 'Room tone' : 'Silence')
            + ` — A1 is ${(availSec - laneEndSec).toFixed(2)}s shorter than the space it has to fill`
            + (noiseEnabled ? ', so room tone fills it instead of digital silence' : '')
          }
        />
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
          title={`Cut — A1 runs ${(laneEndSec - availSec).toFixed(2)}s past the end of the sequence and this much is never heard`}
        >
          <span className="text-[7px] font-mono uppercase tracking-wide truncate px-1 text-red-300">cut</span>
        </div>
      )}
    </div>
  )
}
