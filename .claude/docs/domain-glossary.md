# Domain Glossary

Terms a new engineer needs before touching this codebase.

- **EDL (Edit Decision List)** — the editing model: the timeline is a list of edit *decisions* (source, IN/OUT, holds, reversed, speed), not a working copy of media. Applied only at Render. The EdlTable renders it with SMPTE-style source/record timecodes; exportable as a CMX-style `.edl` file.

- **Clip** — one timeline entry. Full data model (created in `App.jsx handleAddToTimeline`):
  `{ id (UUID), sourceName, sourceDir ('input'|'output'), sourceDurationSec, sourceWidth, sourceHeight, fps, inSec, outSec, headHoldSec, tailHoldSec, roundHoldSec, reversed, speed, crop, dirty, displayName? }`
  `sourceDurationSec` is the **video stream's** duration, not the container's (see gotchas.md).

- **Hold (head/tail)** — freeze-frame extension attached only to the sequence's outer edges: `headHoldSec` freezes the first visual frame before the first clip; `tailHoldSec` freezes the last frame after the last clip. Implemented server-side as a one-frame `trim` + `loop`, with `anullsrc` silence for the audio. Fuchsia segments in the UI; individually selectable/deletable via `selectedPart`. Applying duration 0 in HoldFrameForm is the documented way to remove a hold.

- **Round / Raise** — `RaiseButton` rounds the WHOLE SEQUENCE duration (`sequenceBaseSec`) up to the next whole second by adding `roundHoldSec` to the last clip. Amber ROUND segment. Server-side it just adds to tailHoldSec (freezing an already-frozen frame is a pixel no-op).

- **dirty** — per-clip flag: "this decision hasn't been rendered yet." Amber dashed border + "pending" EDL status; cleared track-wide after a successful render.

- **V1 / V2 tracks** — V1 is the main edit lane and the single source of truth for playhead/ruler/transport timing and undo. V2 is a scratch reference lane (Analyze/Reconstruct results or a raw dropped file), composited "on top" for the preview when visible, NLE-style. V2 is outside the undo history, but is otherwise a fully editable clip list — Trim/Hold/Reverse/Speed/Crop/Duplicate/Splice/Raise, drag-to-reorder, and per-hold-segment delete all work on V2 exactly like V1. The shared toolbar row (`App.jsx`) redirects to whichever track is currently focused (`focusedTrack`, lifted from Timeline.jsx into App.jsx) — clicking a clip on either track focuses that track and the toolbar acts on it; clicking the V1/V2 gutter label buttons focuses a track directly. `App.jsx` derives `activeClips`/`setActiveClips`/`activeSelectedClip`/`setActiveSelectedId` from `focusedTrack` and passes those into the toolbar components unchanged — none of the 9 toolbar components know or care which track they're editing.

- **Analyze** — clones V1's cut structure (same inSec/outSec and hold durations, never reversed, no speed) onto the file dropped on V2 (`analyzeAgainstV1` in `analyzeMath.js`). Overflow past V2's end is clamped and logged. The button is literally labeled **"Analize"** (sic) — existing product copy, don't silently fix.

- **Reconstruct** — step 2 of a round-trip: after Analyze conforms V2 to V1 and the user takes that V2 footage through an external tool and drops the result back onto V2 (`handleAddToV2` always replaces V2 with a single fresh clip — Render V2 always merges everything into one file first), Reconstruct strips V1's edit artifacts back out of V2's *own* clip — it never touches or copies V1's `sourceName` (`reconstructFromV1`). Holds/round-up are treated as SEQUENCE-level facts about V1 (headHold from V1's first clip, tailHold+roundHold from V1's last — same convention as `sanitizeHoldPlacement`/`RaiseButton`), trimmed off V2's window since they're baked-in duplicate frames; reversed is copied as-is (not toggled) only when every V1 clip agrees on it — a mixed forward/reversed V1 sequence can't be represented by one flat V2 clip, so that case warns and leaves V2's flag untouched; speed resets to 1; crop resets to null (unrecoverable — those pixels don't exist in the round-tripped file). Requires clips on both V1 and V2.

