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
| `frontend/src/clipMath.js` | `clipSpeed`/`clipMainSec`/`clipTotalSec`/pixel math, `roundUpAmount` (+`ROUND_EPSILON`), `sanitizeHoldPlacement` (hold placement invariant), `nextSplitName`, `clipColor`/`CLIP_PALETTE` (literal Tailwind classes). |
| `frontend/src/cropMath.js` | `CROP_PRESETS` (480p/720p × 6 aspect ratios), `findPreset`/`presetKey`, `cropBoxSize` (fit preset AR into source without upscaling, even-pixel snap), `centeredCropOrigin`, `clampCropOrigin`. Pure functions, used by `CropForm` and `CropOverlay`. |
| `frontend/src/analyzeMath.js` | `analyzeAgainstV1` (clone V1 cuts onto V2 file), `reconstructFromV1` (strip V1's edit artifacts back out of V2's own round-tripped clip(s), in place). Pure functions. |
| `frontend/src/timecode.js` | `formatTimecode` (HH:MM:SS:FF), `parseTimecode` (seconds or colon forms). |
| `frontend/src/fileList.js` | localStorage favorites (`nara-favorites-<dir>`), `sortFiles`, `filterFiles`. |
| `frontend/src/hooks/useTimelinePlayback.js` | rAF playback engine: `resolveTimelinePos` (timeline pos → clip + source time, handling holds/reverse/speed), transport API, `displayClips` override for V2-on-top preview. |
| `frontend/src/hooks/useUndoableState.js` | Undo stack ({present, past} in one state object — StrictMode-safe). |
| `frontend/src/context/MediaContext.jsx` | The single shared `videoRef` + `currentTime` + `activePreview`. |

## Frontend components

| File | What lives there |
|---|---|
| `components/Timeline/Timeline.jsx` | Both lanes, gutter buttons + per-track eye toggles, keyboard shortcuts, drag-reorder for BOTH tracks (`handleDrop`/`handleDrop2`), hold-segment delete for BOTH tracks (`onDeletePart` wired to real handlers on both the V1 and V2 `TimelineClip` maps), playhead math (`GUTTER_PX`, `GAP`, `PPS`), Analize/Reconstruct/Render V2 buttons, V2 drop zone. `focusedTrack`/`selectedId2`/`selectedPart2` are props from App.jsx (not local state) so the shared toolbar there can read them. |
| `components/Timeline/TimelineClip.jsx` | Clip rendering (head/main/tail/round segments), edge-drag trim (speed-aware), per-part selection, hover × deletes. |
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

## Config / other

| File | What lives there |
|---|---|
| `frontend/vite.config.js` | Port 5173 + proxy of `/api`, `/input`, `/output`, `/preview` → `127.0.0.1:5001`. |
| `frontend/.oxlintrc.json` | oxlint config (react/rules-of-hooks = error). |
| `templates/index.html` + `static/app.js` | LEGACY vanilla-JS UI at `:5001/` — feature-frozen fallback, don't extend. |
| `README.txt` | Beginner-oriented plain-text run instructions (user-facing). |
| `CLAUDE.md` (root) | Claude Code index — table of contents for these docs + skills. |
| `input/`, `output/`, `projects/`, `.preview_cache/` | Media in, renders out, saved `.nara` projects, transcoded previews. All gitignored, including `projects/` (though its previously-committed `.nara` files remain tracked). |
