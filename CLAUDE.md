# ffmpeg prompt-driven editing workspace

This folder is a workspace for editing media with ffmpeg via natural-language prompts, and also has a local web GUI for the same purpose.

## Setup

- ffmpeg and ffprobe are installed via Homebrew (`/opt/homebrew/bin/ffmpeg`, `/opt/homebrew/bin/ffprobe`).
- If `ffmpeg` is not on PATH, check `/opt/homebrew/bin/` directly.

## Web GUI

A Flask app (`app.py`) provides drag-and-drop upload plus Trim / Splice / Hold Frame / Reverse forms and an embedded chatbot that turns plain-English instructions into an ffmpeg command (shown for confirmation before it runs). Run it with:

```bash
cd ~/Documents/Claude/ffmpeg
source .venv/bin/activate
python3 app.py
```

Then open `http://127.0.0.1:5001/`. See `app.py` and `ffmpeg_utils.py` for the route/filter implementations; the chatbot shells out to the `claude` CLI in headless mode (`claude -p --tools "" --output-format json --json-schema ...`) and never executes a proposed command without the user clicking Run.

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
