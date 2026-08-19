# GenAI Editor

A local, macOS-only, EDL-style video editor: Flask + ffmpeg backend (`app.py`, `ffmpeg_utils.py`) and a React 19 + Vite + Tailwind 4 frontend (`frontend/`). Edits are staged as non-destructive decisions on a two-track timeline and applied in a single lossless ffmpeg pass at Render. Source files in `input/` are never modified. Also doubles as a workspace for one-off ffmpeg edits requested directly in chat.

## Knowledge docs (.claude/docs/)

- [current-work.md](.claude/docs/current-work.md) — **read this first to resume in-progress work** (session checkpoint).
- [architecture.md](.claude/docs/architecture.md) — read before any structural change: backend routes, frontend modules, dev topology, the render pipeline, legacy-UI status.
- [domain-glossary.md](.claude/docs/domain-glossary.md) — read when terms like clip, hold, Raise, Analyze/Reconstruct, V1/V2, dirty, .nara, or quality modes are unclear.
- [conventions.md](.claude/docs/conventions.md) — read before writing code: error shapes, state-update patterns, Tailwind sizing/color coding, verification culture, lint tooling.
- [gotchas.md](.claude/docs/gotchas.md) — read before touching the render pipeline, timeline math, undo, or validation: hand-verified ffmpeg facts (-qp 0 vs -crf 0, fps frame cap, hold-under-reverse) and frontend invariants.
- [key-files.md](.claude/docs/key-files.md) — read to locate where a feature lives (file → responsibility tables).
- [ffmpeg-recipes.md](.claude/docs/ffmpeg-recipes.md) — read when the user asks for a direct ffmpeg edit outside the app: workflow rules + command recipes.

## Install / setup

- [agentic_installation.MD](agentic_installation.MD) (root) — read when asked to install, set up, or repair this app on a machine: dependency install, runtime directories, both servers, and the acceptance gate (`127.0.0.1:5001` + `127.0.0.1:5173` both serving). `README.txt` OPTION A points users here. For a routine restart of an already-installed app, use the **run-app** skill instead.

## Skills (.claude/skills/)

- **run-app** — start/restart the Flask backend + Vite frontend for local dev or live API testing.
- **frontend-build** — compile-check (`npx vite build` from `frontend/`) and lint after any frontend change; includes node-based unit testing of the pure math modules.
- **verify-render** — the project's standard frame-hash verification procedure; use after any change to `build_timeline_filter`, `encode_args`, or `/api/render_timeline`.
- **checkpoint** — save the current session state to current-work.md before clearing context.
