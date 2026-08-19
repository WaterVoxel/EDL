# Proposal: package GenAI Editor as a standalone macOS .app

Status: **not implemented**. This is a design doc to pick up later — no
application code has been touched for this. When ready to build it, read
this file, then implement per the plan below (it's meant to be followed
directly, not re-derived).

## Problem

Today the app requires two manually-started dev servers (`python3 app.py`
+ `npm run dev`) plus a pre-existing Homebrew ffmpeg install — fine for
active development, but not something a non-technical recipient on
another Mac can just double-click and use. There is currently **no
packaging documentation or tooling of any kind** in the repo (confirmed:
no electron/pyinstaller/py2app/pywebview references anywhere). The goal is
a real double-clickable `.app` that works for other people on other Macs
(Intel and Apple Silicon) without them installing Python, Node, Homebrew,
or ffmpeg themselves.

Confirmed directly against the current code (not assumed):
- `app.py:939` — `app.run(host="127.0.0.1", port=5001, debug=True)`, run
  only under `if __name__ == "__main__":` (`app.py:938`).
- `CLAUDE_BIN` (`app.py`) — `shutil.which("claude")`, falling back to
  `~/.toolbox/bin/claude`; used only inside `ask_claude()` (`/api/chat`).
  Still unbundleable: an `.app` cannot ship the `claude` CLI, so this
  feature has to degrade gracefully or be cut from the bundle.
- `ffmpeg_utils._tool()` — `FFMPEG`/`FFPROBE` prefer
  `/opt/homebrew/bin/{ffmpeg,ffprobe}` and fall back to PATH. A bundle has
  neither guarantee: it must point these at binaries inside the
  `.app` (see the ffmpeg-bundling section). `PROJECT_ROOT`/`INPUT_DIR`/
  `OUTPUT_DIR`/`PREVIEW_CACHE_DIR` (lines 7-9, 17) are already
  `__file__`-relative and need no change.
- `frontend/package.json` already has `"build": "vite build"` → produces
  `frontend/dist/` with root-absolute asset URLs (no Vite `base` override),
  but nothing in `app.py` serves it today — only the legacy
  `templates/index.html` is served at `/`.
- `.venv` is pinned to Apple Command Line Tools' Python 3.9.6
  (`pyvenv.cfg: home = /Library/Developer/CommandLineTools/usr/bin`) — not
  relocatable, and not a framework build, so it **cannot** be the py2app
  build interpreter (py2app needs a framework Python). This is a
  build-machine-only concern; the existing dev `.venv` is untouched.

## Design

### 1. Packaging technology: py2app + pywebview

Wraps the existing Flask backend + a pre-built `frontend/dist` bundle into
a real `.app` that embeds its own Python runtime and shows the UI in
macOS's built-in WKWebView (via `pywebview`'s Cocoa backend) — no browser
tab, no Chromium bundling (rules out Electron, which would duplicate
process-lifecycle work pywebview+py2app already gets for free by running
Flask in a background thread inside the same process). Toga/briefcase is
rejected outright — it would mean rebuilding the whole React UI in Toga's
own widget model.

**Two separate per-architecture `.app` builds** (not one true-universal2
bundle): python.org's installer itself is universal2, but pywebview's
Cocoa dependencies (`pyobjc-core`, `pyobjc-framework-Cocoa`/`-WebKit`) are
C-extension wheels published per-architecture on PyPI, not as universal2
wheels. Building once natively (arm64) and once under Rosetta
(`arch -x86_64 ...`) with a separate python.org x86_64 interpreter avoids
fragile post-hoc `lipo`-merging of an entire site-packages tree. Ship both
as separate zips, clearly labeled.

### 2. ffmpeg: vendor static per-architecture binaries, verify libx264

Bundle a static `ffmpeg`+`ffprobe` pair per architecture directly in
`Contents/Resources` — sourced from a known static-build provider (e.g.
osxexperts.net), **the GPL variant specifically**, since this app's
lossless mode renders `-c:v libx264 -qp 0` and LGPL static builds commonly
exclude libx264. Verify with `ffmpeg -encoders | grep libx264` on whatever
gets vendored, before wiring it in. Since each `.app` build only contains
its own architecture's binaries, no runtime `platform.machine()` branching
is needed for binary selection — only for *locating* them.

