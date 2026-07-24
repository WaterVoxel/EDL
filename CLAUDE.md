# ffmpeg prompt-driven editing workspace

This folder is a workspace for editing media with ffmpeg via natural-language prompts, and also has a local web GUI for the same purpose.

## Setup

- ffmpeg and ffprobe are installed via Homebrew (`/opt/homebrew/bin/ffmpeg`, `/opt/homebrew/bin/ffprobe`).
- If `ffmpeg` is not on PATH, check `/opt/homebrew/bin/` directly.

## Web GUI

The GUI is a React + Vite + Tailwind frontend (`frontend/`) talking to a Flask JSON API backend (`app.py`). Run both servers:

```bash
# terminal 1: Flask API backend
cd ~/Documents/Claude/ffmpeg && source .venv/bin/activate && python3 app.py

# terminal 2: Vite React frontend (HMR dev server)
cd ~/Documents/Claude/ffmpeg/frontend && npm run dev
```

Then open `http://127.0.0.1:5173/`. The Vite dev server proxies all `/api`, `/input`, `/output`, and `/preview` requests to Flask on `:5001` — no CORS needed.

The old vanilla-JS UI is still available at `http://127.0.0.1:5001/` as a fallback during the transition.

Features: drag-drop upload, single-track timeline (drag clip edges to trim, drag to reorder, "Render Sequence" button to apply), Hold Frame form, Reverse form, a chatbot (claude CLI headless) that proposes ffmpeg commands for user confirmation before running, tech-info panels, download with metadata verification.

## Folder layout

- `input/` — user drops source media (video/audio/images) here. **Never modify or delete files in `input/`.**
- `output/` — all edited results go here with descriptive filenames (e.g. `vacation-trimmed-30s.mp4`). Ask before overwriting an existing output file.

## Workflow when the user asks for an edit

1. Run `ffprobe -v error -show_format -show_streams <file>` on the input first to learn duration, resolution, codecs, and streams.
2. Construct the ffmpeg command for the requested edit and run it, writing to `output/`.
3. Verify the result with ffprobe (duration/resolution/codec match the request) and report back.
4. Prefer stream copy (`-c copy`) over re-encoding when the edit allows it (e.g. keyframe-aligned trims, container changes) — it's lossless and fast.

## Quick recipes

| Edit | Command sketch |
|---|---|
| Trim | `ffmpeg -ss <start> -to <end> -i in.mp4 -c copy out.mp4` (re-encode if precise cut needed) |
| Resize | `ffmpeg -i in.mp4 -vf scale=1280:-2 out.mp4` |
| Convert format | `ffmpeg -i in.mov out.mp4` |
| Extract audio | `ffmpeg -i in.mp4 -vn -c:a copy out.m4a` |
| Compress | `ffmpeg -i in.mp4 -c:v libx264 -crf 26 -preset slow -c:a aac -b:a 128k out.mp4` |
| GIF | `ffmpeg -i in.mp4 -vf "fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" out.gif` |
| Concat (same codec) | `ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4` |
| Speed 2x | `ffmpeg -i in.mp4 -vf setpts=PTS/2 -af atempo=2 out.mp4` |
| Remove audio | `ffmpeg -i in.mp4 -an -c:v copy out.mp4` |
| Screenshot at time | `ffmpeg -ss 00:00:05 -i in.mp4 -frames:v 1 out.png` |