- **Splice** — splits the selected clip at the shared preview's `currentTime` into two clips named via `nextSplitName` (`Video01`, `Video02`, …). Each half needs > 0.1s (`MIN_PART_SEC`).

- **Speed** — slow-motion-only per-clip rate from `PRESET_SPEEDS`, filtered by `allowedSpeeds` so effective fps (source fps × speed) stays ≥ `MIN_EFFECTIVE_FPS = 12`. Pure PTS stretch (`setpts=(1/speed)*PTS`) — no interpolated frames; slowed segments get silent audio.

- **Crop** — per-clip spatial crop to a fixed preset resolution (480p/720p × 6 aspect ratios, `cropMath.js CROP_PRESETS`), stored as `clip.crop = { key, w, h, x, y }` in source-pixel coordinates. `CropForm` picks the preset (box auto-sized to fit the source without upscaling, then centered); `CropOverlay` lets the user drag the box on the live preview (positioned against the `<video>` element's own rendered rect, since it's letterboxed via `object-fit: contain`). Applied server-side as the first filter step per clip (`crop=w:h:x:y`, before trim/reverse/speed) so holds crop identically to the main body; the render's common target resolution is derived from post-crop dimensions.

- **Export quality modes** — `EXPORT_QUALITIES = ("lossless", "match", "high", "under50mb", "under50mb_hevc")` in `ffmpeg_utils`: lossless = `-qp 0` bit-exact; match = ABR at the source's own video bitrate (1.5× maxrate); high = CRF 18; under50mb = a hard 50MB size cap that outranks quality, via two-pass ABR sized from the render's duration (see `render_size_capped`, `target_bitrate_for_size`) plus a measure-the-real-output-and-retry loop — not produced by `encode_args` since two-pass needs two full ffmpeg invocations, not one args list. under50mb_hevc is the same size-capped mode with `codec="hevc"`: libx265 Main10 profile (`yuv420p10le` intermediate) at preset `medium` instead of libx264 at preset `slow` — better quality per bit, much slower to encode, and not browser-playable (gets transcoded for in-app preview like any other non-`BROWSER_SAFE_VIDEO_CODECS` output). Audio in lossless/match/high: AAC at `max(source bitrate, 192000)`; both under50mb modes use a lower floor (96000) and squeeze it further if the byte budget is tight enough that video would otherwise fall below its own 100kbps floor. Selected globally in `.export_settings.json`.

- **selectedPart** — which piece of the selected clip is active: `'main' | 'head' | 'tail' | 'round'`. Lets a hold segment be deleted (Delete key / hover ×) without deleting its clip.

- **.nara project** — JSON `{ version: 2, clips, track2Clips, selectedId }`, saved to `projects/` via `/api/projects` or downloaded as a file. Version 2 added `track2Clips`. The backend treats it as opaque JSON except validating `clips` is a list.

- **video_duration vs duration** — `get_video_info` returns both: `duration` = container (longest stream, often audio); `video_duration` = video stream only, can be shorter. All frame-freeze sampling and outSec clamping use `video_duration`.

- **Frame budget (`n_norm_frames`)** — `build_timeline_filter` precomputes the exact frame count each normalized clip segment must emit and hard-caps the chain with `trim=start_frame=0:end_frame=N`, padding/cutting audio to the same length. See gotchas.md for why.

- **browser_playable** — probe flag; false means the codec isn't in `BROWSER_SAFE_VIDEO_CODECS` {h264, vp8, vp9, av1}, and the UI swaps the media URL to the `/preview/<dir>/<name>` transcode route (cached in `.preview_cache/`).

- **PPS** — pixels per second (60) for timeline layout math (`clipMainPx` etc. in `clipMath.js`).

- **Media Bin / Exports** — left panel = source files in `input/`; right panel = rendered files in the export dir. Both have localStorage favorites, filter, and sort (`fileList.js`, keys `nara-favorites-<dir>`).