`ffmpeg_utils.py` changes: replace the two literal constants with a
resolver run once at import time:
- **Frozen** (`getattr(sys, "frozen", None) == "macosx_app"`, py2app's own
  flag): resolve `Contents/Resources/ffmpeg`/`ffprobe` relative to
  `sys.executable`'s parent-of-parent directory.
- **Dev** (unfrozen): try `shutil.which("ffmpeg")`/`which("ffprobe")`
  first (this alone fixes the Intel-Homebrew-uses-`/usr/local/bin` gap
  with zero behavior change on this machine), falling back to today's
  exact literals only if `which` finds nothing.

`validate_ffmpeg_command()` (lines ~732/736) needs **no structural
change** — it already reads the module-level `FFMPEG` name for both its
whitelist check and its forced rewrite, so it's automatically correct once
`FFMPEG` is resolved rather than a literal. `probe()`/`run_ffmpeg()` are
the same — no change beyond the constant swap.

### 3. Serving the frontend from inside the bundle

`frontend/dist` is built **at packaging time on the developer's machine**
(`npm run build`, already exists as a script) — never at runtime, never
on a recipient's machine. Two new Flask routes, gated behind the same
`sys.frozen` check so dev mode (`python3 app.py`, Vite dev server on
:5173) is **completely unaffected**:
- A static-assets route serving whatever's under the bundled
  `frontend_dist/assets/` (same `send_from_directory` pattern
  `serve_input`/`serve_output` already use).
- A catch-all at `/` and `/<path:anything>` that serves a matching file
  from `frontend_dist` if one exists, else falls back to
  `frontend_dist/index.html` (standard SPA catch-all; this app has no
  client-side routing beyond the root, so in practice this mostly just
  needs to handle `/` itself).

Both routes resolve `frontend_dist`'s location the same dual-mode way as
the ffmpeg binaries (Section 2) — relative to `sys.executable` when
frozen, inert (not registered) when not.

`app.run()`: the frozen entry point (a **new** file, not `app.py`'s own
`__main__` block) calls `app.run(host="127.0.0.1", port=5001,
debug=False, use_reloader=False)` inside a background daemon thread, then
starts `pywebview` on the main thread pointed at `http://127.0.0.1:5001/`
— pywebview's Cocoa backend must own the main thread. `app.py`'s existing
`if __name__ == "__main__":` block (line 938-939) is untouched; it's never
what py2app actually launches.

### 4. CLAUDE_BIN fix (minimal — no vendoring the `claude` CLI)

Replace the hardcoded literal at `app.py:14` with `shutil.which("claude")`.
If `None`, `/api/chat` returns a clear JSON error stating the chat feature
is optional and needs the CLI tool installed — matching what `README.txt`
already tells users to expect. Explicitly **not** bundling the `claude`
CLI itself (a separate Anthropic tool with its own install/update
lifecycle — out of scope for an ffmpeg-editor packaging task).

### 5. Gatekeeper reality check (deliberately deferred, not solved)

An unsigned, unnotarized `.app` downloaded/AirDropped to someone else will
be blocked by Gatekeeper on first double-click. The real, reliable
workaround: **right-click → Open → confirm Open** (one-time per copy on a
given Mac). Real notarization would need a paid Apple Developer ID
($99/yr), signing every embedded binary (including the vendored
ffmpeg/ffprobe and the Python framework itself), and `notarytool
submit`/`stapler staple` on every rebuild. **Recommendation: defer
notarization for the first pass** — the distribution scope is a small
number of known people, not public distribution, so right-click-Open is
proportionate friction. Write this down explicitly in `PACKAGING.md` as a
deliberate, revisitable decision.

## Files that would be touched/created when this is implemented

