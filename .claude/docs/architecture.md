# Architecture

Nara Lossless Editor is a local, macOS-only, EDL-style video editor: a Flask JSON API backend driving ffmpeg, plus a React 19 + Vite 8 + Tailwind 4 frontend. Every edit (trim, splice, duplicate, reverse, speed, holds, round-up) is staged as plain data on clip objects in React state; nothing touches media on disk until the user clicks Render, which POSTs the clip list to `/api/render_timeline` for a **single-pass ffmpeg render**. Source files in `input/` are never modified.

## Backend (2 files, no database, no async queue)

- **`app.py`** (~800 lines) — all Flask routes, grouped by `# ---------- name ----------` banner comments:
  - Media serving: `GET /input/<name>`, `/output/<name>` (raw), `/preview/<which>/<name>` (browser-playable transcode via `.preview_cache/`, keyed by basename+mtime).
  - Listing/probing: `/api/files`, `/api/outputs`, `/api/probe/<name>?dir=input|output`.
  - Upload/clear: `/api/upload` (2 GB cap), `/api/clear_input`, `/api/clear_output`.
  - Project library: `/api/projects` CRUD — saves `.nara` JSON files into `projects/`.
  - Export settings: `/api/export_settings` GET/POST persisted in `.export_settings.json` (custom `output_dir` + `quality`); `/api/browse_directory` (osascript folder picker), `/api/reveal_file` (`open -R` Finder reveal) — both macOS-only.
  - Editing ops: `/api/trim`, `/api/splice`, `/api/hold_frame`, `/api/reverse` (2 GiB RAM warning + confirm flow), and the main one, `/api/render_timeline` (timeout 1800s).
  - Chatbot: `/api/chat` shells out to the `claude` CLI headlessly (JSON schema, session resume via `-r`); `/api/execute` runs a user-approved command after `validate_ffmpeg_command` gates it.
  - Runs `app.run(host="127.0.0.1", port=5001, debug=True)` — localhost-only by design.
- **`ffmpeg_utils.py`** (~500 lines, always imported as `fu`) — all ffmpeg machinery: hardcoded binary paths, `safe_path` traversal guard, `get_video_info` probe, `encode_args` quality modes, the filter-graph builders (`build_timeline_filter`, `build_concat_filter`, `build_holdframe_filter`), `run_ffmpeg` (prepends binary + `-y`; args must NOT include `ffmpeg`), `unique_output_name`, `validate_ffmpeg_command`.
- `requirements.txt` is literally one word: `Flask`. Python 3.9.6 venv at `.venv/`.

## Frontend (`frontend/src/`)

