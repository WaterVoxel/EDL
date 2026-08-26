# Stability Audit — GenAI Editor

Living tracker for the codebase audit run against **0.28.0** (2026-08-25). One entry per root
cause, ranked most urgent first. Update the **Status** line and the summary table as each is
fixed; do not delete entries — a fixed entry with its repro is the record that it stays fixed.

## Working rules — read before fixing anything

These are binding for every entry in this file.

### Scope discipline

- **Do not rewrite, restructure, or modify any existing logic or behavior outside the current
  task.**
- **Do not add new features, and do not remove existing ones.**
- **Focus exclusively on the specific issue at hand — fix only what is broken or explicitly
  requested, nothing more.**
- **Do not refactor, reorganize, or alter any code, content, or structure that is not directly
  related to the current issue being addressed.**

Anything noticed along the way that is out of scope gets **written down in this file**, not fixed
in passing. If a fix appears to require touching something outside its scope, stop and raise it
rather than widening the change unilaterally.

### The same rule applies to Markdown files

When editing any Markdown file in this project (including this one, `CLAUDE.md`, `CHANGELOG.md`,
and the docs under `.claude/docs/`): **do not rewrite, restructure, or modify any existing logic or
behavior. Do not add new features or remove existing ones. Focus exclusively on the specific issue
at hand — fix only what is broken or explicitly requested, nothing more. Do not refactor,
reorganize, or alter any code, content, or structure that is not directly related to the current
issue being addressed.**

In practice: insert or amend the specific lines the task calls for and leave the surrounding
document — its headings, ordering, wording and formatting — exactly as found.

### Documentation duty

For every issue worked, record in this file, under that issue's entry:

- **Changes made** — each file and what was changed in it.
- **Reasoning** — why that fix, and why not the alternatives considered.
- **Observations** — anything found along the way, including out-of-scope problems noticed (logged,
  not fixed), assumptions made, and anything that turned out to differ from what this audit
  originally claimed.
- **Verification** — what was actually run to prove the fix works, with real output.

Flip the entry's **Status** line and its row in the status table in the same edit.

## How this was produced

8 concern-split audit lanes (subprocess lifecycle, resources/cleanup, backend concurrency,
frontend async, malformed input, portability, render math, state consistency), each followed by an
adversarial refuter whose job was to kill every finding before it was reported. 51 raw findings →
1 refuted outright, 4 downgraded on severity, the rest survived and were then de-duplicated by
hand into the 14 root causes below (the lanes overlapped heavily — e.g. the preview-cache bug was
found independently by 5 of them).

**Confidence levels** are recorded per entry and mean exactly this:
- `VERIFIED` — the bad behaviour was observed by running code; the evidence quoted is real output.
- `TRACED` — the code path was followed line by line and cannot behave otherwise.
- `PLAUSIBLE` — the path looks wrong but nobody could trigger it.

**Two caveats on the method, recorded so they are not forgotten:**
1. **#2 is unjudged.** The backend-concurrency lane crashed on an API error and was re-run; its
   refuter then also crashed. The finder's evidence is strong (5/5 reproductions) and the code
   shape was confirmed by reading, but no adversary ever attacked it. Re-run the refutation before
   acting on it.
2. A 1-in-51 refutation rate means the refuters were permissive. The ranking below is a hand
   re-triage, not the raw agent output.

## Status

| # | Urgency | Root cause | Where | Confidence | Status |
|---|---------|-----------|-------|-----------|--------|
| 1 | HIGH | Audio/video drift: renders disagree with the timeline | `ffmpeg_utils.py:2199` | VERIFIED | **FIXED** (0.30.0) |
| 2 | HIGH | Two same-name renders destroy each other | `app.py:1271` | VERIFIED *(unjudged)* | NOT STARTED |
| 3 | HIGH | A failed preview poisons the cache permanently | `ffmpeg_utils.py:928` | VERIFIED | NOT STARTED |
| 4 | HIGH | Export-Bin split-brain: lists one dir, reads another | `app.py:91,130` | VERIFIED | NOT STARTED |
| 5 | HIGH | Saving a project can destroy another with no prompt | `app.py:211` | VERIFIED | **FIXED** (0.29.0) |
| 6 | HIGH | Silent failure: timeouts + non-JSON errors show nothing | `frontend/src/api.js:6` | VERIFIED | **FIXED** (0.29.1) |
| 7 | HIGH | Every render hangs if the server started as a bg job | `ffmpeg_utils.py:940` | VERIFIED | **FIXED** (0.31.0) |
| 8 | MEDIUM | No cancellation; abandoned renders burn CPU | `app.py:1901` | VERIFIED | NOT STARTED |
| 9 | MEDIUM | Failed renders leave corrupt partials in the Export Bin | `app.py:651` | VERIFIED | NOT STARTED |
| 10 | MEDIUM | Frontend races and wedges | `MediaLibrary.jsx:91` | VERIFIED | NOT STARTED |
| 11 | MEDIUM | Malformed payloads produce HTML 500s, not 400s | `app.py:681` | VERIFIED | NOT STARTED |
| 12 | MEDIUM | Fresh-machine setup failures | `app.py:110` | VERIFIED | NOT STARTED |
| 13 | LOW | `.preview_cache` never evicted (414 MB, 211 MB dead) | `ffmpeg_utils.py:924` | VERIFIED | NOT STARTED |
| 14 | LOW | Remaining sharp edges (5 small items) | various | mixed | NOT STARTED |
| 15 | HIGH | Documented launch command stops the server at boot | `_reloader.py:429` | VERIFIED | NOT STARTED |
| 16 | HIGH | The Agent tab can overwrite source media in `input/` | `ffmpeg_utils.py:2410` | VERIFIED | NOT STARTED |

Items 15 and 16 were found while fixing #7 and are new since the original audit.

**Recommended order:** #6 first (one change makes ~8 other failures visible and therefore
diagnosable), then #1 (correctness), then #3 + #9 together (same temp+rename pattern), then #4
(mechanical, but change all call sites in one pass or the split just moves).

Each fix gets a version bump in the same commit as the change, per CLAUDE.md. This tracker file
itself is not a shipped behaviour change and does not need one.

---

## 1. HIGH — Audio/video drift makes renders silently disagree with the timeline

**Status:** FIXED — 2026-08-26, shipped in 0.30.0 (see Resolution below)
**Confidence:** VERIFIED (reproduced twice independently, by the finder and the refuter, each with
their own generated media; the code shape was then confirmed a third time by hand)
**Where:** `ffmpeg_utils.py:2199` (audio) vs `ffmpeg_utils.py:2187` (video); bed sizing at `:2235`

### What's wrong
Each clip's video is capped to a whole number of frames while its audio is padded to unquantized
seconds, so the audio overhangs the video on any clip where `expected_sec × target_fps` is not an
integer.

```
ffmpeg_utils.py:2187  trim=start_frame=0:end_frame={n_norm_frames}      # 31/30 = 1.0333333 s
ffmpeg_utils.py:2199  apad=whole_dur={expected_sec},atrim=end={expected_sec}   # 1.0416667 s
```

`concat` advances its per-segment offset by the **longest** stream, so the video gets a gap: every
subsequent cut lands progressively later than the timeline, a one-frame hitch is injected at each
boundary, and the output becomes variable-frame-rate.

### Triggers — both routine
- **Any mixed-fps timeline.** `app.py:1235` sets `target_fps = max(source fps)`, so a 24 fps clip
  on a timeline containing 30 fps footage lands off-grid.
- **The 0.75× or 0.4× speed presets** (`frontend/src/components/SpeedForm.jsx:10`), even on a
  single-fps timeline.
- A single-source-fps timeline at 1× is **unaffected** — which is why this has survived.

### Repro
20 clips alternating 24 fps (`in=0`, `out=25/24`) and 30 fps (`in=0`, `out=1.0`), `target_fps=30`.
Render the same payload twice, once normally and once with `noAudio: true`, and read the cut points:

```
with audio:    ... 13.300 14.300 15.333 16.333 17.367 18.367 19.400   duration=20.400  avg_frame_rate=1525/51
noAudio=true:  ... 13.233 14.233 15.267 16.267 17.300 18.300 19.333   duration=20.333  avg_frame_rate=30/1
prediction:    ... 13.233 14.233 15.267 16.267 17.300 18.300 19.333
```

Both files carry exactly 610 video frames — the same frames spread over a longer span. The
`noAudio` column matches the prediction exactly, which is what proves the audio overhang is the
cause rather than the frame math. The single-fps 0.75× variant drifted harder: 6 frames over 20
clips (last cut `26.375` vs `26.125` predicted).

### Why this is the one to fix first for correctness
`analyzeMath.sequencePieces` and `pieceOffsetsOnV2` (`frontend/src/analyzeMath.js:526`, `:568`)
predict the **noAudio** offsets. So V2 Batch Analyze and V2 Reconstruct cut the returned file on
boundaries that are off by a growing number of frames — silently corrupted downstream work, not
merely a wrong duration. This is the same class of error the 0.26.1 CHANGELOG entry fixed on the
prediction side; the render side still disagrees.

### Documentation conflict — fix this in the same commit
`gotchas.md:16` asserts the per-clip audio is "padded/cut to the identical duration" as the capped
video. The code does not do that. Anyone reading the doc will believe this is already handled.

### Fix
Quantize the audio target to the same grid as the video:
- `a_target = n_norm_frames / target_fps`, then `apad=whole_dur={a_target},atrim=end={a_target}`
  at `ffmpeg_utils.py:2199` and at the clip-audio branch `:1534`.
- Size the A1 bed from the sum of the **quantized** per-clip lengths rather than
  `sum(expected_secs)` at `:2235`, and `total_sec` at `:1572`/`:1636`, so the bed's length and
  offsets stay on the frame grid.
- Correct the `gotchas.md:16` claim.

**Effort:** ~5 lines plus a **verify-render** pass. Re-check both the mixed-fps and 0.75× cases
above after the change.

### Resolution — fixed 2026-08-26, shipped in 0.30.0

#### Changes made

