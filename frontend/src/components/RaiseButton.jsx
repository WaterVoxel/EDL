import { sequenceRaise, sequenceRenderFrames, sequenceTargetFps, roundUpAmount } from '../clipMath'

// Raise rounds up the *whole sequence's* total duration, always by holding
// the last frame of the last clip — never an individual clip in isolation,
// since what matters is the final program length landing on a whole second.
//
// It measures the RENDER's length, not the timeline's arithmetic length: they
// differ by up to half a frame per clip, and a slow-down multiplies that. When
// Raise measured the timeline it would offer a round-up on an already-whole
// render — and applying it pushed the render a frame past the whole second it
// advertised — and call a non-whole render "whole". See gotchas.md.
export default function RaiseButton({ clips, setClips }) {
  const { amountSec: amount, wholeSec, exact } = sequenceRaise(clips)
  const lastClip = clips[clips.length - 1] || null

  // `amount > 0` is NOT "the render needs rounding". sequenceRaise measures the
  // base with any existing roundHoldSec STRIPPED — that is what makes a second
  // press replace its own previous answer instead of stacking a second hold — so
  // after a successful Round Up it still reports the same amount it just applied.
  // Left on `amount` alone the button therefore stayed lit on an already-whole
  // sequence, and pressing it rewrote the identical hold: no visible change, but
  // an undo entry and a dirty project. Harmless-looking until the caption came
  // off, at which point a lit button was the only thing the user had to read.
  // So the enabled state is measured on the render AS IT STANDS, hold included —
  // the same number the transport bar shows.
  const targetFps = sequenceTargetFps(clips)
  const shortfall = roundUpAmount(sequenceRenderFrames(clips, targetFps) / targetFps)
  // Three states, and the button is lit in exactly one: not whole AND Round Up
  // has something to add. Not whole with nothing to add is the stale-hold case
  // (a hold left on the last clip while a later edit lengthened the rest of the
  // sequence, so the render runs PAST the second) — Round Up only ever writes a
  // hold, so it genuinely cannot fix that, and offering it would be a lie. The
  // log's round-up warning still names that state in words.
  const canRaise = amount > 0 && shortfall > 0

  function apply() {
    if (!lastClip || !canRaise) return
    setClips(prev => prev.map(c =>
      c.id === lastClip.id ? { ...c, roundHoldSec: amount, dirty: true } : c
    ))
  }

  // No status readout beside the button, and no "Raise" text label either: the
  // button's own "Round Up" says what it does, and the transport bar now states
  // the sequence's rendered length on the render's own frame grid — so a second
  // number here was the same fact twice, from a second measurement that could
  // disagree with the first (it did: "whole (13.9s)" beside a total already
  // reading 00:00:14:00). What's left carries the state without a caption: the
  // button is lit only when a round-up would change something, so it greys out
  // the moment the sequence is whole — which is also the feedback the caption
  // used to give. The tooltip covers the inexact case, and the sequence-level
  // round-up warning in App.logMessages is where a not-whole render is called
  // out in words.
  return (
    <button
      onClick={apply}
      disabled={!canRaise}
      title={exact
        ? 'Hold the last frame of the sequence to round its total duration up to the next whole second'
        : `Holds the last frame to reach ${wholeSec}s. The whole second isn't exactly reachable here — `
          + `the hold is quantized on the last clip's own frame rate, so the render lands a frame or two `
          + `past ${wholeSec}s rather than on it (never short of it).`}
      className="px-1.5 py-0.5 text-[8px] rounded bg-amber-300/15 border border-amber-300/50 text-amber-200 hover:bg-amber-300/25 disabled:bg-transparent disabled:border-neutral-700 disabled:text-neutral-600"
    >
      Round Up
    </button>
  )
}
