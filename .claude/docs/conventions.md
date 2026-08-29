# Conventions

Patterns actually used in this repo — match them when editing.

## Backend (Python/Flask)

- Single-file Flask app; plain `@app.route` functions returning `jsonify` dicts. No blueprints, no ORM, no async.
- Errors: `{"error": ..., "detail": ...}` with proper status codes — 400 validation, 404 missing file, 500 ffmpeg/probe failure, 502 claude-CLI failure, 504 timeout. ffmpeg failures attach `"detail": result.stderr[-4000:]`.
- `ffmpeg_utils` is always imported as `fu`.
- Every client-supplied path goes through `fu.safe_path(name, base)` (raises `fu.PathError`, caught per-route → 400).
- All subprocess use: `subprocess.run` with argv **list**, `capture_output=True, text=True`, explicit timeout. Never `shell=True`.
- Filter-graph builders return one `;`-joined filter_complex string ending in `[outv][outa]`; callers add `-map "[outv]" -map "[outa]"` then `fu.encode_args(info, get_export_quality())`.
- Multi-input ops (splice, render_timeline) build a `combined_info` dict of per-field **maxima** across inputs so "match" quality targets the best-quality input.
- Output names: `_derive_name(input, suffix)` (e.g. `clip_trimmed.mp4`) then `fu.unique_output_name` for `_1`/`_2` dedupe.
- Route groups separated by `# ---------- name ----------` banners.
- Module-level UPPER_SNAKE constants; private helpers prefixed `_`.
- **Comments are the spec here**: long, load-bearing docstrings explain non-obvious ffmpeg behavior in place (e.g. why `-qp 0`, why the frame cap). Preserve and extend them; never strip them.

## Frontend (React/JS)

- Plain JS — no TypeScript (the `@types/*` packages are editor-support only). `.jsx` for components, `.js` for pure logic.
- Default-export function components, one per PascalCase file. Hooks in camelCase `use*.js` files.
- Pure math lives in `clipMath.js` / `analyzeMath.js` / `timecode.js` / `fileList.js` — testable via `node -e` without React. Keep it that way; new timeline math goes there, not inside components.
- State: immutable `map`/`filter`/spread updates, always setting `dirty: true` on clip mutations. `setClips`-style updaters passed down as props — no Redux/reducer/store library.
- Handlers named `handleX`; callback props named `onX`.
- All HTTP in `src/api.js` as small named-export arrow functions over a shared `postJSON`; relative fetch paths (Vite proxy handles routing).
- Linting: **oxlint** (`npm run lint`), not eslint; config in `frontend/.oxlintrc.json` (react/rules-of-hooks = error).

## Styling (Tailwind v4)

- Tailwind v4 via `@tailwindcss/vite` — `@import "tailwindcss"` in `index.css`, **no tailwind.config file**.
- Dense pro-app sizing with ARBITRARY text sizes: `text-[9px]` labels, `text-[10px]` buttons/inputs, `text-[11px]` list items, `text-[7px]`–`text-[8px]` inside timeline clips. Standard `text-xs/sm` only in dialogs.
- Dark theme: `neutral-950` app background, `neutral-900` panels, `neutral-800` borders.
- Deliberate color coding per feature — keep it consistent:
  indigo = V1/primary/selection · fuchsia = HOLD segments · amber = ROUND + dirty/pending/warnings + favorites · teal = V2/Analyze · cyan = Reconstruct · emerald = Render/success · orange = reversed-active + non-default speed · sky = Splice · violet = Duplicate · red = playhead/stop/destructive.
- Modals: `fixed inset-0 bg-black/60` overlay, close on backdrop click, `stopPropagation` on the panel. Modals are fixed-width (`w-80` in `RenderDialog`), so **two fields side by side need `flex-1 min-w-0` on the wrapper *and* `w-full` on the `<input>`** — `flex-1` alone leaves the item's `min-width: auto` at the input's `size=20` intrinsic width (~161px measured), and two of those overflow a 320px dialog by ~44px with the right-hand field hanging outside it.
- Drag interactions, two idioms and they are not interchangeable. **Dragging a value** (trim edges, playhead, crop handles, gain) = pointer events with document-level listeners added on pointerdown, removed on pointerup, because it needs every intermediate position. **Dragging a thing into a place** (timeline clip reorder in `TimelineClip.jsx`, filing a bin file into a folder in `MediaLibrary.jsx`) = native HTML5 drag — `draggable` + `onDragStart`/`onDragOver`/`onDrop`, `effectAllowed = 'move'`, and state cleared in `onDragEnd` so an abandoned drag (Esc, drop outside) still tidies up. Any HTML5 drop target that can also receive an **OS file drop** must tell them apart with `Array.from(e.dataTransfer?.types || []).includes('Files')` and `preventDefault` only for the one it owns (`Timeline.jsx`, `Dropzone.jsx`).

## Verification culture

This project verifies render correctness with **exact frame hashes**, not visual inspection: `ffmpeg -i file -map 0:v -f framemd5 -` and compare against source frame hashes. PSNR or "looks right" is not sufficient for lossless claims. Test renders are made via `curl` against a live Flask instance and cleaned up afterward; `npx vite build` is run after every frontend change.

## Versioning

- `VERSION` (repo root, one semver line) is the **only** place the version is stored. Adding a reader is free; adding a second store is a bug. See the CLAUDE.md *Versioning* section for the bump/CHANGELOG/tag rule.
- How to read it, per runtime — use the existing channel, never a fresh literal:
  - Python: `APP_VERSION` in `app.py` (read once at import). Exposed to clients as `GET /api/version` → `{"version": "<whatever VERSION holds>"}`.
  - Frontend: `import.meta.env.VITE_APP_VERSION`. `vite.config.js` reads `VERSION` and sets `process.env.VITE_APP_VERSION`, which `loadEnv` sweeps into Vite's env channel. Needs no import, no prop, and no state. `App.jsx` aliases it once as a module-scope `APP_VERSION`. **Do not reach for `define`** — see the gotchas entry; it silently doesn't apply in dev on Vite 8.
  - Shell/skills: `$(cat VERSION)`.
- `frontend/package.json`'s `version` is a derived copy — `vite.config.js` throws on drift, so a stale copy cannot survive a build. Only `bump_version.py` writes it.
- The frontend also fetches `/api/version` at mount purely to *compare* against its own value (a stale bundle against a restarted server shows an amber `⚠` in the toolbar). That fetch is not how the UI learns its own version.
- A change to `VERSION` alone won't reach a running dev frontend — Vite reads it at config time, so restart Vite. Flask's reloader watches it via `extra_files=[VERSION_FILE]`.

## Git

- Imperative one-line commit subjects summarizing multiple changes.
- Version bumps ride in the same commit as the change they ship, then an annotated tag derived from the file, never typed: `git tag -a "v$(cat VERSION)" -m "$(cat VERSION)"`.
- No remote — local-only history on `main`. Tags are local too, which is why they can't be the version's source of truth (the share copy has no `.git/`).
- Gitignored: `.venv/`, `input/`, `output/`, `.preview_cache/`, `frontend/node_modules/`, `frontend/dist/`, `.DS_Store`, `projects/` (already-tracked `.nara` files remain tracked — the ignore only stops new/changed ones from being added).