**`ffmpeg_utils.py`**
- Added `quantized_timing(spec, target_fps)` immediately after `clip_timing`. It returns
  `(lead_frames, trail_frames, expected_sec, n_norm_frames)` where `expected_sec` is
  `n_norm_frames / target_fps` — the length the clip actually occupies — rather than
  `clip_timing`'s source-fps seconds. The frame count comes back alongside it because
  `build_timeline_filter` needs the integer for its `trim` cap and the seconds for its `apad`, and
  they must be the same number expressed two ways.
- `build_timeline_filter`: the two lines that computed `n_norm_frames` inline now call
  `quantized_timing`. That one substitution fixes the per-clip audio pad (`:2199`), the bed's
  `total_sec` (`:2235`), and room tone's placement — all three read `expected_sec`/`timings`, so
  none of them needed touching directly.
- `build_a1_filter`: takes `target_fps` as a new second positional parameter and builds its
  `timings` through `quantized_timing`.
- `noise_fill_summary`: same, so the `sequence_sec` both render routes report back is the length
  that renders.
- Updated one stale in-code reference (`# see clip_timing` → `quantized_timing`) at the frame-budget
  comment, and the `build_a1_filter` docstring paragraph that named `clip_timing` as its length
  source.

**`app.py`**
- `render_a1`: derives `target_fps = max(i["fps"] or 30 for i in infos)` from the already-probed V1
  clips — the identical expression `render_timeline` uses — and passes it to `build_a1_filter`.
- Three call sites updated to pass `target_fps`: `build_a1_filter` and both `noise_fill_summary`
  calls.

**`.claude/docs/gotchas.md`**
- Added a sub-bullet under the frame-cap entry (the entry this audit flagged as conflicting) that
  names *which* duration "identical" means and records the measurements below.

#### Reasoning

The audit's fix list said to write `a_target = n_norm_frames / target_fps` at each pad site. I did it
one level up instead — quantizing the value inside `timings` rather than at each use — because
`timings` is already the codebase's designed channel for this. `clip_audio_pieces:1380` computes
`slack = expected_sec - sum(pieces)`, which is explicitly documented as "the apad silence"; feeding it
the quantized length makes room tone's plan describe the new reality automatically instead of needing
its own correction. Patching each pad site individually would have left `clip_audio_pieces`,
`noise_fill_plan`, and `bed_spans` all still reasoning about a length the render no longer produced.

Two of the audit's line references were slightly off, and following them literally would have been
wrong: `:1534` is described as "the clip-audio branch" but is actually inside `noise_track` (the
room-tone layer), and `:1572` is inside `bed_spans`. Both are fixed anyway — they receive `timings`
as a parameter — so neither needed an edit.

The audit's "~5 lines" estimate missed a signature change it could not have seen from the pad sites
alone. `build_a1_filter` had no `target_fps` parameter at all, yet its own docstring promises its
output is "sample-for-sample the A1 contribution to the equivalent V1 render, and exactly as long"
and warns that "two independent copies of this arithmetic would let a V1 render and its A1 stem drift
apart". Quantizing only V1 would have made that docstring false and broken the stem. Threading
`target_fps` in was not scope creep — it was the same defect on the other route.

`bed_offset_sec` (`build_timeline_filter:2099`, and its counterparts `head_sec` in `build_a1_filter`
and `head` in `bed_spans`) is deliberately **left alone**. It is still `lead_frames / fps` on the
source grid. It is a one-time constant offset of at most half a frame that does not accumulate, all
three sites agree with each other today so V1/A1 equivalence is preserved by leaving them, and
changing it would move bed placement in existing head-hold projects — a separate change needing its
own audio verification. Noted here rather than silently done or silently skipped.

#### Observations

- **The bug had a second direction the audit did not describe.** Across 144 fps/trim/speed/target
  combinations the audio was too LONG in 50 (the accumulating drift, worst 125 ms over 6 clips) and
  too SHORT in 45 — up to 20.8 ms of silence at each clip's tail, a hole rather than a drift, because
  `concat` advances by the video in that case. Only 49 were already aligned. Both directions are
  fixed by the same change.
- **The false claim was in the code too, not just the doc.** The comment at
  `build_timeline_filter:2092` already said "and the audio is padded/cut to the same length". It was
  describing intent that was never implemented. It needed no edit — the code now does what it says —
  which is a good argument for the audit's habit of treating a doc/code disagreement as a bug report
  about the code rather than the doc.
- **`gotchas.md:16` did not need "correcting" so much as disambiguating.** "The identical duration"
  was true of the author's intent and ambiguous about which grid, and that ambiguity is precisely
  where the bug lived. The new sub-bullet names the grid.
- **The user's own footage never hit the drift path.** Every file in `input/` is 24 fps with no audio
  stream (audio lives in sibling `.wav` files on A1), so `target_fps` is 24 and 1× timelines were
  always aligned. Their exposure was the 0.75×/0.4× presets and the A1 bed's length — which is the
  part that was up to 100 ms off.
- The A1 stem is still 6 samples (0.14 ms) longer than its render: each 1.375 s segment is 60637.5
  samples at 44100, and 12 of those round up. Pre-existing sub-sample `apad` rounding, unrelated to
  this issue, and a different fix (sample-exact segment sizing) — not touched.
- `_clip_total_sec` (`app.py:1633`) is a third copy of the length arithmetic, but its docstring
  correctly states it is a deliberate approximation for sizing a bitrate budget. Left alone.

#### Verification

All numbers below are from running the code, not reading it.

**Filter-graph diff, old vs new, 195 graphs** (39 timeline shapes × 5 audio configurations, old
module loaded from `git show HEAD:ffmpeg_utils.py`):
- 120 graphs changed, 75 identical.
- **No `no_audio` graph changed by a single character** — all 39 are byte-identical, which is the
  statement that the picture is untouched.
- Every changed graph differs only in `apad`/`atrim` targets.

**The invariant, asserted over 144 configurations** (fps ∈ {24, 30, 29.97, 60} × trim ∈ {30, 25, 47}
frames × speed ∈ {1, 0.75, 0.4, 2} × target_fps ∈ {24, 30, 60}): per-clip audio length ==
that clip's own video frame count ÷ target_fps, to within 1e-9, in all 144. Video frame counts
changed in 0 of 144.

**Real renders through the live API** (quality pinned to `lossless`, restored afterward):

| case | | before | after | predicted |
|---|---|---|---|---|
| 20 clips, 24/30 fps mixed | frames | 610 | 610 | 610 |
| | `avg_frame_rate` | `1525/51` (VFR) | `30/1` | `30/1` |
| | video duration | 20.400 | 20.333333 | 610/30 = 20.333333 |
| | audio duration | 20.416 | 20.333 | — |
| 12 clips, 0.75×, real 24 fps footage | frames | — | 396 | 396 |
| | duration | 16.666667 | 16.500000 | 396/24 = 16.5 |

The "before" column is the old filter graph run through ffmpeg on the same two source files, so it is
a genuine A/B rather than a recollection. It reproduces the audit's recorded `duration=20.400` and
`avg_frame_rate=1525/51` exactly.

**Cut boundaries against the frontend's prediction** — the reason this was ranked first. Extracted
every frame's `pts_time` from both renders and compared each clip's first frame to the cumulative
frame sum `analyzeMath` uses:
- **after: worst error 0.000 ms** across all 20 clips.
- before: 66.667 ms = exactly 2 frames late by the last clip.
- Frame intervals after the fix are only 1/30 s. Before, they included doubled intervals (0.0667 s) —
  the injected hitch, and the mechanism behind the VFR rate.

**A1 stem vs its V1 render**, 16 configurations: worst `|stem − render|` **100.0 ms before, 0.000 ms
after**; the bed's padded length equals the render's length in every case. Live route check on the
0.75× timeline: stem 16.500136 s against the render's 16.500000 s (the 6-sample artifact above), and
the route's reported `sequence_sec` moved from 16.667 to 16.5.

