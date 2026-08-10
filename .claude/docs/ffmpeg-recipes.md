# Direct ffmpeg Editing (outside the app)

This workspace is also used for one-off ffmpeg edits requested in chat, independent of the Nara UI. Rules and recipes for that workflow.

## Rules

- `input/` holds source media — **never modify or delete files in `input/`**.
- All results go to `output/` with descriptive filenames (e.g. `vacation-trimmed-30s.mp4`). Ask before overwriting an existing output.
- Binaries live at `/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/ffprobe` (not on PATH by default — `eval "$(/opt/homebrew/bin/brew shellenv)"` first).

## Workflow for an edit request

1. `ffprobe -v error -show_format -show_streams <file>` on the input first — learn duration, resolution, codecs, streams.
2. Construct and run the ffmpeg command, writing to `output/`.
3. Verify the result with ffprobe (duration/resolution/codec match the request) and report back.
4. Prefer stream copy (`-c copy`) over re-encoding when the edit allows it (keyframe-aligned trims, container changes) — lossless and fast.

## Quick recipes

| Edit | Command sketch |
|---|---|
| Trim | `ffmpeg -ss <start> -to <end> -i in.mp4 -c copy out.mp4` (re-encode if precise cut needed) |
| Resize | `ffmpeg -i in.mp4 -vf scale=1280:-2 out.mp4` |
| Convert format | `ffmpeg -i in.mov out.mp4` |
| Extract audio | `ffmpeg -i in.mp4 -vn -c:a copy out.m4a` |
| Compress | `ffmpeg -i in.mp4 -c:v libx264 -crf 26 -preset slow -c:a aac -b:a 128k out.mp4` |
| Lossless re-encode | `ffmpeg -i in.mp4 -c:v libx264 -qp 0 -preset medium out.mp4` (`-qp 0`, NOT `-crf 0` — see gotchas.md) |
| GIF | `ffmpeg -i in.mp4 -vf "fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" out.gif` |
| Concat (same codec) | `ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4` |
| Speed 2x | `ffmpeg -i in.mp4 -vf setpts=PTS/2 -af atempo=2 out.mp4` |
| Remove audio | `ffmpeg -i in.mp4 -an -c:v copy out.mp4` |
| Screenshot at time | `ffmpeg -ss 00:00:05 -i in.mp4 -frames:v 1 out.png` |