| File | Change |
|---|---|
| `ffmpeg_utils.py` | Replace `FFMPEG`/`FFPROBE` literals (lines 10-11) with the dual-mode resolver (Section 2). No other lines change. |
| `app.py` | `CLAUDE_BIN` → `shutil.which` lookup + friendlier `/api/chat` error (Section 4); add the two new frontend-serving routes, gated on `sys.frozen` (Section 3), as a new banner-comment block. `app.run()` call at line 939 stays as-is — dev mode's own entry point, untouched. |
| `requirements.txt` | Add `pywebview`; consider pinning `Flask` (currently bare/unpinned). `py2app` stays a build-machine-only install, not added here. |
| `.gitignore` | Add py2app's `build/`/`dist/` output dirs (distinct from the already-ignored `frontend/dist`). |
| **New:** `packaging/main.py` | py2app entry-point script: imports `app` from `app.py`, runs it in a background thread, starts `pywebview` on the main thread. |
| **New:** `setup.py` | py2app build config (`APP`, `OPTIONS`, `resources`/`data_files` for `frontend/dist` and the vendored ffmpeg binaries, `iconfile`). |
| **New:** `packaging/icon.icns` | App icon — none exists today; placeholder acceptable for v1. |
| **New:** `packaging/ffmpeg-bin/{arm64,x86_64}/{ffmpeg,ffprobe}` | Vendored static GPL binaries, libx264-verified. |
| **New:** `PACKAGING.md` (repo root) | The build/distribution doc — see contents below. |

## `PACKAGING.md` contents (to write when implementation starts)

1. **Overview** — what gets built, who it's for, explicit non-goal (not notarized).
2. **One-time build-machine setup** — python.org universal2 interpreter(s) installed separately from the repo's dev `.venv`; `pip install py2app pywebview` into a fresh venv; sourcing + libx264-verifying the vendored ffmpeg binaries.
3. **Dual-mode path resolution explainer** — why `ffmpeg_utils.py`/`app.py` branch on `sys.frozen`, so it isn't mistaken for dead code later.
4. **Build steps** — the numbered sequence below.
5. **Testing checklist** — launches without Terminal; React UI (not legacy UI) loads; a real render succeeds via the bundled ffmpeg; chat feature fails gracefully without `claude` installed.
6. **Gatekeeper/distribution note** — the right-click-Open instruction verbatim, plus the deferred-notarization rationale.
7. **Known limitations** — two arch-specific `.app`s instead of one universal2 bundle, and why; GPL licensing note if distribution scope ever broadens.

## Build steps

1. One-time: install python.org universal2 interpreter(s); `pip install py2app pywebview` into a dedicated build venv (not the repo's `.venv`); place verified static ffmpeg/ffprobe binaries under `packaging/ffmpeg-bin/<arch>/`.
2. `cd frontend && npm run build`.
3. Apply the code changes above (dual-mode resolver, new routes, `CLAUDE_BIN` fix).
4. Apple Silicon build: `python3 setup.py py2app` (arm64 interpreter) → `dist/GenAI Editor.app`; move aside to `dist-arm64/`.
5. Intel build: `arch -x86_64 <x86_64-python.org-venv>/bin/python3 setup.py py2app` → Intel `.app`.
6. Verify each: launches standalone, shows the React UI, completes a real render via bundled ffmpeg, chat degrades gracefully without `claude` on PATH.
7. `ditto -c -k --sequesterRsrc --keepParent "<app>" "<name>.zip"` per architecture (not plain `zip` — preserves resource forks correctly).
8. Distribute both zips with the right-click-Open instruction included.

## Verification checklist (for whenever this gets implemented)

1. Confirm `PACKAGING.md` exists at the repo root and is self-contained
   enough that a future session could execute the entire build from it
   alone, without re-deriving any of the findings above.
2. Confirm `ffmpeg_utils.py`'s dual-mode resolver doesn't change dev-mode
   behavior on this machine (`python3 app.py` still finds ffmpeg exactly as
   today) — test by running the existing dev server and doing a trim/render.
3. Confirm the new Flask routes are inert in dev mode (`GET /` still
   returns the legacy UI, not a 404 or the React bundle) — `sys.frozen` is
   unset when running via plain `python3 app.py`.
4. Confirm on a clean-ish setup: no Terminal needed to launch, React UI
   loads, a render produces real output, `/api/chat` fails gracefully if
   `claude` isn't on PATH.