**Frame-hash equality** (the project's standard bar, per the **verify-render** skill): single clip,
`inSec=0.5 outSec=2.5`, 1 s head hold, 0.5 s tail hold, reversed, speed 1 → 84 frames as predicted
(24 head + 48 body + 12 tail), and **every frame's md5 equals its source frame's md5**. Holds,
reversal and losslessness are unaffected.

**Bed + room tone together** on the mixed-fps timeline: 610 frames, `30/1`, 20.333333 s, audio
matching, `sequence_sec` 20.333 (was 20.417). Room tone correctly reports `noise_fill_sec: 0` there,
since every clip has audio.

**The six saved projects in `projects/` are provably untouched.** For each, the emitted filter graph
was compared old vs new across four audio configurations (plain, `no_audio`, bed, bed + room tone):
**24 of 24 byte-identical.** They are all single-source 24 fps at 1×, so they were already aligned —
which is both why this bug survived and why fixing it cannot disturb the user's existing work.

**Regression checks:** `npx vite build` clean; `npm run lint` shows only the 3 pre-existing warnings
in files not touched here; backend healthy on 0.30.0 (`/api/version`, `/api/files` both 200). All
test renders and the two generated test files removed from `output/` and `input/`;
`.export_settings.json` restored to its committed `under50mb_hevc`. No file in `input/` was modified.

---

## 2. HIGH — Two same-name renders destroy each other *(unjudged: no adversary reviewed this)*

**Status:** NOT STARTED — **re-run the refutation pass before acting**
**Confidence:** VERIFIED by the finder (5/5 reproductions); code shape confirmed by reading. Its
refuter crashed on a credentials error, so this is the one entry no adversary attacked.
**Where:** `app.py:1271` (uniqueness loop), `ffmpeg_utils.py:698` (shared passlog)

### What's wrong
The output-name uniqueness loop is check-then-act with no lock, and the output file does not exist
until ffmpeg starts — for two-pass modes, not until pass 2. There is **no lock, queue, job
registry, or concurrency cap anywhere in the codebase** (a grep for
`threading`/`Lock`/`Semaphore`/`queue` finds only the word "threaded" in a comment). Werkzeug's dev
server is threaded by default, so requests genuinely run concurrently.

- **Single-pass:** two concurrent renders resolve to the identical path; one render's content is
  silently gone. Reproduced 5/5 — two different payloads both returned `{"output":"collide.mp4"}`
  and one 497,924-byte file survived.
- **Two-pass** (`under50mb`, `under50mb_hevc`, `custom`): they additionally share the two-pass
  stats file, so **both fail** — `"ratecontrol_init: can't open stats file"` and
  `"statistics are damaged at line 180"` — and leave a **0-byte file that `/api/outputs` lists as
  a real export** and that ffmpeg then refuses to open (`moov atom not found`).

### Repro
Two tabs are not required. A client disconnect does not cancel a render (see **#8** — verified:
`curl --max-time 1`, ffmpeg kept running and finished the file), so **reloading the page mid-render
and clicking Render again is exactly this case.** For two-pass modes the collision window is the
whole of pass 1 — minutes on real footage — because pass 1 writes to `/dev/null`
(`ffmpeg_utils.py:733-736`) and `out_path` does not exist yet.

The frontend guard is per-tab only: `Timeline.jsx:778`/`:878` disable the buttons from
`App.jsx:209` `rendering`, which is lost on reload and absent in a second tab.

### Fix
- Reserve the name atomically instead of testing it: `os.open(candidate, O_CREAT|O_EXCL)` in the
  loop (or hold a module-level `threading.Lock` across choose-name + create-placeholder) so the
  winner owns the path and the loser gets `_1`.
- Derive the two-pass stats prefix from a per-render `tempfile.mkdtemp()` rather than `out_path`,
  so two renders can never share a passlog.
- Consider a module-level `Semaphore(1)` around the ffmpeg call to cap CPU thrash: one lossless
  render alone measured 941% CPU, and two concurrent previews of the same file took 2.5s vs 1.2s.

**Effort:** 1–2h.

---

## 3. HIGH — A failed preview poisons the cache permanently

**Status:** NOT STARTED
**Confidence:** VERIFIED (found independently by 5 lanes; the code was read and confirmed by hand)
**Where:** `ffmpeg_utils.py:928-935`

### What's wrong
`get_or_make_preview` writes the transcode **directly to its final cache path** — no temp+rename —
and guards only on `os.path.exists(cached)`:

```python
cached = os.path.join(PREVIEW_CACHE_DIR, key)
if not os.path.exists(cached):
    args = [..., cached]
    result = run_ffmpeg(args)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])   # partial file is NOT deleted
return cached, info
```

Two distinct failures fall out:
1. A second request arriving mid-transcode sees the path exists and is served the **half-written
   file with HTTP 200**. Measured: req1 → 250,820 bytes, valid, 1.256s; the same URL 0.6s later →
   **48 bytes, HTTP 200**, and `ffmpeg -i` on it reports `moov atom not found`.
2. On ffmpeg failure the partial file is **never removed**, so `os.path.exists` stays true forever
   and the broken preview is served on every subsequent request. The only remedy available to a
   user today is manually deleting the file from `.preview_cache/`.

Two *simultaneous* requests also run two ffmpeg processes into the same destination at once
(verified: 2 matching processes; 2.5s instead of 1.2s).

### Repro
One click can produce two concurrent requests for the same uncached file: `MediaLibrary.jsx:93`
and `ReformatPanel.jsx:38-41` both build `/preview/<dir>/<name>` from the same bin selection, and
both `<video>` elements are mounted when the center tab is `reformat` (`App.jsx:1915-1918`).
Clicking the same non-browser-playable file twice does it too.

### Fix
Transcode to `cached + ".part"` and `os.replace()` into place only when ffmpeg exits 0, so the
final path only ever exists complete; unlink the `.part` on failure. Optionally a per-key lock (or
`O_EXCL` on the `.part` file, with the loser waiting) so two requests don't duplicate the work.

**Effort:** ~30 min.

---

## 4. HIGH — Export-Bin split-brain: the app lists one directory and reads another

**Status:** NOT STARTED
**Confidence:** VERIFIED by running (own test, output quoted below)
**Where:** `app.py:91` and `app.py:130` (readers); `app.py:633,701,1640,1703` (writers);
`ffmpeg_utils.py:948` (`unique_output_name`)

### What's wrong
`resolve_media_dir()` (`app.py:389`) is the correct helper that honours a user-chosen export
directory, but several routes bypass it and use `fu.OUTPUT_DIR` (the default) directly.

**Read side** — `/api/probe` (`app.py:130`) and `/preview/<which>/` (`app.py:91`). With a custom
export dir set:

```
get_output_dir()       -> /tmp/exportdir-test/custom
fu.OUTPUT_DIR          -> /Users/.../ffmpeg/output

GET /api/outputs          -> 200 ['rendered.mp4']
GET /api/probe dir=output -> 404 {'error': 'file not found'}
GET /preview/output/..    -> 404 {"error":"file not found"}
```

So the Export Bin shows the file, but Media Info Out is empty and an HEVC preview 404s.

**Write side** — `/api/trim`, `/api/splice`, `/api/hold_frame`, `/api/reverse` write to
`fu.OUTPUT_DIR` while `/api/render_timeline` (`app.py:1265`) and `/api/reformat` write to
`get_output_dir()`. With a custom export dir those four operations report success and their output
**never appears anywhere in the UI**.

**Naming** — `fu.unique_output_name` (`ffmpeg_utils.py:948`) always checks `OUTPUT_DIR`, so it
cannot see collisions in the custom dir. (`render_timeline` sidesteps this by inlining its own
loop against `export_dir` at `app.py:1268-1274`, which is why renders are safe today.)

### Repro
1. Set a custom export directory via the Browse button in Export Settings.
2. Render something — it appears in the Export Bin, but selecting it leaves Media Info Out empty,
   and a non-H.264 export shows no preview.
3. Trim any Media Bin file. The call returns 200 with a filename, and the file never shows up.
   It is in the repo's `output/`.

### Fix
Route every one of these through `resolve_media_dir()`, and give `unique_output_name` a `base`
parameter (then delete the inlined duplicate loop in `render_timeline` in favour of it). Do all
call sites in one pass — fixing a subset just moves the split.

**Effort:** ~15 lines, mechanical.

---

## 5. HIGH — Saving a project can destroy another project with no prompt

**Status:** **FIXED** in 0.29.0 — all four fix bullets done, verified by running (47 backend
assertions + a live end-to-end pass). See *Resolution* at the end of this entry.
**Confidence:** VERIFIED by running
**Where:** `app.py:211-221` (save), `app.py:232` (load)

### What's wrong
`save_project` pushes the typed name through `secure_filename` and then writes with a bare
`open(..., "w")` — **no existence check, no confirmation, no backup, and not atomic.** `.nara`
files are the only record of a timeline.

Because `projects/` currently holds `Batch_1_V002.nara` … `Batch_6_V002.nara`, this is reachable
from ordinary typing: with `Batch_1_V002` open, pressing Save As and typing `Batch 1 V002` (spaces
instead of underscores — the same project name, typed naturally) sanitizes onto
`Batch_1_V002.nara` and replaces it. The app reports `Saved <time>` and there is no undo.

Non-Latin names collapse harder (werkzeug 3.1.8):

```
secure_filename('видео')            -> ''
secure_filename('日本語プロジェクト')  -> ''
secure_filename('映像 v1')           -> 'v1'
secure_filename('音声 v1')           -> 'v1'

POST /api/projects {"name":"видео.nara"} -> 200 {"name":"nara.nara"}
POST /api/projects {"name":"🎬.nara"}    -> 200 {"name":"nara.nara"}   # both saves landed on ONE file
```

### The corrupt-file half of the same bug
Truncate-then-write means a crash or full disk mid-save leaves a damaged `.nara` **with the good
copy already destroyed.** `load_project` (`app.py:232`) then calls `json.load` with no
`try/except`, returning an HTML 500; `ProjectLibrary.jsx:20-22` does
`const project = await loadProject(name)` with no `try/catch`, so `r.json()` rejects before the
`project.error` check runs. Clicking that project in the library produces **no banner, no dialog
change, nothing at all** — a project that looks fine in the list and silently does nothing is much
harder to diagnose than one that says the file is corrupt.

```
GET /api/projects/corrupt.nara -> 500 text/html
GET /api/projects/empty.nara   -> 500 text/html
GET /api/projects/missing.nara -> 404 {"error":"project not found"}   # the only one handled
```

### Fix
- Don't use `secure_filename` for the display name. Keep the user's name inside the project JSON
  and derive a slug that preserves unicode (reject only path separators, NUL and leading dots), or
  refuse names that sanitize to empty with a clear 400.
- Add an explicit overwrite check: return 409 unless an `overwrite` flag is set, and have the
  frontend ask "Replace `<name>`?". Note the app already warns before the far less destructive
  Delete, so the current asymmetry is the actual footgun.
- Write via temp file + `os.replace` so a crash cannot truncate the only copy.
- Wrap `json.load` in `try/except json.JSONDecodeError` → 400 with a real message, and give
  `ProjectLibrary.handleOpen` a `try/catch` that surfaces it.

**Effort:** ~35 lines across backend + one confirm in `App.jsx`.

### Resolution — fixed 2026-08-26, shipped in 0.29.0

#### Changes made

**`app.py`**

1. **New `_project_filename(raw)` helper** (above `save_project`) replaces `secure_filename` in the
   save path. It *validates* rather than rewrites: appends `.nara` if absent, then refuses only
   what genuinely cannot be a filename here — an empty stem, a path separator (`/`, `\`, `os.sep`)
   or NUL, and a leading dot. Unicode and spaces pass through untouched. Raises `fu.PathError`,
   which `save_project` turns into a 400.
2. **Overwrite gate in `save_project`:** returns `409 {"error": ..., "exists": name}` when the file
   exists and the request did not set `overwrite`. Nothing is written on that path.
3. **The `or "project.nara"` fallback is gone**, so a save with no name is a 400 rather than a
   silent write to `project.nara` — which could itself have replaced a real project named
   `project`. Unreachable from the UI (both handlers return early on an empty prompt), so this
   removes a latent path, not a used one.
4. **Atomic write:** the old bare `open(path, "w")` became write-to-`path + ".tmp"` then
   `os.replace(tmp, path)`, with the temp file unlinked and a JSON 500 returned on `OSError`.
5. **`load_project` corrupt-file handling:** `json.load` is wrapped in
   `except json.JSONDecodeError` → 400 `"project file is corrupt: ..."` and `except OSError` → 500.

**`frontend/src/api.js`** — `saveProject(name, project, overwrite = false)` now sends `overwrite`
in the body. Default `false`, so no call site can silently replace a project by omission.

**`frontend/src/App.jsx`** — `handleSave` and `handleSaveAs` each check for `result.exists` before
`result.error`, `confirm(...)`, and retry with `overwrite: true` if accepted. `handleSave` passes
`overwrite: true` up front when a `projectName` is already open.

**`frontend/src/components/ProjectLibrary.jsx`** — `handleOpen` gained a `try/catch` that puts the
failure in the existing error banner.

**`CHANGELOG.md` / `VERSION` / `frontend/package.json`** — bumped to 0.29.0 via `bump_version.py`.

#### Reasoning

- **Validate, don't sanitize.** The audit's first bullet offered two options: keep the display name
  inside the JSON and derive a slug, or refuse names that sanitize to empty. I took neither
  verbatim — I removed the sanitizing step instead. A slug still means two different names can map
  to one file, which is the actual defect; and `projects/` is a folder the user browses in Finder,
  so the name on disk being the name they typed matters. `safe_path` (used by load and delete)
  already blocks traversal without `secure_filename`, so all three routes now agree on the name —
  verified by round-tripping unicode through POST → GET → DELETE.
- **`os.replace`, not a `.bak` copy.** Atomic within a directory and leaves no second file for the
  user to wonder about.
- **`path + ".tmp"`, not `.tmp` + `path`.** The suffix order was deliberate: `list_projects` filters
  on `.endswith(".nara")`, so a leftover temp can never appear in the library. Confirmed by test.
- **Plain Save of an open project does not prompt.** Overwriting *that* file is the entire meaning
  of Save; a confirm on every Cmd+S would be noise, and users click through repeated prompts, which
  would weaken the one prompt that matters. Only a just-typed name can hit a *different* project.
- **`buildProject()` is called once and the payload reused for the retry** — `confirm` is blocking,
  and re-reading state afterwards could save a timeline different from the one the user agreed to.
- **`result.exists` is checked before `result.error`** because the 409 body carries both.
- **Minor, not major, version bump.** CLAUDE.md says major for "anything that changes existing
  behavior," and this does change two: Save As now prompts, and names keep their spaces. I read it
  as minor because the behaviour that changed *was the defect*, and because the precedent in this
  repo is ab0663f — a behaviour-changing fix ("Reconstruct un-stretches V1 slow-downs *instead of*
  reporting them") that took 0.27.0, plus CHANGELOG.md's own "`0.x` means no stability promises
  yet." Flagging it because it is a judgment call, not a rule read; say so if you want 1.0.0.

#### Observations

- **Out of scope, left alone (belongs to #6):** `api.js`'s `postJSON` still has no `r.ok` check and
  no `.catch`, and `ProjectLibrary.refresh()` has no `.catch` — the latter is what leaves the
  library stuck on "Loading…" when the backend is down. Not touched. Note this fix does not *depend*
  on #6: 400/409/500 bodies here are all `jsonify`'d, so `result.error` and `result.exists` parse
  correctly through the existing `postJSON`.
- **Out of scope, still present:** `secure_filename` remains imported at `app.py:8` and is still
  used by the upload route (`app.py:151`) and `rename_file` (`app.py:462`). **`rename_file` has the
  same class of bug** — it can rename one media file onto another's name with no existence check —
  and is not covered by any current entry. Worth adding as its own item.
- **Also unchecked:** `delete_project` (`app.py:302`) calls `os.remove` with no `try/except`; a
  permissions error there would still produce an HTML 500. Left alone as #11's territory.
- **`list_projects` would list a *directory* named `foo.nara`** as a project. `projects/OLD` (a real
  folder in the working tree) is safely skipped because it lacks the extension. Pre-existing, not
  reachable through the save path now that separators are refused, so not fixed.
- **Corrected a false alarm of my own:** a `Python` process listening on 5001 since Aug 21 looked
  like a stale duplicate server. It is the werkzeug reloader *parent*, sharing the child's socket
  inode — normal. No finding.
- **The reloader did pick up the `app.py` edit** (child PID restarted at the file's mtime to the
  second), which is why the live pass below exercised the new code.
- **One thing this audit entry got slightly wrong:** it described `save_project` as having "no
  existence check, no confirmation, no backup, and not atomic," all of which was true — but the
  route *already* validated the payload shape (`isinstance(project, dict)` and `clips` a list).
  That check was pre-existing and is unchanged; it is not part of this fix.

#### Verification

Backend, via the Flask test client against a scratch `PROJECTS_DIR` (the real `projects/` was never
the target): **47 assertions, 0 failures.**

```
1. the original bug          Batch_1_V002 + "Batch 1 V002" now coexist; the ORIGINAL is byte-intact
2. overwrite gate            2nd save -> 409 + {exists}; file untouched; overwrite=true -> 200
3. unicode + spaces          видео / 日本語 / "My Great Edit" / "café v2" all keep their names,
                             POST -> GET -> DELETE round-trip identical; no hidden ".nara" dotfile
4. refused names             '' / '   ' / '.nara' / None / '../escape' / 'a/b' / '.hidden' / NUL -> 400
5. malformed payloads        no project / string / no clips / clips=3 -> 400, nothing written
6. atomic write              json.dump patched to write a partial then raise OSError(ENOSPC):
                             -> 500 JSON, OLD project still complete, temp removed, never listed
7. corrupt .nara             -> 400 application/json "project file is corrupt: ..." (was HTML 500)
                             missing -> 404 JSON
```

Live, against the running server on 127.0.0.1:5001 with a throwaway name, then cleaned up:

```
POST "zz-issue5-live probe ünïcode"        -> 200 {"name":"zz-issue5-live probe ünïcode.nara"}
POST same name again, no overwrite         -> 409 {"exists":"zz-issue5-live probe ünïcode.nara"}
file on disk                               -> still {"clips":[{"file":"FIRST"}]}
POST {"name":"a/b"}                        -> 400 "project name cannot contain a path separator"
DELETE the probe                           -> 200; projects/ back to the 6 real .nara files + OLD/
```

All 6 real `Batch_*.nara` projects re-parsed as valid JSON with their original clip counts
(6/4/6/4/4/2) after the work. `npx vite build` ✓ built, `oxlint` 7 pre-existing warnings and **0 in
the three files touched**. Bundle rebuilt and confirmed to carry `0.29.0`.

**Not verified by me:** the two `confirm()` dialogs and the library error banner were not clicked in
a browser — they are three lines of standard React against a server response proven above, but the
UI itself is untested by hand.

---

## 6. HIGH — Silent failure: timeouts and non-JSON errors leave the user with nothing

**Status:** **FIXED** in 0.29.1 — backend JSON envelope, `api.js` typed errors, a global rejection
handler, and catches at the named surfaces. Verified by running (29 backend + 14 frontend
assertions, plus a live pass). See *Resolution* at the end of this entry.
**Confidence:** VERIFIED by running (backend half), TRACED (frontend half)
**Where:** `frontend/src/api.js:1-7`; `app.py` render routes (no `TimeoutExpired` handler anywhere)

### What's wrong
Two halves that compound into total silence.

**Backend.** No route catches `subprocess.TimeoutExpired`, and there is no `@app.errorhandler`
anywhere in `app.py`. It is a `SubprocessError`, not a `RuntimeError`, so even the multipass
wrapper's `except RuntimeError` at `app.py:645` misses it. A timed-out render returns Flask's
**HTML 500 page** instead of the `{error, detail}` JSON shape the frontend expects:

```
subprocess.TimeoutExpired: Command '[...ffmpeg -y -i .../big.mp4 ...]' timed out after 5 seconds
STATUS 500   content_type 'text/html; charset=utf-8'
BODY: b'<!doctype html>\n<html lang=en>\n<title>500 Internal Server Error</title>...'
```

**Frontend.** `api.js:6` is `fetch(...).then(r => r.json())` with **no `r.ok` check and no
`.catch`**, on every single call. An HTML body makes `r.json()` reject. `handleRenderConfirm`
(`App.jsx:823-886`) is `try/finally` with **no `catch`**, and a grep for
`unhandledrejection`/`ErrorBoundary`/`componentDidCatch`/`window.onerror` across `frontend/src`
returns nothing.

Net effect: `setRendering(false)` runs, the spinner clears, and **no alert fires, no log line
appears, nothing is shown.** The same shape strands several other surfaces:

| Surface | Where | Symptom |
|---|---|---|
| Render | `App.jsx:875` | spinner clears, no error, output missing |
| Media Bin | `App.jsx:482` | backend down reads as a merely-empty bin |
| Agentic Assistant | `ChatPanel.jsx:24` | "Thinking…" forever, Send disabled, needs a reload |
| Project Library | `ProjectLibrary.jsx:11` | stuck at "Loading…", error state never set |

Real triggers: any render exceeding 600s (or 1800s per pass for two-pass), which **#7** makes a
certainty on the documented launch path; a reloader restart mid-render (**#8**); a corrupt `.nara`
(**#5**); a 413 from the 2 GB `MAX_CONTENT_LENGTH` (`app.py:13`); or the backend simply being down.

### Fix
One `r.ok` + content-type check in `postJSON` that throws a typed error, plus `.catch` at the call
sites. This single change is the highest ratio of recovered trust per line in this list: it turns a
whole family of invisible hangs into visible errors, which makes every other entry here
diagnosable. Add a Flask `@app.errorhandler` that returns JSON so the shape is never HTML. Note
`RenderDialog.jsx:29` calls `onConfirm(...)` without awaiting, so the rejection needs handling
inside the handler rather than at the dialog.

**Effort:** ~30 lines.

### Resolution — fixed 2026-08-26, shipped in 0.29.1

#### Changes made

**`app.py`** — three `@app.errorhandler`s in a new `# ---------- errors ----------` section
(placed between the config block and the first route), plus `from werkzeug.exceptions import
HTTPException` at the top:

1. `subprocess.TimeoutExpired` → **504** with a detail naming the tool and the limit
   (`"ffmpeg was still running after 600s and was stopped"`). 504 rather than 500 because the work
   may have been valid and merely too long, which is what tells the user whether to retry or fix.
2. `HTTPException` → the same status Flask chose, with its own wording, only re-enveloped as JSON.
   This is what converts the HTML 404 / 405 / 413 pages.
3. `Exception` → **500** `{"error": "internal server error", "detail": "<Type>: <msg>"}`.

**`frontend/src/api.js`** — a new exported `ApiError` class (`message`, `status`) and an internal
`apiFetch(path, init)` that every export now goes through, replacing `postJSON`'s
`fetch(...).then(r => r.json())` and the twelve bare-`fetch` GET/DELETE helpers.

**`frontend/src/main.jsx`** — a `window.addEventListener('unhandledrejection', ...)` registered
before the first render, which alerts for `ApiError` only, de-duplicating identical messages within
3s.

**Targeted catches at the four surfaces this entry names:**

- `App.jsx` `handleRenderConfirm` — the `try/finally` gained a `catch` that alerts
  `'Render failed: ' + e.message`, matching the `result.error` alert already on the line above.
- `App.jsx` `refresh` — comment only, no code change (see Reasoning).
- `ChatPanel.jsx` `handleSend` and `handleRun` — each wraps its await, clears the stuck state
  (`setLoading(false)`, `running: false`) and reports through the field that surface already uses
  (`role: 'error'`, `execError`).
- `ProjectLibrary.jsx` `refresh` — `.catch` that sets the error banner and clears `loading`.

#### Reasoning

- **A JSON body passes through untouched, success or failure.** The entry's fix line says "one
  `r.ok` check in `postJSON`", and a literal `r.ok` check would have been a bug: every call site
  reads `result.error` off a 4xx body, and issue #5's Save reads `result.exists` off a **409**.
  Throwing on `!r.ok` would have broken all of it. So the test is *"can this be parsed as JSON"*,
  not *"was the status a success"* — which is the actual defect, since only an unparseable body
  produced silence. Explicitly regression-tested (409 → object, not exception).
- **A global `unhandledrejection` handler instead of 31 `.catch` calls.** I counted the call sites
  that reach the API with no catch: **31**, across 12 files. Adding a catch to each would have been
  a far larger change than this entry describes, and would have meant editing files (Timeline,
  MediaLibrary, OutputPanel, ReformatPanel, ExportSettings…) that this issue is not about. The entry
  itself lists the absent `unhandledrejection` handler as part of the defect, so one listener is the
  in-scope mechanism and covers all 31 at once. The four named surfaces still get their own catch,
  because each also has a **stuck state** a global alert cannot clear — "Thinking…", "Loading…",
  `running: true`.
- **Only `ApiError` is alerted.** Alerting on every rejection would fire on React-internal and
  code-bug rejections, which the user can do nothing about; those still reach the console, since the
  handler does not `preventDefault()`. This is a deliberate limit, not an oversight.
- **`App.jsx` `refresh` got a comment and no code.** I first added `.catch(() => {})` to both calls
  and then reverted it: catching there marks the rejection **handled**, which suppresses the global
  alert and reinstates exactly the silence being fixed. Leaving both uncaught is what makes the
  Media Bin report "cannot reach the backend" instead of reading as an empty bin, and the global
  handler's de-dupe collapses the two identical failures into one dialog.
- **`alert` rather than a new log kind.** `LogPanel.jsx:16` styles only `warn` and `info`; adding an
  `error` kind would mean changing that renderer, which is outside this issue. `alert` is what
  `App.jsx` already uses for render and save failures.
- **Logging the traceback in the `Exception` handler is required, not decorative.** Registering a
  handler stops Flask logging tracebacks itself, so without `app.logger.exception` the fix would
  have *created* a new silence in the terminal while removing one in the browser. Verified both.
- **Patch, not minor.** No new capability; the entire content is "report the failure you already
  had". Nothing a user depended on changes.

#### Observations

- **This entry overstated one thing.** It says "No route catches `subprocess.TimeoutExpired`". Two
  do — `/api/chat` (`app.py:1872`, 504) and `/api/execute` (`app.py:1952`, 504). The claim holds for
  the **render** routes, which are the ones that matter here, and those two pre-existing handlers
  are untouched and still take precedence.
- **The 413 claim was not reproducible as written.** A too-large upload was rejected on *file type*
  first (`"unsupported file type"`, a JSON 400), so `MAX_CONTENT_LENGTH` never fired. I verified 413
  by temporarily lowering the limit to 64 bytes; it is a genuine HTML 413 without the fix and JSON
  with it, just harder to reach than the entry implies.
- **I broke the running backend mid-task and had to restart it.** I added the handler block
  referencing `HTTPException` *before* adding its import, and the dev-server reloader picked up that
  intermediate state, died on the `NameError`, and left nothing listening on 5001. Restarted via the
  **run-app** skill; Vite was untouched. Worth knowing generally: with `debug=True` the reloader
  will happily restart into a broken file, and a two-step edit is a two-step outage.
- **Out of scope, logged not fixed:** the 27 remaining handlers without their own `.catch` are now
  covered by the global handler for *reporting*, but several set a local busy flag that a global
  alert cannot clear. The most likely to strand a user are `App.jsx` `handleRenderA1` and
  `renderShots` (the 1+ series loop), `MediaLibrary.handleDelete`, and `ReformatPanel.handleConfirm`.
  None are in this entry's table; they are candidates for a follow-up item.
- **`getVersion`'s deliberate `.catch(() => ({}))` is preserved** and still resolves to `{}` both
  when the backend is down and on an HTML 500 — regression-tested, because it is the one call that
  must never break the mount.

#### Verification

Backend, via the Flask test client — **29 assertions, 0 failures**, and deliberately run twice, with
`debug=False` and with `debug=True`/`PROPAGATE_EXCEPTIONS=True`, because that is the mode `app.py`
actually launches in and propagation could plausibly have bypassed the handlers (it does not):

```
render hits ffmpeg timeout        -> 504 application/json, detail names ffmpeg and 600s
render hits an unforeseen error   -> 500 application/json, detail names MemoryError
typo'd URL / wrong method         -> 404 / 405 application/json, statuses preserved
upload over MAX_CONTENT_LENGTH    -> 413 application/json
GET /api/version, /api/files      -> 200, unchanged
route's own 400 still wins        -> "need at least 1 clip"
issue #5's 400 and 409 + {exists} -> both intact
```

Traceback still reaches the terminal (the thing registering a handler would otherwise have removed):

```
[2026-08-26 10:57:21,890] ERROR in app: unhandled exception on POST /api/render_timeline
  File ".../app.py", line 1437, in render_timeline
MemoryError: out of memory
```

Frontend, `api.js` unit-tested directly in node with a stubbed `fetch` — **14 assertions, 0
failures**:

```
200/400/504 JSON        -> parsed and returned, .error reaches the caller
409 JSON                -> returned as an OBJECT with .exists (issue #5 regression)
HTML 500                -> throws ApiError, .status 500, "server error 500 INTERNAL SERVER ERROR"
HTML 404                -> throws ApiError, .status 404
empty 200 body          -> throws ApiError "unreadable reply from the server (HTTP 200)"
fetch rejects           -> throws ApiError .status 0, "cannot reach the backend — is the server
                           on 127.0.0.1:5001 running?"
getVersion              -> resolves to {} in both failure modes
```

Live, against the restarted server: `/api/nope` → 404 JSON, `GET /api/render_timeline` → 405 JSON,
`POST` with no clips → 400 JSON `"need at least 1 clip"`, `/api/version` `/api/projects`
`/api/export_settings` → 200 JSON, and a save onto `Batch_1_V002` → 409 with the real project still
holding its 6 clips. `npx vite build` ✓, `oxlint` still 7 pre-existing warnings and **0 in the five
files touched**.

**Not verified by me:** the `unhandledrejection` listener, its 3-second de-dupe, and the four
surfaces' recovered states were not exercised in a browser — they need a real page and a killed
backend to observe. The logic is small and the errors reaching them are proven above, but the UI
itself is untested by hand.

---

## 7. HIGH — Every render hangs if the server was started as a background job

**Status:** FIXED — 2026-08-26, shipped in 0.31.0 (see Resolution below)
**Confidence:** VERIFIED by running, under a real pty, full-stack (own app instance on port 5099)
**Where:** `ffmpeg_utils.py:940` (`run_ffmpeg`); same class at `ffmpeg_utils.py:159` and `app.py:1885`
(`:1885` was stale — the `/api/execute` `subprocess.run` is at `app.py:2007`; `:1885` is inside a
prompt string in `ask_claude`. Corrected during the fix, see Resolution → Reasoning.)

### What's wrong
`run_ffmpeg` never redirects stdin and never passes `-nostdin`, so ffmpeg inherits Flask's
controlling tty. When Flask is started as a **background job from an interactive Terminal** —
which is exactly what `agentic_installation.MD:209` and the run-app skill instruct
(`nohup python3 app.py > /tmp/flask_dev.log 2>&1 &`) — ffmpeg's startup `tcsetattr` raises SIGTTOU
from a background process group. The encoder is **stopped at 0%**, the request hangs for the full
600s/1800s timeout, and nothing is produced.

```
[1]  + suspended (tty output)  nohup .../python app.py
  PID  PGID TPGID STAT COMMAND
98461 98095 98078 TN   /opt/homebrew/bin/ffmpeg -y -i .../big.mp4 ...    # T = stopped, PGID != TPGID
curl: HTTP 000 (timed out at 45s), no output file ever created
```

Same harness with the single change `stdin=subprocess.DEVNULL`: `done rc 0 in 5.9s`, encode
completes, no suspension. Cause and fix both confirmed.

### Why it may never have been seen
The currently running instance is in the tty's **foreground** process group (`STAT S+`, fd 0 =
`/dev/ttys008`) and is unaffected. Any launch where stdin is not a tty (an agent shell, launchd,
`< /dev/null`) is also unaffected. On the launch path the install doc actually documents, though,
every render hangs.

### Fix
Pass `stdin=subprocess.DEVNULL` in `run_ffmpeg` (`ffmpeg_utils.py:940`) and add `-nostdin` to the
argv. Do the same for the `subprocess.run` in `/api/execute` (`app.py:1885`), which is the same
class of call though not on a UI path. **`probe()` does not need it** — ffprobe does not call
`tcsetattr`; in the background-pgrp repro `get_video_info` completed normally and only ffmpeg went
to state `T`.

**Effort:** one line per call site.

### Resolution — fixed 2026-08-26, shipped in 0.31.0

#### Changes made

1. **`ffmpeg_utils.py` `run_ffmpeg`** — `cmd = [FFMPEG, "-nostdin", "-y"] + args` and
   `subprocess.run(..., stdin=subprocess.DEVNULL)`. Docstring rewritten to state the invariant and
   why both halves are there, because deleting either one is silently safe on an agent-launched
   server and breaks every render on a Terminal-launched one.
2. **`app.py` `/api/execute`** — `-nostdin` inserted at `argv[1]` (`argv[:1] + ["-nostdin"] + argv[1:]`,
   after validation, so the validator is not involved) and `stdin=subprocess.DEVNULL`.
3. **`app.py` `/api/execute`, new guard** — a `returncode == 0` run whose stderr contains
   `"already exists"` now returns 500 `"ffmpeg refused to overwrite an existing file, so nothing was
   written"` instead of 200 `{"ok": true}`. **This was not optional**: see Reasoning.
4. **Docs** — `.claude/docs/gotchas.md` (the `run_ffmpeg` contract bullet gains a sub-bullet with the
   measurements) and `.claude/docs/architecture.md:18` (the one-line contract). `key-files.md:10` only
   *names* `run_ffmpeg` in an inventory and states no contract, so it was left alone.

Not changed, deliberately: `probe()` / `ffmpeg_utils.py:159`, per the entry's own instruction and
confirmed two independent ways below.

#### Reasoning

**The guard is part of this fix, not scope creep.** The audit's fix as written would have introduced
a silent-failure bug. ffmpeg exits **0** when it refuses to overwrite an existing output, and
`validate_ffmpeg_command` never injects `-y`, so *any* `/api/execute` command naming an existing
target hits that refusal. Before this change the refusal blocked on the interactive prompt and
surfaced as the 600s timeout — ugly, but the user was told. Stop the hang without touching the
success test and the same request returns 200 `{"ok": true}` with nothing written, and
`ChatPanel.handleRun` → `App.handleEditResult` then repoints the selected clip at a stale file and
resets its in/out, holds, speed, crop and reverse. Trading a visible timeout for silent wrong data
is not a fix. Verified directly: `ffmpeg -i src -c copy exists.mp4 < /dev/null; echo $?` → `0`.

**The guard reads ffmpeg's message, not the filesystem.** My first attempt compared the output
file's `(mtime_ns, size)` before and after via a `_write_stamp` helper. An adversarial pass killed
it: the output arg is not always a literal path on disk. `image2` and `-f segment` write printf
patterns, so `output/frame%03d.png` never exists as itself, both stamps come back `None`, they
compare equal, and a **fully successful export returned 500** while the PNGs sat in `output/`. Those
are ordinary chat asks ("pull a thumbnail every second", "split this into 1s chunks"). The stat
approach was also filesystem-dependent (`mtime_ns` collides on FAT32, which `share-project` can put
this folder on) and blind whenever `argv[-1]` is not the output. Keying on stderr fixed all three at
once and deleted the helper — the shipped change is *smaller* than the one that failed review.

**`-nostdin` at `argv[1]` is one insertion point that is right for all 11 `run_ffmpeg` call sites,**
because `run_ffmpeg` builds `[FFMPEG, ...] + args` and every caller's `args` starts with input
options. The two-pass paths (`render_size_capped`, `render_custom_two_pass`) hand each pass to
`run_ffmpeg` separately, so both passes inherit it with no separate edit; `_inject_pixel_format`
indexes `args[0]` but only ever sees `filter_args`, never the full argv, so the inserted flag cannot
shift it.

**Both halves ship even though each is independently sufficient.** Measured separately: `-nostdin`
alone passes, `DEVNULL` alone passes. They are kept together because a user-typed `-stdin` in the
custom-export Advanced extra-args field lands *after* `run_ffmpeg`'s globals and re-enables the
interaction (`_EXTRA_ARG_CONFLICTS` blocks `-y` and `-n` but not `-stdin`), while `DEVNULL` cannot be
overridden that way. That also made adding `-stdin` to `_EXTRA_ARG_CONFLICTS` unnecessary — `DEVNULL`
already makes it inert — so it was left out on scope grounds.

**Two audit line numbers were wrong and one sweep was incomplete.** `app.py:1885` is inside a prompt
string literal in `ask_claude`; the real call is `app.py:2007`. `ffmpeg_utils.py:940` and `:159` were
correct. The audit listed three spawn sites; there are **six**. The three it missed — `app.py:531`
`osascript` (invisible to a `subprocess.run` grep because the module is imported as `_sp`),
`app.py:560` `open -R`, and `app.py:1913` the `claude` CLI — were each tested in a
background-process-group harness and **none needs the fix** (all stayed `STAT S`; the `claude` CLI
completed rc 0 in 7.0s returning valid JSON).

#### Observations

- **The blast radius is much larger than the entry describes, and this is the important correction.**
  SIGTTOU is delivered to the whole **process group**, and `subprocess.run` does not put the child in
  a new one — so Flask, the reloader child and both `resource_tracker` helpers are stopped alongside
  ffmpeg. Measured: **5 processes in `STAT T` simultaneously.** The entry says "the request hangs";
  in fact **the server is dead for every subsequent request**, which is why this reads as a crash.
- **The timeout cannot rescue it and the hang is unbounded.** A `timeout=10` call was still stopped
  at **245s** when the observer gave up, because the Python that would raise `TimeoutExpired` is
  itself stopped. `SIGCONT` does not help — the interrupted `tcsetattr` restarts and re-raises. The
  entry's "hangs for the full 600s/1800s timeout" understates it on both counts.
- **The signal was proven, not inferred.** Ignoring SIGTTOU in a `preexec_fn` → encode completes in
  0.3s. Ignoring SIGTTIN → still stopped at 8.1s. Statically, `nm -u /opt/homebrew/bin/ffmpeg` lists
  `_tcgetattr`/`_tcsetattr`; `nm -u .../ffprobe` lists **neither**, which is the mechanism behind the
  entry's correct claim that `probe()` needs nothing.
- **NEW FINDING — this fix does not make the documented launch command work.** Typing
  `agentic_installation.MD:209` / run-app `SKILL.md:24` verbatim into an interactive Terminal stops
  the whole group **at boot, before any render**, via werkzeug's reloader calling
  `ensure_echo_on()` → `termios.tcsetattr` (`_reloader.py:429-453`, fires under `debug=True` with the
  reloader on). Confirmed by bisection: `use_reloader=False` → fine, `debug=False` → fine, `app.py`
  as shipped → stopped. The patched tree hangs identically in that mode. Filed as **#15**. Because of
  it, the pty gate below deliberately uses a launcher that isolates the `run_ffmpeg` defect rather
  than the literal doc line — otherwise the gate would report a hang whether or not #7 is fixed.
- **NEW FINDING — `/api/execute` can rewrite files in `input/`.** `-y` is blocked only in
  `validate_extra_encode_args`, never in `validate_ffmpeg_command`, and the chat system prompt does
  not forbid it, so a model-emitted `-y` targeting an existing `input/` file returns 200 and changes
  its bytes — against CLAUDE.md's "source files in `input/` are never modified". Pre-existing and
  untouched here. An earlier draft of my `/api/execute` comment asserted the *opposite* (that the
  refusal is what protects `input/`); the adversarial pass caught it and the comment was corrected
  before shipping. Filed as **#16**.
- `probe()` (`ffmpeg_utils.py:159`) is the **only** spawn site in the repo with no `timeout=`, so a
  wedged ffprobe blocks a Flask worker indefinitely. Reachable from `GET /api/probe/<name>` and from
  `get_video_info` on every render route. Not part of #7; noted for #14's list.
- `_output_arg_info` reports a pattern output's `name` as the literal `frame%03d.png`, which is not a
  file the caller can load back. Pre-existing, unchanged, same blind spot the stat guard tripped on.
- **Why this survived this long:** an agent shell has no controlling terminal (`tty` → `not a tty`,
  `TTY ??`, `TPGID 0`), so an agent-launched server cannot hit it and every render passes. The user's
  own running instance is in that state too. It needs a human typing the documented line into
  Terminal — and reproducing it requires allocating a pty on purpose (`script -q /dev/null`, or
  `pty.fork()`). An earlier draft of the gotchas note claimed this was "not testable from an agent
  shell"; that was **false** and was corrected — `script -q /dev/null` reproduces all of it.

#### Verification

Four independent gates, each on its own scratch copy and port; the real repo was never used as a
test target and the user's server on 5001 was never signalled or POSTed to.

**Gate 1 — does the fix cure the hang? PASS, with a negative control.** Real pty (`pty.fork()` +
interactive zsh on `ttys010`, job control on), Flask launched into a **background** process group
that still holds the tty on fd 0, `PGID != TPGID` asserted from `ps` for whoever owns the listening
socket, then a real `POST /api/render_timeline`.

| arm | tree | result |
|---|---|---|
| A | patched | HTTP **200** in 1.70s; states seen `['Python:S', 'ffmpeg:R']` — `ffmpeg:T` **absent**; output 798,790 B, ffprobe-decodable 1920×1080 h264 + aac, 600 frames / 20.000000s |
| B | **only** `run_ffmpeg`'s two lines reverted | curl exit 28, HTTP **000** after the full 60s; states `['Python:S', 'Python:T', 'ffmpeg:T']`; **no output file at all** |
| C | `-nostdin` only, no DEVNULL | HTTP 200 in 1.70s — each half sufficient alone |
| D | DEVNULL only, no `-nostdin` | HTTP 200 in 1.70s — likewise |

Arm B's `ps` trace shows Flask, the reloader child, the resource trackers and ffmpeg all flipping
`S → T` within 0.3s of the POST. Arms A, C and D produced a **byte-identical** render
(`de815c8b372082429f92894f8d262a1d`). Arm A's sampled argv carries `-nostdin` as ffmpeg's first
global option, and `PGID 81524 != TPGID 81520` confirms the pass is not an artefact of a foreground
launch.

**Gate 2 — does it change any output byte? NO.** Two instances, patched vs. `run_ffmpeg`'s two lines
reverted, same timelines through the real routes. **5 cases × 2 arms, all equal at both the file-md5
and the `framemd5` level:** plain trim; 2-clip concat with `headHoldSec` + reversed + `speed 0.75` +
`tailHoldSec`; `under50mb` two-pass h264; `under50mb_hevc` two-pass x265; `/api/render_a1`
(whose JSON body — `noise_fill_sec 1.0`, `sequence_sec 6.167`, `noise_gain_db 12.0` — also matched).
Controls that make that meaningful: the pipeline is byte-reproducible (same timeline twice → same
md5), and the method **does** detect real changes (`inSec` 0.5 → 0.6 changed both the file md5 and
the frame count 60 → 57). Argv evidence via a transparent ffmpeg shim: patched arm 15/15 invocations
began `('-nostdin', '-y')`, unpatched 0/7, and after stripping that one token the two arms' argv were
token-for-token identical on all 7 comparable invocations including both two-pass passlog paths. No
`.ffpass*` leftovers, so the flag did not disturb the passlog dance.

**Gate 3 — the `/api/execute` guard, re-run by me after the rewrite** (own instance, port 5091):

| case | result |
|---|---|
| refusal: existing output, no `-y` | **500** "refused to overwrite…", target md5 unchanged |
| refusal: multi-output `… taken.mp4 -f null -` | **500** — a case the stat guard **missed** |
| output = existing file in `input/`, no `-y` | **500**, `input/src.mp4` md5 **unchanged** |
| happy path: new output | 200, file written |
| **`image2` pattern `output/f%03d.png`** | **200**, `f001/f002/f003.png` on disk — *the regression, fixed* |
| **`-f segment` pattern** | **200**, `seg000.mp4` on disk |
| overwrite **with** `-y` | 200, guard correctly silent |
| no positional output (`-f null -`) | 200 |
| bogus filter | 500 "ffmpeg failed" — the returncode branch, not the guard |
| command already containing `-nostdin` | 200, duplicate harmless |

Zero tracebacks and zero logged errors in the scratch server log. `-nostdin` proven active on this
path by the refusal's *form*: `File 'output/taken.mp4' already exists. Exiting.` with **no**
`Overwrite? [y/N]` prompt — the non-interactive wording.

**Gate 4 — adversarial refutation.** Found the pattern-output false failure (fixed by the rewrite,
re-verified in Gate 3), the FAT32 `mtime_ns` collision and the `argv[-1]`-bypass (both dissolved by
the same rewrite), the false `input/`-protection claim in my comment (corrected), and the false
"not testable from an agent shell" claim in my gotchas edit (corrected). It could **not** break
`-nostdin` at index 1 or the DEVNULL redirect: 14 real invocations across both two-pass paths
(h264 + hevc + x264 + x265/10-bit) all succeeded with `argv[1] == '-nostdin'`, nothing in either file
slices the full argv, and no invocation anywhere in the repo legitimately reads stdin — the validator
rejects `-i -`, `-i pipe:0` and `-i /dev/stdin`, and `-nostdin` does not disable stdin as a *data*
source in any case (`cat x | ffmpeg -nostdin -i -` is byte-identical). It also independently
reproduced the original bug, including the 5-process `STAT T` count.

One figure cited in an early draft of the gotchas note — an md5 for the "identical with and without
the flag" claim — came from a report I had not reproduced myself and named no command, so it was cut
and replaced with Gate 2's own 5-case measurement. A useful caveat surfaced with it and was kept: in
**Matroska** the file md5 differs run-to-run with identical flags (random SegmentUID), so anyone
re-verifying with `.mkv` must compare `framemd5`, not file bytes.

---

## 8. MEDIUM — No cancellation: abandoned renders keep burning CPU

**Status:** NOT STARTED
**Confidence:** VERIFIED by running
**Where:** `app.py:1901` (`debug=True, extra_files=[VERSION_FILE]`); `ffmpeg_utils.py:937`

### What's wrong
There is no cancel path anywhere in the app. A client disconnect does not stop a render — verified:
`curl --max-time 1` returned, and ffmpeg kept running and finished writing the full 48s file.

Worse, the `debug=True` reloader restarts the server whenever a watched `.py` file or `VERSION`
changes, mid-request. The ffmpeg child is **reparented to PID 1 and keeps encoding at full CPU**,
the HTTP response is never delivered, and the frontend shows nothing (see **#6**):

```
BEFORE touch: 13851 13761 RN  /opt/homebrew/bin/ffmpeg -y -i ...     # child of the server
AFTER touch:  13851     1 RN                                          # ORPHANED, still running
              file grew 8.3MB -> 14.1MB -> 24.4MB, finished duration=60.0
client: curl_status=000 / curl_rc=52 (empty reply from server)
server: "* Detected change in '.../VERSION', reloading"
```

If the restart lands during pass 1 of a two-pass mode, no output file is ever produced and the
`.ffpass-0.log`/`.mbtree` files are left behind (the `finally` at `ffmpeg_utils.py:756` never runs).

### Fix
At minimum, make the failure visible — that is **#6**, and it should land first: report "lost
contact with the backend — the render may still be running". Properly: run renders through a small
in-process job registry whose ffmpeg children are killed on process exit (`atexit` + process
group), or run the backend with `use_reloader=False` when long renders are expected.

**Effort:** ~1h for the visible-failure half; longer for a real job registry.

---

## 9. MEDIUM — Failed renders leave corrupt partials in the Export Bin

**Status:** NOT STARTED
**Confidence:** VERIFIED by running
**Where:** `app.py:651`, `app.py:1333`; passlogs at `ffmpeg_utils.py:643`

### What's wrong
When ffmpeg fails or is interrupted partway, the half-written output file stays in the export
directory, and `/api/outputs` lists it as a real export — including 0-byte files, which ffmpeg then
refuses to open. The name is also now taken, so the retry gets `_1`. Two-pass passlog `.temp` files
(up to ~9 MB each) are not cleaned on the failure path, only on success.

### Fix
Same pattern as **#3**: render to `out_path + ".part"`, `os.replace()` on success, unlink on
failure, and move the passlog cleanup into a `finally` that also covers the interrupted case.
Worth doing in the same commit as #3 since it is the same idea in a second place.

**Effort:** ~20 lines.

---

## 10. MEDIUM — Frontend races and wedges

**Status:** NOT STARTED
**Confidence:** VERIFIED by running, except the last item (TRACED)
**Where:** see each item

There is **no `AbortController` anywhere in `frontend/src`**, which is the root of the first item
and a contributing factor to the rest.

| Item | Where | Symptom |
|---|---|---|
| Unsequenced `probe()` in Media Bin | `MediaLibrary.jsx:91` | a slow response overwrites a newer one: **wrong file's metadata**, wrong Reformat target |
| Multi-file drop aborts at first failure | `Timeline.jsx:107` | remaining files **vanish silently** |
| Playback wedges on a missing source | `useTimelinePlayback.js:309` | playback never recovers |
| Opening a project discards unsaved work | `App.jsx:1417` | timeline **and undo history** gone, no prompt |

### Fix
An `AbortController` per in-flight probe (abort the previous on selection change), or a
request-sequence guard that drops stale responses. Make the drop loop `Promise.allSettled` and
report per-file failures. Add a dirty-check confirm before opening a project.

**Effort:** ~40 lines across four files.

---

## 11. MEDIUM — Malformed payloads produce HTML 500s instead of 400s

**Status:** NOT STARTED
**Confidence:** VERIFIED by running
**Where:** `app.py:681`, `app.py:614` and the other POST routes; `ffmpeg_utils.py:175`

### What's wrong
`request.get_json(force=True)` followed by direct indexing (`data["input"]`) means a missing key,
a wrong type, or a NaN time raises uncaught and returns an HTML 500 rather than a 400 with a
reason. Combined with **#6** the user sees nothing at all. Also: a file whose container carries no
duration is measured as 0 s and becomes completely unrenderable, with no message saying why.

### Fix
A small shared validation helper per route: required keys, types, and numeric ranges → 400 with the
offending field named. Treat a 0/absent duration as an explicit "cannot read duration" error at
probe time rather than letting 0 flow into the timeline math.

**Effort:** ~40 lines plus one helper.

---

## 12. MEDIUM — Fresh-machine setup failures

**Status:** NOT STARTED
**Confidence:** VERIFIED by running (real `git clone`, real server)
**Where:** `app.py:110` (`_list_dir`), `app.py:159` (upload), `ffmpeg_utils.py:110` (`_tool`),
`app.py:419` (browse), `app.py:151` (upload extension check)

| Item | Symptom |
|---|---|
| `input/`/`output/` never created | A clone that skips the documented `mkdir -p` returns 500 from `/api/files`, `/api/outputs`, `/api/upload`; with `App.jsx:482` having no `.catch` it presents as a merely-empty Media Bin |
| Missing ffmpeg/ffprobe | Opaque 500s, never the clear message the docs promise |
| Export-dir Browse | **Silent no-op** when macOS Automation permission is denied |
| Non-Latin filenames on upload | Rejected with the nonsense error `"unsupported file type: mp4"` |

The dirs-missing case is mitigated on the real hand-off path (the share zip ships `.gitkeep` files
and the install runbook makes `mkdir -p` a mandatory phase with its own acceptance test), which is
why this is MEDIUM rather than HIGH — but the code should be self-healing rather than relying on a
runbook step, and `list_projects` (`app.py:199`) and `PREVIEW_CACHE_DIR` already use exactly that
pattern.

### Fix
`os.makedirs(base, exist_ok=True)` at the top of `_list_dir` and before `f.save(dest)` in `upload`.
A startup check that `FFMPEG`/`FFPROBE` exist, surfaced as a clear error. Surface the Automation
denial instead of returning `{"cancelled": True}`. Base the upload extension check on the actual
extension rather than a sanitized name.

**Effort:** ~6 lines backend + 2 in `App.jsx` + messages.

---

## 13. LOW — `.preview_cache` never evicted

**Status:** NOT STARTED
**Confidence:** VERIFIED by running
**Where:** `ffmpeg_utils.py:924-927`

**414 MB across 301 files today, of which ~211 MB is already dead.** The cache key is
`{basename}.{mtime}.preview.mp4`, so every edit to a source file strands its old entry forever.
Nothing prunes, by age, count or total size.

### Fix
Prune on startup (or on each miss) by total size or age — keep the newest N or cap at a few
hundred MB. Deleting orphans whose `(basename, mtime)` no longer matches any file in `input/` or
the export dir would reclaim the dead 211 MB immediately.

**Effort:** ~20 lines.

---

## 14. LOW — Remaining sharp edges

**Status:** NOT STARTED

| Item | Where | Note | Confidence |
|---|---|---|---|
| `probe()` has no timeout | `ffmpeg_utils.py:159` | One unresponsive file wedges a request indefinitely; nothing bounds it | PLAUSIBLE — nobody could produce a file that actually hangs ffprobe |
| Chat "Run" hangs 10 minutes | `app.py:1885` | If the generated command omits `-y` and the output exists, ffmpeg blocks on the overwrite prompt until the 600s timeout | VERIFIED |
| Output name joined unsanitized | `app.py:1266`, also `:1489`, `:1573` | `8/25 hero cut` fails with ffmpeg's **version banner** as the error text; `../x.mp4` writes outside the bin and reports success. Nothing is overwritten (the uniqueness loop does check `os.path.exists`) | VERIFIED |
| `validate_ffmpeg_command` checks only the last output | `ffmpeg_utils.py:2389` | Permits writing into `input/`, so the "source files are never modified" invariant depends on the Agent tab not emitting such a command | PLAUSIBLE |
| `.export_settings.json` is committed | `app.py:249` | Every clone inherits the developer's `under50mb_hevc` mode. It is also a non-atomic read-modify-write, so concurrent saves lose an update and a crash can reset the export dir, quality and **all saved presets** | VERIFIED |

### Fix
The name-sanitizing items are best done as one shared helper used by `render_timeline`,
`render_a1`, `reformat` and `unique_output_name` so all four agree. Add `-y` (or reject a command
without it) in `/api/execute`. Add a `timeout` to `probe()`. Untrack `.export_settings.json` and
write it via temp + `os.replace`.

**Two of these rows are already resolved or superseded by 0.31.0 (#7):** the "Chat Run hangs 10
minutes" row is FIXED — `/api/execute` now passes `-nostdin` and reports the overwrite refusal as a
500 instead of blocking for 600s (the row's `app.py:1885` pointer was also stale; the call is at
`:2007`). The `validate_ffmpeg_command` row is superseded by **#16**, which verified the `input/`
write by running it. `probe()`'s missing timeout was re-confirmed during #7 as the only spawn site in
the repo with no `timeout=`, and remains open here.

---

## 15. HIGH — The documented launch command stops the server at boot, before any render

**Status:** NOT STARTED
**Confidence:** VERIFIED by running, under a real pty, and bisected to the exact call
**Where:** `.venv/lib/python3.9/site-packages/werkzeug/_reloader.py:429-433` (called at `:453`),
triggered by `app.run(debug=True, ...)` at the bottom of `app.py`
**Found while fixing #7** (2026-08-26). Not the same defect: #7 was ffmpeg's `tcsetattr` at render
time; this is werkzeug's `tcsetattr` at startup. Fixing #7 does not help here, and this is the
reason #7's fix does **not** make the documented Terminal workflow work end to end.

### What's wrong

Typing the launch line this project documents —

```
source .venv/bin/activate && nohup python3 app.py > /tmp/flask_dev.log 2>&1 &
```

(`agentic_installation.MD:209`, and the run-app skill at `.claude/skills/run-app/SKILL.md:24`)

into an **interactive Terminal** stops the whole process group in `STAT T` before it ever serves a
request. `nohup` redirects stdout and stderr but **never stdin**, so fd 0 is still the tty; `&` puts
the job in a background process group; werkzeug's reloader then calls `ensure_echo_on()` →
`termios.tcsetattr(sys.stdin, ...)`, which from a non-foreground group raises SIGTTOU and stops the
group. `ensure_echo_on` guards against stdin *not being a tty* — the failure mode here is the
opposite, stdin **is** a tty and just isn't ours to touch.

The user-visible symptom is that the app never comes up: no port 5001, and `/tmp/flask_dev.log`
holds only the two normal banner lines with no error, because nothing crashed.

### How to reproduce

Needs a real controlling terminal, so an agent shell has to allocate one:

```bash
script -q /dev/null zsh -i     # or pty.fork() + interactive zsh; job control must be on
# then, inside it, from the repo root:
source .venv/bin/activate && nohup python3 app.py > /tmp/flask_dev.log 2>&1 &
ps -o pid,pgid,tpgid,stat,command -p $!    # STAT T, PGID != TPGID
curl -s -m 5 http://127.0.0.1:5001/api/files; echo "exit $?"   # exit 7/28, never answers
```

Bisected: `use_reloader=False` → serves normally. `debug=False` → serves normally. `app.py` exactly
as shipped → stopped. Confirmed on both the patched and unpatched trees, i.e. independent of #7.

### Fix

A design decision, which is why it was left out of #7 rather than fixed silently. Options, cheapest
first:

1. **Change the documented command** — add `< /dev/null` to both docs
   (`nohup python3 app.py < /dev/null > /tmp/flask_dev.log 2>&1 &`). Two-line docs edit, no code
   change, and it fixes the launch the user actually types.
2. **Redirect stdin in `app.py`** before `app.run` when stdin is a tty and we are not the foreground
   group — robust against however the user launches it, but it is the app second-guessing its own
   terminal.
3. **Disable the reloader** (`use_reloader=False`) — removes the trigger, but costs live reload
   during development, which is a real workflow loss.

(1) is the smallest correct change and the one worth doing; (2) is worth adding only if launching
from a Terminal is meant to be a supported path for non-developers.

**Effort:** two lines of docs for (1); ~5 lines for (2).

---

## 16. HIGH — The Agent tab can overwrite source media in `input/`

**Status:** NOT STARTED
**Confidence:** VERIFIED by running (HTTP 200, source file's md5 changed)
**Where:** `ffmpeg_utils.py:2410` (`validate_ffmpeg_command`) vs. `ffmpeg_utils.py:370,392`
(`_EXTRA_ARG_CONFLICTS`), reached from `app.py` `/api/execute` at `:2007`
**Found while fixing #7** (2026-08-26). This is the VERIFIED, `-y`-shaped version of #14's
`validate_ffmpeg_command` row, which was logged as PLAUSIBLE.

### What's wrong

CLAUDE.md states "source files in `input/` are never modified". A chat command can modify them.
`_media_path_ok` deliberately allows an output argument naming a file that **already exists** in
`input/` (a brand-new name there is rejected as "input file does not exist"), and `-y` is blocked
**only** in `validate_extra_encode_args` — the custom-export Advanced field — never in
`validate_ffmpeg_command`. So a generated command of the form

```
ffmpeg -y -i input/src.mp4 -t 1 -c copy input/other_existing.mp4
```

passes validation, runs, returns `{"ok": true}`, and replaces the bytes of a source file. Nothing
in the Agent tab's system prompt forbids `-y`, and models emit it habitually because it is the
normal way to make ffmpeg non-interactive.

Without `-y` the same command is refused by ffmpeg — as of 0.31.0 that refusal is correctly reported
as a 500 instead of hanging (#7) — so today the *only* thing standing between a model's `-y` and the
user's footage is that the model happens to name an output that doesn't exist yet.

### How to reproduce

```bash
md5 input/<some-existing-file>.mp4
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"command":"ffmpeg -y -i input/<other>.mp4 -t 1 -c copy input/<some-existing-file>.mp4"}' \
  http://127.0.0.1:5001/api/execute
md5 input/<some-existing-file>.mp4     # different
```

Verified on a scratch copy with its own `input/`, never against the real one.

### Fix

Reject an output path that resolves inside `input/` in `validate_ffmpeg_command` — the validator
already resolves and classifies every path argument, so this is a condition on the branch that
currently *permits* an existing `input/` file as an output, not new machinery. Fixing it there
covers `-y`, `-n` and the bare form together, so it is strictly better than adding `-y` to a
denylist. Note `validate_ffmpeg_command` checks only the **last** output argument (#14), so a
multi-output command can still slip a second output past it; both are the same one-function fix and
should be done together.

**Effort:** ~10 lines in one function, plus a test for each of the three forms.

---

## Verified-clean notes

Recorded so nobody re-investigates these:

- The **repo was not modified** by the audit: `git status` clean, `input/` 54 files, `output/` 13,
  `projects/` 7 all intact. The 4 new `.preview_cache` entries came from read-only preview requests.
- **No orphaned ffmpeg processes** were left behind. (`pgrep -f ffmpeg` matches the project's own
  dev servers because the repo path contains "ffmpeg" — not encoders.)
- **Two Vite dev servers were running concurrently** during the audit (up 4d17h and 1d16h), so one
  holds `:5173` and the other `:5174`. A browser tab on the wrong one serves a stale bundle against
  the restarted backend — worth killing one before debugging anything frontend-related. This is an
  environment observation, not a code defect.
- `render_timeline`'s inlined uniqueness loop (`app.py:1268-1274`) **does** correctly check the
  custom export dir, unlike `fu.unique_output_name`. Renders are safe from clobbering an existing
  file today; see #4 for why the two should be unified anyway.
