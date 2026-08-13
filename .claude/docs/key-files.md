# Key Files

Where to look for what. Paths relative to the repo root.

## Backend

| File | What lives there |
|---|---|
| `app.py` | Every Flask route (media serving, listing/probe, upload, projects, export settings, trim/splice/hold/reverse/render_timeline, chat/execute). `CLAUDE_BIN` constant. Route groups separated by banner comments. |
| `ffmpeg_utils.py` | Imported as `fu`. `FFMPEG`/`FFPROBE` paths, `INPUT_DIR`/`OUTPUT_DIR`, `ALLOWED_EXTENSIONS`, `safe_path`, `get_video_info`, `encode_args` + `EXPORT_QUALITIES`, `get_or_make_preview`, `run_ffmpeg`, `unique_output_name`, `build_timeline_filter` (the main render graph builder), `build_concat_filter`, `build_holdframe_filter`, `estimate_reverse_memory_bytes`, `validate_ffmpeg_command`. |
| `requirements.txt` | `Flask` (that's all). |
| `.export_settings.json` | Runtime-written: optional `output_dir` override + `quality` mode. Global mutable state. |

## Frontend core

| File | What lives there |
|---|---|
| `frontend/src/App.jsx` | Top-level state (V1 clips w/ undo, V2 clips, per-track selection, `focusedTrack`, `centerTab`, panels), clip creation (`handleAddToTimeline`), render flow (`clipsToPayload` → `handleRenderConfirm`), Analyze/Reconstruct handlers, project save/open/export, EDL export, layout JSX. The shared toolbar row derives `activeClips`/`setActiveClips`/`activeSelectedClip`/`setActiveSelectedId` from `focusedTrack` so Trim/Hold/Reverse/Speed/Crop/Duplicate/Splice/Raise act on whichever track (V1 or V2) is focused. The center column's Timeline/AGENT/Actions dock is one `centerTab`-gated block — left column is Media Info In above Media Bin. |
| `frontend/src/api.js` | One fetch wrapper per backend endpoint. |
| `frontend/src/clipMath.js` | `clipSpeed`/`clipMainSec`/`clipTotalSec`/pixel math, `roundUpAmount` (+`ROUND_EPSILON`), `sanitizeHoldPlacement` (hold placement invariant), `nextSplitName`, `clipColor`/`CLIP_PALETTE` (literal Tailwind classes). Also the **V1 lane geometry** any other lane has to align to: `MIN_CLIP_PX`/`clipRenderedPx` (the 24px floor `TimelineClip` draws), `sequencePosToPx` (timeline seconds → X inside a lane laid out with V1's per-clip widths + 2px flex gaps), `sequenceClipBounds` (per-clip left/width + head/tail hold spans) and `sequenceVideoStartSec` (where V1's picture starts — clip 0's head hold; mirrors `bed_offset_sec` in the render). `AudioBedBar` measures every edge with these — see the gotchas entry on why `sequenceSec * pps` is the wrong width. |
| `frontend/src/cropMath.js` | `CROP_PRESETS` (480p/720p × 6 aspect ratios), `findPreset`/`presetKey`, `cropBoxSize` (fit preset AR into source without upscaling, even-pixel snap), `centeredCropOrigin`, `clampCropOrigin`. Pure functions, used by `CropForm` and `CropOverlay`. |
| `frontend/src/analyzeMath.js` | `analyzeAgainstV1` (clone V1 cuts onto V2 file), `reconstructFromV1` (strip V1's edit artifacts back out of V2's own round-tripped clip(s), in place). Pure functions. |
| `frontend/src/overlayMatch.js` | `matchOverlays(v1, v2, opts)` (pair V2 clips onto V1 clips by order; classify each as a composite or a warned/silent skip; `opts.fullFrameSameSize` is what the A/B render toggle opts into), `overlayForV1Clip`, `hasOverlays`, the `SKIP_*` reason constants. Decides the whole V2-as-overlay feature; import-clean, so node-testable. |
| `frontend/src/cropAnimation.js` | Crop keyframe math: `sampleCropOrigin` (piecewise-linear interpolation at a source-relative `t` — used by both `CropOverlay` and `OverlayPreview`), `addKeyframe`, `maxKeyframeOrigin`, `retimeKeyframesForTrim`. |
| `frontend/src/timecode.js` | `formatTimecode` (HH:MM:SS:FF), `parseTimecode` (seconds or colon forms). |
| `frontend/src/fileList.js` | localStorage favorites (`nara-favorites-<dir>`), `sortFiles`, `filterFiles`. |
| `frontend/src/hooks/useTimelinePlayback.js` | rAF playback engine. The timeline-pos → clip + source-time mapping (holds/reverse/speed) now lives in `clipMath.js` as `buildSegments` + `segmentAt` — this hook memoizes the segment list and calls `segmentAt`; the old `resolveTimelinePos` is gone. Also the transport API (`getTimelinePos`, which `AudioBedPlayer` slaves to) and the `displayClips` override for V2-on-top preview. |
| `frontend/src/hooks/useUndoableState.js` | Undo stack ({present, past} in one state object — StrictMode-safe). |
| `frontend/src/context/MediaContext.jsx` | The single shared `videoRef` + `currentTime` + `activePreview`. |

## Frontend components

| File | What lives there |
|---|---|
| `components/Timeline/Timeline.jsx` | All three lanes, gutter buttons + per-track eye toggles, keyboard shortcuts, drag-reorder for BOTH tracks (`handleDrop`/`handleDrop2`), hold-segment delete for BOTH tracks (`onDeletePart` wired to real handlers on both the V1 and V2 `TimelineClip` maps), playhead math (`GUTTER_PX`, `GAP`, `PPS`), Analize/Reconstruct/Render V2 buttons + the A / A/B render-mode switch beside Render V2, V2 drop zone, A1 drop zone. `focusedTrack`/`selectedId2`/`selectedPart2`/`v1Visible`/`v2Visible`/`v2RenderMode` are props from App.jsx (not local state) so the shared toolbar and preview stage there can read them. The A1 lane sits INSIDE `timelineRef` so the absolute `<Playhead>` and click-to-seek span it with no extra math; its gutter is a plain `A1` label + an eye, with no focus button (the bed isn't clip-shaped) and no mute button. |
| `components/Timeline/TimelineClip.jsx` | Clip rendering (head/main/tail/round segments), edge-drag trim (speed-aware), per-part selection, hover × deletes. |
| `components/Timeline/AudioBedBar.jsx` | The A1 bed drawn as one bar, with the three spatial states that are the only thing the user can't otherwise see: **shorter** than the V1 sequence (bar + hatched "silence" remainder), **longer** (clipped at the sequence edge + a red cut marker), **equal** (flush). `EPS = 0.017` (1 frame at 60fps) keeps rounding dust out of "shorter", and the states are measured against `availSec = sequenceSec - startSec` (a 2 s bed under a 3 s sequence with a 1 s head hold is **exact**, not short). **Linked to V1 twice over.** Geometrically: it takes `clips` + `gapPx` and measures every edge through `sequencePosToPx`, so it sits under V1's actual pixels rather than over a continuous `sequenceSec * pps` span that drifts 2px per clip boundary. Temporally: it starts at `sequenceVideoStartSec` rather than `left-0`, mirroring the render's `adelay`, with a labelled fuchsia "hold" block filling the head so the gap doesn't read as a bug. Draws a divider at each clip boundary and a fuchsia tint under each *remaining* (tail/round) hold from `sequenceClipBounds`; those marks are `pointer-events-none` reference overlays, not bed segments — only the head hold offsets the bed, and it plays straight through the rest. Deliberately not a `TimelineClip` — a bed has no head/tail/round segments, no edge-drag trim, and no reorder. |
| `components/Timeline/AudioBedPlayer.jsx` | Best-effort preview audio: a hidden `<audio>` slaved to `transport.getTimelinePos()` in a rAF loop, which makes the bed **timeline-locked, not source-locked** — so it plays straight through mid-sequence holds, reverse, and slow-mo, matching the render where the bed is `apad`-ed flat across the sequence. Takes a `startSec` prop (V1's picture start) read through a ref so a hold edit doesn't restart playback mid-scrub: source time is `timelinePos - startSec`, and while that is negative the element is held **paused at 0**, matching the render's leading silence rather than playing the bed over the frozen frame. Tolerances are OverlayPreview's (0.005 s paused, 0.12 s playing). `volume = BED_GAIN` mirrors the backend. Falls back to `/preview/<dir>/<name>` on a format the browser refuses. Mounts inside the Timeline subtree, so the bed goes silent on the AGENT/Reformat/Actions tabs. |
| `components/Timeline/TransportBar.jsx` | Play/stop, frame stepping, first/last, loop, editable timecode with TC/frames toggle. |
| `components/Timeline/EdlTable.jsx` | SMPTE-style EDL table (EVT/REEL/SRC/REC/HOLD/STATUS). |
| `components/OutputPanel.jsx` | Exports list + preview + Media Info Out + right-click "Show destination" context menu. Left column's `MediaLibrary.jsx` mirrors this exact video/info/flex-1-bin structure. |
| `components/MediaLibrary.jsx` | Source files list (Media Bin) + its own preview `<video>`, structured to match `OutputPanel.jsx`: video (shrink-0), an info-panel slot (`children`, filled by App.jsx with `TechInfoPanel`), then the bin itself as a `flex-1` card so its list height matches Export Bin's. |
| `components/ExportSettings.jsx` | Quality mode dropdown + export directory with native Browse. |
| `components/ChatPanel.jsx` | "Agentic Assistant Editor" — claude-CLI chat with Run/Cancel confirmation. Rendered on App.jsx's AGENT tab (center-column dock, sibling of Timeline/Actions), no dock-specific sizing of its own (`flex-1 min-h-0`). |
| `components/LogPanel.jsx` | Clip-activity log (round-up warnings, unrendered-edit notices). Rendered on App.jsx's Actions tab, same dock as ChatPanel/Timeline. |
| `components/AboutDialog.jsx` | The in-app product manual (opens from the NARA title). |
| Toolbar forms | `HoldFrameForm` (Head/Tail), `TrimForm`, `CropForm` (preset dropdown), `DuplicateButton`, `ReverseForm`, `SpeedForm` (`allowedSpeeds`, `MIN_EFFECTIVE_FPS=12`), `RaiseButton`, `SpliceButton`. |
| `components/CropOverlay.jsx` | Draggable crop-box overlay on the preview `<video>` — positions itself against the video element's own rendered rect (`getBoundingClientRect`), scaled from native to on-screen pixels. |
| `components/OverlayPreview.jsx` | Live composite of a V2 overlay clip: a SECOND `<video>` layered over the preview, sized to the crop box and moved along its keyframe curve from a rAF loop, following the main video's clock. One instance per resolved overlay, mounted under `CropOverlay` in App.jsx's preview stage. |

## Config / other

| File | What lives there |
|---|---|
| `frontend/vite.config.js` | Port 5173 + proxy of `/api`, `/input`, `/output`, `/preview` → `127.0.0.1:5001`. |
| `frontend/.oxlintrc.json` | oxlint config (react/rules-of-hooks = error). |
| `templates/index.html` + `static/app.js` | LEGACY vanilla-JS UI at `:5001/` — feature-frozen fallback, don't extend. |
| `README.txt` | Beginner-oriented plain-text run instructions (user-facing). |
| `CLAUDE.md` (root) | Claude Code index — table of contents for these docs + skills. |
| `input/`, `output/`, `projects/`, `.preview_cache/` | Media in, renders out, saved `.nara` projects, transcoded previews. All gitignored, including `projects/` (though its previously-committed `.nara` files remain tracked). |