- **`App.jsx`** (~520 lines) — top-level state owner: file lists, V1 clips via `useUndoableState`, `selectedId` + `selectedPart`, `track2Clips` (plain state) with its own `selectedId2`/`selectedPart2`, `focusedTrack` (which track the shared toolbar row and Delete key act on — lifted here from Timeline.jsx), `centerTab` (`'timeline'|'assistant'|'actions'`, which pane of the center-column dock is visible), `v1Visible`/`v2Visible` (the per-track eye toggles, also lifted out of Timeline.jsx so the preview stage's overlay layers honor them), `v2RenderMode` (`'A'|'AB'` — what the Render V2 button outputs; session-only, not persisted in `.nara`), render/analyze/save/export handlers, panel widths. It derives both overlay sets here too — `overlays` (plain `matchOverlays`, drives the live preview) and `abOverlays` (`{ fullFrameSameSize: true }`, used only when rendering in A/B mode). The toolbar row (Trim/Hold/Reverse/Speed/Crop/Duplicate/Splice/Raise) is passed `activeClips`/`setActiveClips`/`activeSelectedClip`/`setActiveSelectedId` — derived from `focusedTrack` — instead of hardcoded V1 values, so the same components edit whichever track is focused.

### Three-column layout

- **Left** — mirrors the right column's own shape exactly: source preview video, then always-visible Media Info In, then the Media Bin as a `flex-1` card — its file list fills the same remaining column height Export Bin's own list does (`MediaLibrary.jsx` has the identical video/info-slot/flex-1-bin structure `OutputPanel.jsx` does; App.jsx passes `TechInfoPanel` into `MediaLibrary` as `children` so the info panel sits between the two, matching the right column's Media Info Out placement).
- **Center** — Preview stage + edit toolbar, then a tabbed dock (`centerTab`) holding Timeline / AGENT (ChatPanel) / Actions (LogPanel) — only one visible at a time. Timeline is `centerTab`'s default; switching to AGENT/Actions hides the Timeline entirely (not just visually — it unmounts) and the dock grows to fill the column's remaining height instead of Timeline's own fixed content height.
- **Right** — preview video, Media Info Out, then the Export Bin as a `flex-1` card (`OutputPanel.jsx`) — the layout the left column now mirrors.

Both AGENT's and Actions' panes carry `data-tour="agentDock"` (a legacy id both share, since one guided-tour step describes the dock as a whole) — `App.jsx` switches `centerTab` mid-render when the tour reaches a step targeting a tab-gated element, so `TourOverlay` never tries to spotlight something hidden behind an inactive tab.
- **`api.js`** — thin fetch wrappers over every backend endpoint, relative paths (Vite proxy handles routing; no CORS anywhere).
- **Pure logic modules** (deliberately extracted for node-testability): `clipMath.js` (durations, pixels, `sanitizeHoldPlacement`, `nextSplitName`, `CLIP_PALETTE`), `analyzeMath.js` (`analyzeAgainstV1`, `reconstructFromV1`), `cropAnimation.js` (keyframe interpolation/retiming), `overlayMatch.js` (`matchOverlays` — which V2 clips composite onto V1), `timecode.js`, `fileList.js` (localStorage favorites/sort/filter).
- **Hooks**: `useTimelinePlayback.js` (rAF scrub-loop playback engine + transport API), `useUndoableState.js` (undo stack).
- **`context/MediaContext.jsx`** — shares ONE `videoRef` + `currentTime` + `activePreview` across MediaLibrary, PreviewPlayer, Timeline, and SpliceButton.
- **`components/Timeline/`** — Timeline.jsx (lanes, gutter, keyboard, drag-reorder, V2 buttons + the A / A/B render-mode switch beside Render V2), TimelineClip.jsx (head/main/tail/round segments, edge-drag trim), TransportBar.jsx, Playhead.jsx, Ruler.jsx, EdlTable.jsx.
- **`components/`** — toolbar forms (HoldFrameForm, TrimForm, ReverseForm, SpeedForm, RaiseButton, SpliceButton, DuplicateButton), panels (MediaLibrary, OutputPanel, TechInfoPanel, LogPanel, ChatPanel), dialogs (RenderDialog, ProjectLibrary, ExportSettings, AboutDialog), utilities (Dropzone, PreviewPlayer, OverlayPreview, DownloadButton, NumericStepper, ClearButton, SortFilterBar, ContextMenu).

## Dev topology

Two servers, always: Flask on `127.0.0.1:5001`, Vite dev server on `127.0.0.1:5173` proxying `/api`, `/input`, `/output`, `/preview` to Flask (see `frontend/vite.config.js`). The React UI 404s on every fetch if Flask isn't running. `frontend/dist/` exists from past builds but **nothing serves it** — dev mode is the only supported way to run the React UI.

## Legacy UI

`templates/index.html` + `static/app.js` (~490 lines vanilla JS) is served by Flask at `http://127.0.0.1:5001/` — a functional but feature-frozen fallback (upload, trim, splice, hold, reverse with the old two-click confirm, chat). It has none of the newer features (timeline render, projects, export settings, speed, raise, split, V2). Don't add features to it.

## Render pipeline (the heart of the app)

`/api/render_timeline` → per-clip validation → `fu.build_timeline_filter(clip_specs, ...)` builds one `filter_complex` string: per clip, optional **overlay composite** (a V2 region placed back on the raw frame at animated keyframe coordinates) → optional `crop` (also keyframe-animatable) → `split` if that filter-produced source feeds more than one chain → optional lead freeze (trim one frame + loop) → trimmed main segment (with `reverse`/`areverse` and/or `setpts` speed stretch) → optional trail freeze → concat pieces → normalize to max resolution/fps across inputs (scale/pad/setsar/fps + hard frame cap) → concat all clips into `[outv][outa]` → one `run_ffmpeg` call with `encode_args(combined_info, get_export_quality())`.

Two ordering facts are load-bearing. **Overlay comes before crop**: cropping first would throw away the very pixels the overlay is composited back onto. **Both come before trim/reverse/speed**, so their keyframe `t` is always *source* time — one `keyframe_ladder` (module-level in `ffmpeg_utils.py`) generates the piecewise-linear `if(lt(t,…))` expression for both filters, and holds/reverse/slow-mo/concat then inherit correct behavior with no overlay-specific handling anywhere downstream. Each overlay gets its own `-i` even when two clips use the same file, since a filter graph can't consume one input pad twice. Overlays deliberately do **not** influence the render's target resolution (`effective_wh`) — the frame size is V1's.

There is exactly one way to reach a composite render: **Render V2 with its toggle on A/B**. `handleRenderV2Click` branches on `v2RenderMode` — `A` renders the V2 track alone as before, `AB` renders V1 with `abOverlays` attached (`clipsToPayload` nulls the overlaid V1 clips' `crop`/`cropKeyframes` and hangs an `overlay` object off each spec). Nothing else in the app produces `overlay` specs; the live `OverlayPreview` layers are purely visual.
