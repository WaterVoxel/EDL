---
name: verify-render
description: Verify a render's frame-level correctness with exact frame hashes — the project's standard proof for lossless/ordering claims
---

This project's correctness bar for anything touching the render pipeline (holds, reverse, speed, trims, quality modes) is **exact frame-hash comparison**, not visual inspection or PSNR. Use this procedure whenever you change `build_timeline_filter`, `encode_args`, or `/api/render_timeline`.

## Steps

1. Ensure Flask is running (see the run-app skill), and **pin quality to lossless first** — `.export_settings.json` is global mutable state and hash checks are meaningless in `match`/`high` modes:

   ```bash
   curl -s -X POST -H "Content-Type: application/json" \
     -d '{"quality":"lossless"}' http://127.0.0.1:5001/api/export_settings
   ```

2. Render a test timeline via the real API (never bypass it — the route does validation the filter builder doesn't). Clip keys: `input, dir, inSec, outSec, headHoldSec, tailHoldSec, roundHoldSec, reversed, speed`:

   ```bash
   curl -s -X POST -H "Content-Type: application/json" -d '{
     "clips":[{"input":"<file-in-input/>","dir":"input","inSec":0.5,"outSec":2.5,
       "headHoldSec":1,"tailHoldSec":0.5,"roundHoldSec":0,"reversed":true,"speed":1}],
     "output":"verify_test.mp4"
   }' http://127.0.0.1:5001/api/render_timeline
   ```

3. Extract per-frame hashes from render and source:

   ```bash
   eval "$(/opt/homebrew/bin/brew shellenv)"
   # from the repo root — the folder containing app.py
   ffmpeg -i output/verify_test.mp4 -map 0:v -f framemd5 - -loglevel error > /tmp/out.framemd5
   ffmpeg -i input/<file> -map 0:v -f framemd5 - -loglevel error > /tmp/src.framemd5
   ```

4. Compare with a proper counter (lines starting `0,` are video frames):

   ```bash
   awk -F, '$1==0{n++; print n-1": "$NF}' /tmp/out.framemd5 | head
   ```

   Frame-index conventions used throughout this codebase:
   - source window `[inSec, outSec)` selects frames `ceil(inSec*fps)` .. `ceil(outSec*fps)-1`
   - the frame *shown at* time t is `floor(t*fps)`
   - a hold of H seconds = `round(H*fps)` consecutive identical frames, equal to the frame adjacent in final playback order (outSec-side frame for a head hold on a *reversed* clip)
   - at speed s, each selected source frame appears ~1/s times consecutively (exactly 2 at 0.5; a 1-2-1 pull at 0.75)
   - reversed = source frames in descending index order

   Assert exact hash equality for every frame — write a small python loop over both hash lists rather than spot-checking.

5. **If you generate synthetic test media, tag its colorspace.** A `lavfi` source (`testsrc`, `color`) is written with `color_space=unknown`/`color_range=unknown`, so putting it next to a real bt709 file makes ffmpeg perform an actual color conversion — the diff then shows a genuine per-pixel difference that looks exactly like "the render isn't lossless" but is only the untagged input. This cost a false negative on the overlay work. Generate test files with the tags spelled out:

   ```bash
   ffmpeg -f lavfi -i "testsrc=size=960x960:rate=30" -t 3 \
     -c:v libx264 -qp 0 -pix_fmt yuv420p \
     -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
     /tmp/overlay_test.mp4
   ```

   Confirm with `ffprobe -show_entries stream=color_space,color_range` on both files before trusting any hash comparison between them.

6. Also check A/V sync: video and audio stream durations within 0.1s:

   ```bash
   ffprobe -v error -show_entries stream=codec_type,duration -of csv output/verify_test.mp4
   ```

7. **Clean up**: delete every test render from `output/` (and any custom export dir), remove /tmp hash dumps, restore any settings you changed, kill the Flask instance if you started it. Never touch files in `input/`.
