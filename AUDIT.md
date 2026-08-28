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
| 2 | HIGH | Two same-name renders destroy each other | `app.py:1271` | VERIFIED *(judged on re-run)* | **FIXED** (0.35.0) |
| 3 | HIGH | A failed preview poisons the cache permanently | `ffmpeg_utils.py:928` | VERIFIED | **FIXED (0.33.0)** |
| 4 | HIGH | Export-Bin split-brain: lists one dir, reads another | `app.py:91,130` | VERIFIED | **FIXED** (0.36.0) |
| 5 | HIGH | Saving a project can destroy another with no prompt | `app.py:211` | VERIFIED | **FIXED** (0.29.0) |
| 6 | HIGH | Silent failure: timeouts + non-JSON errors show nothing | `frontend/src/api.js:6` | VERIFIED | **FIXED** (0.29.1) |
| 7 | HIGH | Every render hangs if the server started as a bg job | `ffmpeg_utils.py:940` | VERIFIED | **FIXED** (0.31.0) |
| 8 | MEDIUM | No cancellation; abandoned renders burn CPU | `app.py:1901` | VERIFIED | **FIXED** (0.39.0 orphan-on-exit half, 0.45.0 client-disconnect half) |
| 9 | MEDIUM | Failed renders leave corrupt partials in the Export Bin | `app.py:651` | VERIFIED | **FIXED** (0.34.0) |
| 10 | MEDIUM | Frontend races and wedges | `MediaLibrary.jsx:91` | VERIFIED *(all four by running; the Export Bin has the same probe race)* | **FIXED** (0.41.0) |
| 11 | MEDIUM | Malformed payloads produce HTML 500s, not 400s | `app.py:681` | VERIFIED *(500s, but JSON not HTML since 0.29.1)* | **FIXED** (0.40.0) |
| 12 | MEDIUM | Fresh-machine setup failures | `app.py:110` | VERIFIED *(all four by running; item 3 has a second, measured face)* | **FIXED** (0.42.0) |
| 13 | LOW | `.preview_cache` never evicted (414 MB, 211 MB dead) | `ffmpeg_utils.py:924` | VERIFIED *(re-measured worse: 602 MB, 502 MB dead)* | **FIXED** (0.43.0) |
| 14 | LOW | Remaining sharp edges (5 small items) | various | mixed | FIXED in 0.44.0 |
| 15 | HIGH | Documented launch command stops the server at boot | `_reloader.py:429` | VERIFIED | **FIXED** (0.31.1) |
| 16 | HIGH | The Agent tab can overwrite source media in `input/` | `ffmpeg_utils.py:2410` | VERIFIED | **FIXED** (0.32.0) |
| 17 | HIGH | Hold Frame fails on every silent source — all 27 of this machine's videos | `ffmpeg_utils.py` `build_holdframe_filter` | VERIFIED | **FIXED** (0.38.0) |
| 18 | HIGH | V2's lane drew short of V1's; its end read frame 356, not 361 | `clipMath.js:9`, `Timeline.jsx:18` | VERIFIED | **FIXED** (0.37.0) |
| 19 | MEDIUM | The documented restart command orphans a running encoder | `_reloader.py:275`, run-app SKILL.md:23 | VERIFIED | **FIXED** (0.45.1) |

Items 15 and 16 were found while fixing #7 and are new since the original audit. Item 17 was found
by #4's real-installation smoke test. Item 18 was reported by the user. Item 19 was found while
re-measuring #8's shutdown half for the 0.45.0 fix.

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

## 2. HIGH — Two same-name renders destroy each other

**Status:** FIXED in 0.35.0 — see [Resolution](#resolution-2)
**Confidence:** VERIFIED by the finder (5/5 reproductions); code shape confirmed by reading. Its
refuter crashed on a credentials error, so this was the one entry no adversary attacked — **the
refutation was re-run before fixing** (see the Resolution's *Re-judging* section: the finder's two
reproductions were both already dead, and what remained was a third, narrower race the finder had not
described).
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

<a id="resolution-2"></a>
### Resolution — 0.35.0 (2026-08-27)

#### Re-judging the finding first
This was the only entry no adversary ever attacked, so the refutation pass was re-run against the
current code before writing any fix — on a scratch instance (port 5098, `/tmp/g2`), with a
high-entropy source built specifically to make the window wide: `input/big.mp4`, 15s 1080p noise,
1.4 GB, ~8s to re-encode losslessly. Both of the finder's reproductions are **dead**, killed as a side
effect of #9's staging (0.34.0), and each was verified by frame hash rather than by exit code:

| The finder's claim | Current behavior |
|---|---|
| Single-pass: two concurrent renders both return `{"output":"collide.mp4"}`, one file survives (5/5) | `collide.mp4` **and** `collide_1.mp4`, both valid, `frame0` of each matching its own source window exactly |
| Two-pass: both fail on a shared stats file, leaving a 0-byte file listed as an export | both `200`, both valid, **0** stats-file errors in the log, **0** 0-byte files, **0** passlog leftovers |

The reason is that #9 moved every render into `<export dir>/.partials/<pid>.<tid>/`, and
`stats_prefix = out_path + ".ffpass"` (`ffmpeg_utils.py:699`, `:844`) derives from that path — so two
two-pass renders can no longer address the same stats file even in principle.

**What survived re-judging is a third race the finder did not describe**, one that 0.34.0 introduced
in `commit_output` while fixing #9: the commit chose its name with `while os.path.exists(final)` and
then called `os.replace`. Check-then-act again, just moved — the window shrank from "the whole of pass
1" to the microseconds between those two calls, but a lost render is a lost render. An end-to-end test
cannot honestly settle a window that small, so it was settled at the function level: with the gap
artificially widened to 0.3s, **two concurrent commits left one file** and both reported the same
name; at 8 threads, **7 of 8 payloads were destroyed** and all 8 reported `shared.mp4`.

#### Changes made
One function, `commit_output` in `ffmpeg_utils.py`. Nothing else in either file changed — no route, no
name picker, no encoder argument.

```python
while True:
    try:
        fd = os.open(final, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        final = f"{base}_{n}{ext}"
        n += 1
        continue
    os.close(fd)
    break
try:
    os.replace(staged, final)
except OSError:
    try:
        os.remove(final)
    except OSError:
        pass
    raise
```

#### Reasoning
- **`O_CREAT|O_EXCL` is a claim; `os.path.exists` is only a question.** The kernel guarantees exactly
  one caller can create a given path, so the name is allocated in one indivisible step. This is the
  audit entry's own first suggestion, applied at the point that now actually allocates names.
- **No lock, no queue, no semaphore.** A `threading.Lock` would work for threads in one process but
  not for a second `app.py` (the audit's own repro is *two clients*, and nothing stops a user starting
  a second backend). `O_EXCL` is filesystem-level, so it holds across processes, and it adds no
  serialization: renders still run fully concurrently and only the name claim is exclusive.
- **The placeholder is removed if `os.replace` fails.** The reservation creates a 0-byte file; leaving
  it behind on a failed move would re-create finding #9's exact symptom (a 0-byte export listed in the
  Bin). Verified by forcing `os.replace` to raise `OSError(ENOSPC)`: the exception propagates
  unchanged and the export directory is left empty.
- **The routes' own uniqueness loops were deliberately left alone** (`unique_output_name`,
  `render_a1`'s loop, `render_timeline`'s loop at `:1271`). They are now advisory — they pick the name
  a request *asks* for, and `commit_output` is what decides the name it *gets*, which is what every
  route already reports back. Rewriting four call sites to also reserve atomically would be
  restructuring for no behavior gain, and the audit's line pointer (`app.py:1271`) is only where the
  wrong name is guessed, not where damage happens.
- **The third bullet of the suggested fix — a `Semaphore(1)` CPU cap — was not implemented.** It is
  not this defect: throttling concurrency saves CPU but nothing about it prevents a lost file, and
  serializing renders would be new behavior (a second render would silently wait instead of running).
  Left to #8, where cancellation and concurrency policy belong.

#### Observations
- **0.34.0's fix contained a smaller copy of the bug it fixed.** Worth recording as a pattern rather
  than an embarrassment: "move the write somewhere private, then rename into place" removes the
  *partial-file* hazard but not the *name-allocation* hazard, and the second one is invisible unless
  the check-and-act window is deliberately widened. Any future fix of this shape needs the same
  treatment.
- **Every writer benefits from the one edit** because #9 had already funnelled all of them through
  `commit_output`: `render_timeline`, `trim`, `splice`, `hold_frame`, `reverse`, `reformat`,
  `render_a1`, and all six size-capped/custom export routes via `multipass_export_render`. Confirmed
  by grep that no render path reaches the export directory any other way — the only other
  `os.replace` calls in the backend are the project save (#5, fixed in 0.29.0) and the preview cache
  (#3, whose name is content-derived, so two writers there produce identical bytes by construction).
- **A residual worth stating plainly:** between the reservation and the move there is now a
  microsecond-scale moment where a 0-byte file with the final name exists, so a request to
  `/api/outputs` landing exactly in it could list a 0-byte export. It is a strictly better trade than
  losing a render, it is orders of magnitude narrower than the window #9 closed (which lasted for the
  whole render), and a `kill -9` inside it would leave a 0-byte file — the same SIGKILL caveat already
  recorded for #3 and #9.
- **The frontend needs nothing.** The finder correctly noted the button guard is per-tab
  (`Timeline.jsx:778`/`:878` from `App.jsx:209` `rendering`), but the fix belongs in the backend
  precisely *because* the frontend cannot be trusted to coordinate two tabs or survive a reload. No
  frontend file was touched.
- **New measurement supporting the audit's CPU-thrash bullet, which is #8's to act on.** Two
  concurrent `under50mb_hevc` renders of a 1.6s real clip took **~8 minutes** of wall clock on the
  live install — two libx265 two-pass encodes fighting for the same cores, each running both of its
  passes. Nothing is lost or corrupted (that is what this fix guarantees), but "the app feels frozen"
  is a fair description of the experience, and it is the concrete case for the concurrency cap the
  entry suggests. Recorded here; deliberately not implemented, because capping concurrency changes
  what a second render *does* rather than fixing what it *breaks*.

#### Verification
Scratch instance only (port 5098, `/tmp/g2`); the real `input/`, `output/`, `projects/` were never
test targets. Function-level race harnesses: `/tmp/g2race.py` (2 threads) and `/tmp/g2race8.py`
(N threads, configurable window). `/tmp/g2old` holds a copy of the code with **only**
`commit_output` reverted to its 0.34.0 body, so the comparison isolates this one change.

| Race harness | 0.34.0 (`exists` loop) | 0.35.0 (`O_EXCL`) |
|---|---|---|
| 2 threads, window widened 0.3s | 1 file, **1 payload destroyed**, both reported `x.mp4` | `x.mp4` + `x_1.mp4`, both payloads intact |
| 8 threads, window widened 0.3s | 1 file, **7 payloads destroyed**, all 8 reported `shared.mp4` | 8 files, 8 payloads, 8 distinct names |
| 24 threads, real timing (no widening) | — | 24 files, 24 payloads, 0 lost |
| `os.replace` forced to fail after reservation | — | `OSError` propagates, **0** files left (no 0-byte placeholder) |
| single commit (the ordinary case) | `y.mp4` | `y.mp4` — unchanged |

End-to-end battery (`/tmp/g2rep.sh`, nine cases, all `200` unless noted), every file probed and its
first video frame hashed against the exact source window it should contain:

- **1** two simultaneous lossless renders, one name → `collide.mp4` + `collide_1.mp4`, frame hashes
  `1ae73191…` / `e02197ff…` matching big@0s / big@10s respectively.
- **2** two simultaneous `under50mb_h264` → `tp.mp4` + `tp_1.mp4`, 0 stats errors, 0 0-byte files,
  0 passlog leftovers.
- **3** two simultaneous `under50mb_hevc` (a different stats mechanism — `-x265-params pass/stats`)
  → `hv.mp4` + `hv_1.mp4`, both valid.
- **4** mixed lossless + two-pass together → `mix.mp4` + `mix_1.mp4`.
- **5** three simultaneous renders, one name → three files, **3 of 3 distinct** frame hashes.
- **6** two simultaneous A1 stems → `stem.wav` + `stem_1.wav`, both valid.
- **7** the real-world path — first request abandoned after 1s (`curl -m 1`, render continues per #8),
  then the same name requested again → `reload.mp4` + `reload_1.mp4`, both valid, each with its own
  content.
- **8** *cross-route* collision, `/api/trim` against `/api/render_timeline` on one name (two different
  name pickers) → `cross.mp4` + `cross_1.mp4`.
- **9** two simultaneous `/api/reformat` on one name → `rf.mp4` at 872x490 and `rf_1.mp4` at 1280x720,
  i.e. each response's file really is the resolution that request asked for.
- 0 tracebacks; `.partials` cleaned in every case.

Real installation (5001, restarted onto the new code, `/api/version` → `0.35.0`, Vite 5173 `200`):
two simultaneous renders of one output name on the user's own media, under **their** existing
`under50mb_hevc` setting (untouched, and the slowest real path there is). Both `200`; the second
request won `audit2_smoke.mp4` (12,689,608 B) and the first was bumped to `audit2_smoke_1.mp4`
(12,048,937 B); both valid, with different first-frame hashes — i.e. each file holds its own render.
Both test files were then deleted, leaving no `audit*`, `.part*`, `.partials`, or 0-byte file anywhere
in `input/` or `output/` (checked with `find`), and the user's export settings unchanged
(`under50mb_hevc`, default export dir).

Note on directory counts: unlike the earlier resolutions in this document, absolute counts are not
quoted as a before/after here, because the user was working in the app during this session — `input/`
and `output/` legitimately grew with their own uploads and exports (timestamped 11:48–12:03 the same
morning). The cleanup claim above is therefore made by name and by pattern, not by count.

---

## 3. HIGH — A failed preview poisons the cache permanently

**Status:** FIXED in 0.33.0 — see [Resolution](#resolution-3) below
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

<a id="resolution-3"></a>
### Resolution — 0.33.0 (2026-08-26)

#### Changes made
Two edits, both in `ffmpeg_utils.py`, both inside `get_or_make_preview`'s existing
`if not os.path.exists(cached):` block. No route, no caller, and no other function changed.

1. `import threading` added to the import block (needed for the temp name — see below).
2. The transcode now writes to a private temp path and is moved into place only on success:

```python
part = f"{cached}.{os.getpid()}.{threading.get_ident()}.part.mp4"
args = ["-i", path, "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-movflags", "+faststart", part]
try:
    result = run_ffmpeg(args)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])
    os.replace(part, cached)
finally:
    try:
        os.remove(part)
    except OSError:
        pass
```

The ffmpeg arguments are otherwise byte-for-byte what they were; only the output path changed. The
raised `RuntimeError` and its `stderr[-2000:]` payload are unchanged, so `/preview`'s existing 500
handler and error shape still apply.

#### Reasoning
- **`os.replace`, not a rename dance.** It is atomic within a directory, so a concurrent reader sees
  either no file at all or a complete one — never a growing one. An already-open fd on a replaced
  file also stays valid, which matters because Flask's `send_file` may still be streaming.
- **pid + thread id in the temp name, not a bare `.part`.** Flask serves these threaded
  (`app.run` defaults `threaded=True`) and one click can issue two requests for the same file
  (`MediaLibrary.jsx` and `ReformatPanel.jsx` both mount a `<video>` on the same bin selection). A
  single shared `.part` would just move the collision from the final path to the temp path.
- **`finally`, not an `except`.** The temp file has to go whether ffmpeg failed, `os.replace` failed,
  or the thread was interrupted. On the success path `os.replace` already moved it, so the
  `os.remove` raises `ENOENT` and is swallowed — that is the expected case, not an error.
- **No per-key lock**, though the audit entry offered one as an option. It would save the duplicate
  encode, but it would make the second request block for the entire transcode — a fresh hang in
  place of a fixed one, and hangs are what this audit is mostly about. Two requests now transcode
  twice and both get a valid file; the waste is CPU, which is recoverable, unlike a stuck UI. Left
  as a deliberate non-fix rather than an oversight.

#### Observations
- **My first attempt broke previews outright, and only running it caught that.** I named the temp
  file `…preview.mp4.<pid>.<tid>.part`. ffmpeg picks its muxer from the output extension, so it
  refused every single preview — *"Unable to find a suitable output format for
  '….part'; use a standard extension for the filename or specify the format manually"* — with
  `http=500` on **every** request including ones that had succeeded before the change. Reading the
  diff would not have shown this; the repro script did, immediately. The temp name now ends in
  `.part.mp4`. Recorded here because the mistake is easy to repeat: any future temp-file fix in this
  codebase must keep a real extension last, or pass `-f` explicitly.
- **Nothing enumerates `.preview_cache`.** A lookup is an exact match on
  `"<basename>.<mtime>.preview.mp4"`, so a leftover temp file can never be mistaken for a preview.
  Verified by grep: `PREVIEW_CACHE_DIR` appears only at its definition and inside this one function.
- **A `kill -9` of the Flask process still leaves one stray temp file** — no `finally` can run
  through SIGKILL. Confirmed by measurement. It is harmless in the way that matters: the *cache
  entry* is absent, so the next request re-transcodes and succeeds. The stray is disk waste only,
  and it belongs to finding #13 (`.preview_cache` has no eviction at all — 301 entries in the live
  install today). Not fixed here; that is #13's scope.
- **Pre-existing poisoned entries are not healed.** This change prevents new ones; it cannot tell an
  old bad file from a good one, since both simply exist. The live cache was checked and is clean
  (301 entries, 0 strays, no truncated files), so no user-visible cleanup is owed — but the
  CHANGELOG says plainly that deleting `.preview_cache` is the cure if anyone is already stuck.
- The audit entry's measured numbers (48 bytes, 250,820 bytes) came from a smaller source file than
  the one used here; this session's repro used a 174 MB ProRes/PCM source and saw the same two
  failures at a different scale (262,192 and 524,336 bytes). The defect is the same; only the sizes
  differ with source and timing.

#### Verification
Scratch instance only (port 5097, `/tmp/g3`, a 174 MB ProRes+PCM `input/big.mov` with
`browser_playable: False`). `/tmp/g3rep.sh` was written **before** the fix and re-run **unchanged**
after it. The real `input/`, `output/`, and `projects/` were never used as test targets.

| Case | Before | After |
|---|---|---|
| req1, cold cache | `200`, 1,215,759 B, valid | `200`, 1,215,759 B, valid |
| req2, arriving 2.0s into the transcode | `200`, **262,192 B, BROKEN** | `200`, 1,215,759 B, **valid** |
| ffmpeg killed mid-transcode | `500` | `500` (unchanged — correct) |
| cache contents after that failure | `big.mov….preview.mp4` 524,336 B, **BROKEN** | **empty** |
| next request for the same file | `200`, 524,336 B, **BROKEN — poisoned forever** | `200`, 1,215,759 B, **valid** |
| tracebacks in the log | 0 | 0 |

Then I attacked the fix rather than stopping at the repro:

- **4 simultaneous cold requests:** all four `200` and all four playable, exactly one cache entry
  left behind, **0** stray temp files.
- **`kill -9` on the Flask process mid-transcode:** one stray `.part.mp4`, and — the part that
  matters — **no** cache entry, so the next request rebuilds instead of serving junk.
- **Real installation** (5001, restarted onto the new code, both branches exercised on the user's own
  media): cache-hit path `200` / 1,728,283 B / playable; cold-transcode path `200` / 1,827,307 B /
  playable; cache 301 → 302 entries, 0 strays, 0 tracebacks. `input/` 54, `output/` 13,
  `projects/` 7 — all unchanged.

No frontend file was touched, so no rebuild was required beyond the version bundle.

---

## 4. HIGH — Export-Bin split-brain: the app lists one directory and reads another

**Status:** FIXED in 0.36.0 — every claim below re-measured on a scratch instance first, then fixed
in one pass, then re-measured with the identical script. See [Resolution](#resolution-4).
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

<a id="resolution-4"></a>
### Resolution — 0.36.0 (2026-08-27)

#### Re-measuring the finding first
Every claim in the entry still held, checked on a scratch copy of the code (`/tmp/g4`, port 5099) with
the export directory pointed at `/tmp/g4export` through the real `POST /api/export_settings`. The
entry's line numbers had moved (0.29.0–0.35.0 shifted them by ~50 in the read routes and ~130 in the
write routes); the defects had not. Baseline script `/tmp/g4rep.sh`, output `/tmp/g4_before.txt`,
re-run unchanged afterwards into `/tmp/g4_after.txt`.

| What the entry claimed | Measured on 0.35.0 |
|---|---|
| Bin lists the custom dir, `/api/probe?dir=output` and `/preview/output/` read the default | `GET /api/outputs` → `['tl.mp4']`; probe → **404**; preview → **404**; `/output/tl.mp4` → 200 |
| trim/splice/hold_frame/reverse write to the default dir and never appear | all four reported success and landed in `output/`; `/api/outputs` still `['tl.mp4']` |
| `unique_output_name` cannot see collisions in the custom dir | asked for `clash.mp4` with the custom dir **empty** → got `clash_1.mp4` (renamed because of a file in a directory nobody was exporting to) |
| — (not in the entry; found here) | With `taken.mp4` in **both** directories, the Bin listed one file and `/preview/output/taken.mp4` served the **other**: md5 `60e8b8ca…` listed vs `4cfc19b8…` served. Silently the wrong video, with the wrong Media Info beside it |
| — (not in the entry; found here) | A trim output was unreachable by **every** Bin operation: `/api/outputs` `[]`, rename → `{"error":"file not found"}`, `DELETE /api/outputs/rn.mp4` → 404, `reveal_file` → `{"error":"file not found"}` |

#### Changes made

| File / line | Change |
|---|---|
| `ffmpeg_utils.py:1135` `unique_output_name` | Second parameter `export_dir`, **required** (no default). The loop now checks `os.path.join(export_dir, candidate)`. The function's own local `base` (from `os.path.splitext`) is renamed `stem`, because in a function that now takes a base *directory* the old name meant two things. |
| `app.py:141` `serve_preview` | `base = fu.INPUT_DIR if which == "input" else fu.OUTPUT_DIR` → `base = resolve_media_dir(which)` |
| `app.py:180` `probe_file` | same one-line substitution |
| `app.py:761-764` `trim` | `export_dir = get_output_dir()`, then `unique_output_name(..., export_dir)` and `os.path.join(export_dir, out_name)` |
| `app.py:830-832` `splice` | same |
| `app.py:1776-1779` `hold_frame` | same |
| `app.py:1841-1844` `reverse` | same |

Seven sites, exactly the set the entry named. No frontend file was touched: the endpoints kept their
names and shapes, so the UI needed nothing.

#### Reasoning

- **`resolve_media_dir(which)` already existed and already said the right thing** ("Only the export
  side is user-relocatable, so it goes through `get_output_dir()`") — it was simply used at 2 of its
  9 possible call sites. The read-side fix is that helper, not a new one.
- **`export_dir` is required rather than defaulted.** A default of `OUTPUT_DIR` would have been a
  smaller diff and would have left the trap armed: the next caller to write
  `unique_output_name(name)` gets the one directory that is wrong whenever the user has moved their
  exports. Required parameter → that call no longer compiles into a silent bug, it raises
  `TypeError` (verified: `unique_output_name() missing 1 required positional argument:
  'export_dir'`). This is the anti-recurrence measure for this finding.
- **The entry's suggestion to fold `render_timeline`'s inlined loop into the helper was deliberately
  NOT done**, and neither were `render_a1`'s or `reformat`'s. All three already read `export_dir`, so
  none of them is part of the defect; replacing working code is a refactor, which these working rules
  forbid. `render_a1`'s loop isn't even the same rule — it forces `.wav` before deduping. The
  required parameter, not the de-duplication, is what stops the split coming back.
- **Five `fu.OUTPUT_DIR` references in `app.py` were left alone on purpose**, each checked
  individually rather than swept:
  - `:387` — inside `get_output_dir()` itself; this *is* the default.
  - `:530` — `browse_directory`'s starting folder, and only a fallback: the frontend always passes
    `browseDirectory(dir || defaultDir)` (`ExportSettings.jsx:102`).
  - `:622` — the `default_output_dir` field the settings dialog displays; correct by definition.
  - `:1875` `build_file_context` and `:2010` `_output_arg_info` — the **chat/execute subsystem**.
    Its paths are PROJECT_ROOT-relative and its write permission is `fu._media_path_ok`, which
    admits `input/` and `OUTPUT_DIR` only. Pointing it at a user-chosen directory changes where the
    assistant is allowed to write — a security-boundary change, not a bug fix, and #16's territory.
    Consequence recorded in §14.
- **Nothing was done about the export directory being settable to `input/`.** `POST
  /api/export_settings` accepts any absolute path, so a user can aim exports at their own sources.
  Measured rather than assumed (below): source bytes are safe, but the Media Bin gets polluted. This
  predates the fix for `render_timeline` and is now shared by five routes; logged in §14 instead of
  quietly adding validation nobody asked for.

#### Observations

- **The sharpest symptom wasn't in the entry.** The entry described 404s — empty Media Info, no
  preview. The worse case is when the *same name* exists in both directories: then nothing 404s, and
  the Bin lists one file while the preview player and Media Info Out show a different one. That is
  the kind of failure that gets trusted. It is also easy to reach, because with a custom dir set the
  two directories accumulate files with the same default names (`trimmed.mp4`, `held.mp4`, …).
- **0.35.0's `O_EXCL` claim was already protecting the export directory** from the naming split: a
  trim asking for a name taken in the custom dir would have clobbered it, but `commit_output` refuses
  and allocates `taken_1.mp4`. So the naming half of this finding was already downgraded from data
  loss to a wrong-suffix wart before today. Verified both ways: pre-fix the existing export kept its
  bytes (`frame0` unchanged) while the response reported the name it had *not* written.
- **Four writers racing on one name in a custom dir** produce four distinct files, each reported name
  present on disk — the #2 fix composes with this one without any extra work.
- **The `.preview_cache` key ignores the directory** (`<basename>.<int mtime>.preview.mp4`). Two
  different non-browser-playable files sharing a name and a whole-second mtime get one shared
  transcode. Reproduced identically on pre- and post-fix code, so it is not a regression — but this
  fix widens the set of directories that can collide from {`input/`, `output/`} to {`input/`, any
  export dir the user has used}. Logged in §14; not fixed here because changing the key means
  invalidating every existing cache entry, which is #13's territory.
- **Found by the real-installation smoke test, unrelated to this fix:** `/api/hold_frame` fails on
  **every** video in the user's `input/` — 27 of 27 have no audio stream, and
  `build_holdframe_filter` references `[0:a]` unconditionally. Filed as **#17**, verified identical
  on pre-fix code.

#### Verification

**A. The finding's own script, re-run unchanged** (`/tmp/g4rep.sh`, pre-fix code and post-fix code
swapped into the same paths so the two logs diff line-for-line):

| Case | Before (0.35.0) | After (0.36.0) |
|---|---|---|
| render_timeline output: probe / preview / download | 404 / 404 / 200 | **200 / 200 / 200** |
| trim | `output/`, not listed, download 404 | **export dir, listed, all three 200** |
| hold_frame / reverse / splice | all `output/`, none listed | **all export dir, all listed** |
| reformat, render_a1, dir=`output` clip sources | already correct | unchanged |
| name free in export dir, taken in `output/` | `clash_1.mp4` | **`clash.mp4`** |
| name taken in export dir | reported `taken.mp4`, wrote elsewhere | **`taken_1.mp4`, existing file untouched** |
| Bin-listed files that probe+preview | 1 of 3 (and that one served the wrong bytes) | **9 of 9, no name in two directories** |
| files stranded in `output/` | 6 | **0** |
| default export dir (setting cleared) | correct | unchanged, still correct |
| tracebacks | 0 | 0 |

**B. Adversarial battery** (`/tmp/g4adv.sh`, 11 sections, post-fix):

- **A** — the `input` half of both edited routes is untouched: `/preview/input/`, `/api/probe?dir=input`,
  `/api/probe` with no `dir` arg (defaults to input), `/api/files`, `/input/<name>` all 200.
- **B** — traversal still refused now that the read base is user-chosen, checked with
  `curl --path-as-is` so the client doesn't normalize the path first: `../input/a.mp4`,
  `..%2Finput%2Fa.mp4`, `..%2F..%2F..%2Fetc%2Fpasswd`, `subdir/../../input/a.mp4` all → 400
  `path '…' escapes /tmp/g4export`; `%2Fetc%2Fpasswd` → 308 → 404. Probe rejects all of them at the
  router (its `<name>` is not a `path:` converter).
- **C** — a custom dir **deleted under the running app**: `get_output_dir()` falls back to `output/`,
  and because the read side now uses the same helper it falls back *with* it — trim lands in
  `output/`, probe 200, `/api/outputs` lists it. Before, the two halves disagreed in both states.
- **D** — export dir pointed **at `input/`**: writing `a.mp4` yields `a_1.mp4`; `input/a.mp4`'s md5 is
  unchanged (`5cf344fb…` before and after). Paired run on pre-fix code shows `render_timeline` already
  did exactly this (`a_2.mp4` in `input/`, source unchanged) — pre-existing, now shared by five
  routes. §14.
- **E** — two-pass `under50mb_h264`: trim and hold_frame both land in the custom dir; 0 stats/passlog
  files and no `.partials` left behind (the #9 staging follows the new directory automatically,
  because it derives from `out_path`).
- **F** — `with space.mp4`, `hash#tag.mp4`, `café.mp4`: written to the custom dir, and probe/preview/
  download all 200 through the new base.
- **G** — the Bin operations that were dead before: rename → `{"name":"rn_new.mp4","ok":true}`, probe
  200, `DELETE` → `{"ok":true,"removed":"rn_new.mp4"}`, file gone. Paired pre-fix run: rename 404,
  DELETE 404, reveal 404, file still on disk.
- **H** — the one behaviour this fix makes *worse*, measured on both versions rather than reasoned
  about: a file produced by the chat assistant lives in `output/`. Pre-fix `probe(name,'output')`
  returned 200 and the preview played, but a render using it as a clip source already failed
  (`input file not found: /tmp/g4export/chatmade.mp4`) because clip resolution has always used
  `get_output_dir()`. Post-fix the probe 404s, so the chat panel's "load the result onto the clip"
  step returns early instead of repointing the clip at a file no render can read. The render error is
  identical before and after; only the probe/preview changed. §14.
- **I** — `POST /api/clear_output` swept the 5 files in the custom dir and left `output/keepme.mp4`
  alone.
- **J** — trim + hold_frame + reverse + render_timeline all racing on `race.mp4` in the custom dir:
  `race.mp4`, `race_1.mp4`, `race_2.mp4`, `race_3.mp4`, 4 distinct md5s, every reported name present.
- **K** — no caller can omit the directory any more: 0 one-argument call sites,
  `signature: (name, export_dir)`, and a one-arg call raises `TypeError`.

**C. Preview-cache probe** (`/tmp/g4cache.sh`, run on both code versions): two ProRes files
(`testsrc` vs `testsrc2`) named `same.mov`, mtimes forced equal, one in `input/` and one in the export
dir. Both `/preview/input/same.mov` and `/preview/output/same.mov` returned the same 7,335-byte
transcode, **identically before and after the fix** — the cache key, not this change.

**D. Real installation** (port 5001, the user's own media; the running server had already hot-reloaded
the edit, and reported `0.36.0`). Settings backed up to `/tmp/g4_settings_backup.json` first and
byte-compared at the end. Source: the shortest video in `input/` (1.625s), never written to.
- Default configuration (`output_dir` empty, `under50mb_hevc`, i.e. the two-pass path): trim →
  `output/`, listed, probe/preview/download 200, deleted through `DELETE /api/outputs`.
- Custom dir `/tmp/g4real_export`: trim and reverse both landed there, both listed, probe/preview/
  download 200, neither leaked into `output/`, both deleted through the app. `hold_frame` failed —
  #17, not this fix.
- Restored: settings file md5 identical to the backup; `input/` 54, `output/` 20, `projects/` 8 all
  unchanged; source md5 `ff7d7750…` unchanged; 0 files left in the scratch dir, 0 `g4_real*` anywhere,
  no `.partials`, 0 tracebacks.

**E. Build**: `npx vite build` ✓ 71 modules, 131ms (this is also the check that `VERSION` and
`frontend/package.json` agree at 0.36.0); `npm run lint` — same 5 pre-existing warnings, none in a
file this fix touched.

Cleanup: scratch instance killed, port 5099 clear, `/tmp/g4`, `/tmp/g4export`, `/tmp/g4real_export`
and the ProRes fixtures removed. The repro/adversarial scripts are kept at `/tmp/g4rep.sh`,
`/tmp/g4adv.sh`, `/tmp/g4adv_pre.sh`, `/tmp/g4cache.sh`, `/tmp/g4real.sh`.

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

**Status:** FIXED in 0.39.0 (orphan-on-exit half — see [Resolution](#resolution-8)) and in 0.45.0
(the deferred client-disconnect half — see [Resolution](#resolution-8b)).
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

<a id="resolution-8"></a>
### Resolution — 0.39.0 (2026-08-27)

#### Re-measuring the finding first
Re-ran the entry's three claims on 0.38.0 before touching anything, on a scratch instance (port
5095, its own `PROJECT_ROOT` under `/tmp/g8`) against a 2.1 GB / 30.0s lossless fixture so a render
lasts long enough to interrupt. All three still hold:

| Trigger | ffmpeg after the event | client | leftovers |
|---|---|---|---|
| reloader restart mid single-pass (`touch VERSION`) | **PPID → 1**, still running, ~1150% CPU, staged file kept growing to 965 MB | `curl_rc=52`, empty reply | `.partials/<pid.tid>/t1.mp4` orphaned |
| reloader restart mid **pass 1** of `under50mb_hevc` | **PPID → 1**, still encoding | `curl_rc=52` | `.partials/.../t3.mp4.ffpass` + `.ffpass.cutree` left behind |
| client disconnect (`curl -m 1`), server stays up | keeps running to completion | `curl_rc=28` | none — the render finishes and commits `t2.mp4` normally |

So the orphan-and-leak is real on both single- and two-pass paths, and the disconnect case is real
but benign (the file completes; only the client gave up).

#### The decision the entry asked to be made deliberately
The entry offers two halves — *make the failure visible* (already shipped as **#6** in 0.29.1) and
*a real job registry killed on exit*. The chosen scope for this fix is the **kill-orphans-on-exit
half only**: an in-process registry of live ffmpeg children plus `atexit`/signal handlers that stop
them when the server exits. Explicitly **out** of scope, by decision, not oversight:

- **No Cancel endpoint or button.** Stopping one named render on demand is a feature, not a bug
  fix, and would need a job-id contract the frontend does not have.
- **No client-disconnect cancellation.** Test 2 above — tab closed, connection dropped, server
  still up — is **left exactly as it was**: the render runs to completion and its file commits, it
  just has no socket to be reported on. Detecting a dead peer mid-encode is a different mechanism
  (a watcher thread polling the werkzeug connection) and is deferred. This is the visible limit of
  the shipped fix.
- **No `Semaphore(1)` concurrency cap** and **no `use_reloader=False`.** The reloader is what makes
  a VERSION bump take effect (finding #15's territory) and stays on; the fix makes the reloader's
  own restart safe instead of removing it.

#### Changes made
`ffmpeg_utils.py` — new module imports (`atexit`, `signal`, `time`) and one live-child registry,
inserted between `run_ffmpeg` and `_STAGE_DIR_NAME`; nothing above `run_ffmpeg` changed.

| New in `ffmpeg_utils.py` | What it does |
|---|---|
| `run_tracked(cmd, timeout=600)` | `Popen`/`communicate` with the same `CompletedProcess` return and the same `TimeoutExpired` (kill-then-raise, output attached) as `subprocess.run`, but the child is in the registry while it runs. `cmd` includes the binary. |
| `_LIVE_CHILDREN` / `_LIVE_STAGES` (+ `_LIVE_LOCK`) | the set of running `Popen`s and the set of staging dirs created but not yet discarded |
| `kill_live_ffmpeg(grace=2.0)` | SIGTERM every live child, SIGKILL any still alive after `grace`, `wait()` each (reaps it); returns how many were killed |
| `_shutdown_children()` | `kill_live_ffmpeg()` then `discard_output` each still-live staging dir; the `atexit` callback |
| `_on_fatal_signal` | SIGTERM/SIGHUP handler: `_shutdown_children()`, restore default disposition, re-raise |
| `install_shutdown_handlers()` | registers the `atexit` callback and the two signal handlers; idempotent; called once from `__main__` |

`run_ffmpeg` is now a one-line wrapper: `return run_tracked([FFMPEG, "-nostdin", "-y"] + args,
timeout=timeout)` — so every render route (all seven single-pass writers and the two-pass
`multipass_export_render`, which call `run_ffmpeg`/`run_ffmpeg_staged`) is tracked with no per-route
change. `stage_output` adds its path to `_LIVE_STAGES`; `discard_output` removes it — so a render
that finishes normally leaves the shutdown handler nothing to do.

`app.py` — two edits: `/api/execute` now calls `fu.run_tracked(argv, timeout=600)` instead of a bare
`subprocess.run` (so the chat panel's own ffmpeg is tracked too, and it still gets no `-y`), and
`__main__` calls `fu.install_shutdown_handlers()` immediately before `app.run(...)`. No route logic,
no filter builder, no encoder args, no frontend file changed.

#### Reasoning
- **A registry, not `start_new_session` isolation.** The opposite reflex — put ffmpeg in its own
  session so a server crash *doesn't* take it down — is exactly wrong here: the whole defect is that
  the child already outlives the server. `run_ffmpeg`'s existing no-`start_new_session` behaviour is
  load-bearing (it's what lets Ctrl-C reach the encoder, per #7/#15) and is kept; the registry adds
  the ability to stop children on the exit paths a shared process group doesn't cover.
- **Why the exit paths need explicit handling at all.** Flask serves renders on **daemon** threads.
  At interpreter exit daemon threads are dropped *without unwinding*, so the `finally` in
  `run_ffmpeg_staged`/`multipass_export_render` that would `discard_output` never runs, and the local
  `Popen` handle vanishes with the thread. Only something reachable from the **main** thread at exit
  can find and kill the child — hence a module-level registry plus main-thread handlers.
- **`atexit` covers the reloader restart and Ctrl-C; signals cover the rest.** Werkzeug's reloader
  triggers a restart with `sys.exit(3)` from the main thread (confirmed in
  `werkzeug/_reloader.py:trigger_reload` on 3.1.8) — an ordinary interpreter exit, so `atexit` runs.
  Ctrl-C arrives as `KeyboardInterrupt`, which also unwinds to `atexit`. `kill`/window-close send
  SIGTERM/SIGHUP, whose default disposition is to die *without* running `atexit`, so those get
  explicit handlers that kill first, then restore the default and re-raise to preserve the exit
  status.
- **SIGINT deliberately left on Python's default.** Ctrl-C already works two ways over — the encoder
  is in the server's process group so the tty delivers SIGINT to it directly, and the resulting
  `KeyboardInterrupt` reaches `atexit` anyway. Installing a SIGINT handler would only wedge itself
  between werkzeug and its own shutdown.
- **`run_tracked` factored out rather than tracking inside `run_ffmpeg`.** `/api/execute` builds its
  whole argv (the chat model names the output and the command must *not* get `-y`, since #16/#6 rely
  on ffmpeg's refuse-to-overwrite exit), so it cannot go through `run_ffmpeg`. Factoring the tracked
  `Popen` into `run_tracked` lets both callers share the registry without `/api/execute` inheriting
  `-y`.
- **Shutdown kills, then discards staging.** Order matters: an ffmpeg still holding the staged file
  open would keep writing into a directory already removed. Discarding a staged render on shutdown
  can only throw away output that was about to be reported over a connection this process can no
  longer answer — the alternative is the file surviving unreferenced in `.partials`, which *is* the
  leak.
- **`_LIVE_STAGES` is a set of paths, deregistered in `discard_output`.** A normally-finished render
  removes its own entry, so the `atexit`/signal path only ever cleans up renders that were actually
  interrupted — it never races a live commit.

#### Observations
- **The disconnect half is unchanged and that is visible to users.** Test 2 (tab closed, server up)
  still runs the render to completion. This is the documented limit of the chosen scope, and it is
  stated in the 0.39.0 CHANGELOG entry so a user who expects "close the tab = stop the render" is not
  surprised.
- **Werkzeug installs its own SIGTERM handler inside `app.run()`** — `signal(SIGTERM, lambda *a:
  sys.exit(0))` — *after* `install_shutdown_handlers()` runs, so under the debug server the SIGTERM
  that actually fires is werkzeug's, not ours. That turned out to be harmless: `sys.exit()` from the
  main thread is an ordinary exit, so `atexit` still runs and still kills the child (measured — see
  Verification D). Ours is what covers SIGHUP (werkzeug does not touch it) and both signals when the
  app is ever run without the reloader. Left both installed rather than reasoning about which wins;
  they compose.
- **An out-of-scope find, recorded not fixed:** `output/old/` (a user archive folder outside the
  audit's concern) contains pre-existing `Seq_002_range.mp4.ffpass` / `.ffpass.cutree` files from
  some earlier interrupted two-pass run. This fix prevents *new* ones under the export dir; it does
  not sweep historical leftovers, and doing so would be reaching outside the change. Noted here only.
- **The entry's `ffmpeg_utils.py:937` line reference has drifted** (the file has grown through #9,
  #16, #17); `run_ffmpeg` is now at ~982. Not corrected in the entry's header — left as the audit
  wrote it — but flagged here.

#### Verification
All on the scratch instance unless noted; a pre-fix copy (`/tmp/g8old`, port 5096, the 0.38.0
`run_ffmpeg`/`stage_output`/`discard_output` restored and the two `app.py` edits reverted) served as
the A/B baseline.

- **A — orphan gone, no leak, on every interrupt path.** Re-running the three re-measurement cases on
  the fixed code: reloader restart mid single-pass → the exact ffmpeg pid that was running is **gone
  within ~2s**, `.partials` empty, no `.ffpass`, no output; the client gets a clean **500** (not
  `rc=52`) because the request thread's own error path now runs. Reloader restart mid **pass 1** of
  `under50mb_hevc` → same: process gone, staging tree empty including both `.ffpass*` files. The
  server log prints `stopped 1 running ffmpeg process on exit` on each (counted 10 times across the
  full test matrix).
- **B — signal matrix.** SIGTERM (single-pass and two-pass), SIGHUP (two-pass), and a group SIGINT
  (what Ctrl-C sends) each killed the encoder within ~2–6s and left the staging tree empty; the
  server came back up and served `/api/version` afterward in every case.
- **C — client disconnect still completes (the deferred half).** `curl -m 1` → `rc=28`, ffmpeg keeps
  running, `t2.mp4` commits normally, `.partials` empty. Unchanged from pre-fix, as intended.
- **D — successful renders are byte-identical.** A/B across **all six** quality modes on `/api/trim`
  plus `/api/reverse` (lossless + hevc) and `/api/hold_frame` (lossless + high): **9 of the 11
  IDENTICAL** by md5. The two that differ — `trim match` and `trim high` — differ **on the pre-fix
  server too, run-to-run**: `match` uses one-pass ABR (`-b:v` with no fixed seed) and produced three
  different md5s from three identical pre-fix runs, and the frame hashes (`-map 0:v:0 framemd5`) match
  the source content; the difference is x264's non-determinism, not the change. Confirmed the argv is
  byte-identical between old and new for those modes.
- **E — unit-level equivalence and registry behaviour** (`/tmp/g8unit.py`, importing both modules
  side by side): `run_tracked` returns a `CompletedProcess` with identical `.args`/`.returncode` and
  `str` streams on success; identical non-zero `.returncode` with stderr carried on failure; on
  timeout both raise `TimeoutExpired` with the same `.timeout` (new one additionally attaches text
  output) and **leave no surviving child** and an empty registry. Spawning three concurrent tracked
  encodes → `len(_LIVE_CHILDREN)==3`; `kill_live_ffmpeg()` returned 3, all three threads unblocked,
  registry emptied; a second call returned 0. `stage_output` adds to `_LIVE_STAGES` and
  `discard_output` removes it; the pre-fix copy's sets stay empty (proving the tracking is the new
  behaviour).
- **F — real installation, user's own settings.** On the live app (127.0.0.1:5001, quality
  `under50mb_hevc` as configured) a normal 3s trim of a real source rendered to a 23 MB hevc file and
  committed cleanly, no `.partials` left. `input/` 57, `output/` 26, `projects/` 8, and the stored
  quality setting all unchanged before and after; test file deleted.
- **G — build gate.** `python3 -m py_compile app.py ffmpeg_utils.py` clean; both modules import;
  `run_tracked`, `kill_live_ffmpeg`, `install_shutdown_handlers` all present and callable.

<a id="resolution-8b"></a>
### Resolution — 0.45.0 (2026-08-28), the deferred client-disconnect half

#### Re-measuring the finding first
The 0.39.0 resolution left one half open and named it: *"Test 2 above — tab closed, connection
dropped, server still up — is left exactly as it was … Detecting a dead peer mid-encode is a
different mechanism (a watcher thread polling the werkzeug connection) and is deferred."* Re-measured
on 0.44.0 before writing anything, on a scratch instance (port 5095, its own root under `/tmp/g8b`,
a 90.0s / 195 MB 1080p fixture). Still exactly as described: hang up mid-render and the encoder runs
to completion at ~800% CPU and commits a 293 MB file nobody is waiting for.

Two mechanism questions were settled by measurement *before* any product code was written, because
the fix is worthless if either answer is no:

- **Is the dead peer detectable at all?** `request.environ["werkzeug.socket"]` is present on
  werkzeug 3.1.8 (`WSGIRequestHandler.make_environ` puts it there). A probe server on 5096 reported
  `select` + `recv(1, MSG_PEEK)` returning `b""` the moment a client closed, `open` while it was
  still connected, and `data` when a keep-alive client had pipelined its next request.
- **Does the abort survive the real dev topology?** The browser talks to Vite, which proxies to
  Flask. Measured through an actual Vite proxy (a plain-object config, `/api` → 5096): aborting the
  fetch propagated to the Flask side as a closed socket, so the mechanism is not defeated by the
  proxy hop.

#### Changes made
`ffmpeg_utils.py` — a per-request cancel scope, and the kill loop shared with the 0.39.0 shutdown
path:

- New section `per-request cancellation (finding #8, the disconnect half)` at **1464–1540**, placed
  after `install_shutdown_handlers` and before `_STAGE_DIR_NAME`: `_CANCEL_SCOPE` (a
  `threading.local`), `_CANCELLED_MESSAGE`, `class RenderCancelled(RuntimeError)`, `class CancelScope`
  (`__slots__ = ("cancelled", "children")`), `begin_cancel_scope()` / `end_cancel_scope()` /
  `current_cancel_scope()`, and `cancel_scope(scope, grace=2.0)` which marks the scope and stops the
  children it owns.
- `_stop_procs(procs, grace)` (**1347**) extracted verbatim from `kill_live_ffmpeg`'s body — SIGTERM,
  grace, SIGKILL, `wait()` each — so shutdown and one request's cancellation kill children exactly
  the same way. `kill_live_ffmpeg` (**1374**) is now the same snapshot-under-lock plus
  `_stop_procs(...)`.
- `_register_child` / `_unregister_child` take an optional `job` and add/discard the child in the
  scope as well as the global registry, under the existing `_LIVE_LOCK`.
- `run_tracked` (**1259**) reads `current_cancel_scope()` once: it **refuses to spawn** if the scope
  is already cancelled, registers the child against the scope, and after the existing `finally`
  raises `RenderCancelled` instead of returning a `CompletedProcess` whose non-zero returncode is
  really a kill. Nothing else in the function changed — same `CompletedProcess`, same
  `TimeoutExpired`, same `FileNotFoundError` → `RuntimeError` path.

`app.py` — the watcher and one decorator:

- New section `cancel a render whose client has gone away` at **676–775**: `CLIENT_POLL_SECONDS = 1.0`,
  `_peer_gone(sock)` (**692**), `_watch_client(sock, scope, stop)` (**723**),
  `cancel_on_disconnect(fn)` (**738**), `_cancelled_response()` (**773**, a 499 with a JSON error).
  New imports: `functools`, `select`, `socket`, `threading`.
- `@cancel_on_disconnect` on exactly the eight routes that run an encode: `/api/trim` (**1106**),
  `/api/splice` (**1188**), `/api/render_timeline` (**1432**), `/api/render_a1` (**1953**),
  `/api/reformat` (**2206**), `/api/hold_frame` (**2284**), `/api/reverse` (**2368**),
  `/api/execute` (**2592**).

No route body, no filter graph, no `encode_args`, no frontend file was touched.

#### Reasoning
- **Why a watcher thread rather than a check inside the render loop.** There is no loop. The request
  thread is blocked in `Popen.communicate()` for the whole encode, so the only place a poll can live
  is a second thread. It polls once a second, which is the resolution the user experiences (~1s to
  stop) and costs one `select` on an idle socket per second per in-flight render.
- **Why the scope is an object, not a thread id.** Werkzeug hands the same thread to the next
  keep-alive request, and thread ids are recycled. A watcher that fired late and cancelled "whatever
  thread 12345 is doing" could kill a *different* render. The scope is a per-request object; a late
  watcher marks an object nobody reads any more. Verified: two renders down one keep-alive connection
  both return 200 (E5).
- **Why `RenderCancelled(RuntimeError)` rather than a new error contract.** Every one of these
  routes already maps `RuntimeError` to a JSON error, and every staging directory is already removed
  in a `finally` (`run_ffmpeg_staged`, `multipass_export_render`), never an `except`. Making
  cancellation a `RuntimeError` means it unwinds through paths that already exist and are already
  verified, instead of adding a second unwinding mechanism. The decorator catches it before the
  generic handler so the log records a cancellation rather than a failure.
- **Why 499.** The response is written to a socket that is usually gone, so its status code is for
  the log, not the user. 499 ("client closed request") keeps deliberate cancellations out of the
  count of 500s — which is the number anyone reads when asking "is the app broken?".
- **Why refuse to spawn when already cancelled.** In a two-pass mode, killing pass 1 leaves the
  request thread about to start pass 2. Without the pre-spawn check the app would launch a full
  second encode for a request nobody is waiting for — the defect, re-created one pass later.
  Measured: E3a leaves no passlogs and never reaches pass 2.
- **Why `/preview` is deliberately *not* cancelled.** A preview conversion writes into the preview
  cache, not the export folder: if it finishes after the user navigates away, the next open of that
  clip is instant instead of a second wait. Cancelling it would throw away work that is still
  wanted and re-create finding #13's churn. Measured (E6): an aborted `/preview` completes and lands
  in the cache (25.000000s, 17.5 MB). `/input` and `/output` static sends are excluded for the same
  reason in miniature — there is no child process to stop.
- **Why not a Cancel button.** Still a feature, still needs a job-id contract the frontend does not
  have. Unchanged from the 0.39.0 scope decision.
- **Why `_stop_procs` was extracted instead of duplicating the kill loop.** Two kill loops would
  drift; one of them would eventually stop reaping, or stop trying SIGTERM first. The extraction is
  the smallest change that leaves shutdown and cancellation provably identical — checked by running
  both the old and new `kill_live_ffmpeg` side by side (Verification U).

#### Observations
- **Cancelling `/api/execute` leaves a partial file, and that is not new.** That route writes
  straight to the export directory with no staging, so SIGTERM makes ffmpeg close what it has:
  measured `exec_target.mp4`, 28 MB, `duration=8.566667`, 257 frames — a valid, playable, truncated
  mp4 under the name the command asked for. This is the same leftover any *failed* chat command
  already leaves (finding #9 fixed staging for the render routes, not for `/api/execute`), so it is
  recorded, and stated in the 0.45.0 CHANGELOG, rather than fixed here.
- **A real gap in the 0.39.0 half, found while re-measuring it and left unfixed:** killing the
  **reloader monitor** process orphans the encoder. `run_with_reloader` installs
  `signal(SIGTERM, lambda *a: sys.exit(0))` in *both* processes, and the monitor is blocked in
  `subprocess.call` (werkzeug `_reloader.py:275`), whose `except:` clause does `p.kill()` — SIGKILL.
  So a SIGTERM to the monitor SIGKILLs the worker, no handler runs, and 0.39.0's cleanup is skipped.
  Measured identically on the pre-change and fixed copies: encoder orphaned and ran 11.9s to
  completion, `output/.partials/<pid>.<n>/sd_*.mp4` left behind. **This is reachable by the project's
  own documented restart procedure** — the run-app skill's `lsof -ti :5001 | xargs kill` signals both
  listeners. SIGTERM to the worker alone is clean (0.3s, staging empty), and Ctrl-C is clean because
  SIGINT reaches the whole group. Out of scope for this task; written here as a finding, not fixed.
- **The entry's header line references have drifted further.** `app.py:1901` was the `app.run(...)`
  call; it is now at **2694**. Left as the audit wrote it, flagged here (the 0.39.0 resolution noted
  the same for `ffmpeg_utils.py:937`).
- **The scope is thread-local, so cancellation is necessarily cross-thread.** Worth stating because
  it caught a first draft of the unit test: `run_tracked` called on a *different* thread from the one
  that began the scope sees no scope at all. That is the correct shape here — the request thread owns
  the scope, the watcher holds a reference to the object — but it means any future code that moves an
  encode onto a helper thread would silently lose cancellation.
- **The intermittent 500s seen in the scratch logs were the debug reloader, not the app.** Writing
  harness `.py` files into the server's own watched directory restarts it mid-render (`* Detected
  change in '/private/tmp/g8b/shutdown_ab.py', reloading` sits one line above a 500), and since
  0.39.0 a restart kills the in-flight encoder, so the client correctly sees a failure. Scratch-rig
  noise; recorded so the numbers below are not read as flakiness in the fix.

#### Verification
A/B throughout against `/tmp/g8old` (port 5097), built by `make_old.py`, which strips **exactly**
this change with assert-guarded replacements — including restoring the pre-refactor
`kill_live_ffmpeg` body — and hardlinks the same fixture. Hang-ups are performed by a raw-socket
client that closes only once the encoder's pid is confirmed in `ps`, so no result can be a race
between the hang-up and ffmpeg starting.

| case | pre-change (5097) | fixed (5095) |
|---|---|---|
| E1 single-pass, encoder confirmed at hang-up | ran 11.9s more, committed `e1_old.mp4` | gone 0.7s, no output, no partials |
| E2 abandoned render beside a live one | still running at +20s, later committed | gone 0.7s; the keeper 200 + committed; no ghost file |
| E3a two-pass, hang up in pass 1 | still encoding, `.ffpass` + `.ffpass.cutree` staged, later committed | gone 1.7s, no passlogs, no output, pass 2 never starts |
| E3b two-pass, hang up in pass 2 (argv-confirmed `pass=2`) | ran 13.2s more, committed | gone 2.3s, no output |
| E4 uninterrupted render | 200, 3.1s, md5 `958cc2b1c234859e8c5d73cb1550d4fe` | 200, 3.2s, **same md5** |
| E5 two renders down one keep-alive connection | both 200 | both 200 |

- **E6 — `/preview` is excluded, as intended.** An aborted preview conversion completes and lands in
  the cache: 25.000000s, 17.5 MB.
- **E7 — `/api/execute` is cancelled** (499, `stopped 1 running ffmpeg process`) and leaves the
  partial described in Observations.
- **M — byte-identity across quality modes.** Same trim on both servers, md5 compared:
  `lossless acdddc7c05fa9e5a5ab4f5a1108ad201`, `high 52596ad09788ad74f6ad94bcea940bc5`,
  `under50mb_hevc fd471da8c00f494847c77123d249079a` — **IDENTICAL** old vs new in all three,
  including the two-pass mode.
- **U — unit level, 32 checks, all pass** (`/tmp/g8b/unit_scope.py`, importing both modules side by
  side; `sleep` stands in for an encode). No scope before a request; `current_cancel_scope()` returns
  the scope begun; a fresh scope is neither cancelled nor holding children; the scope is gone after
  `end_cancel_scope()` and **a cancelled scope does not bleed into the next request on the same
  thread**; scopes are per-thread; `cancel_scope` returns the number stopped, marks the scope, kills
  its own child, **leaves another scope's child untouched**, and is a no-op the second time;
  `run_tracked` inside a cancelled scope raises `RenderCancelled` and **spawns nothing** (sleeper
  count unchanged); `RenderCancelled` is a `RuntimeError`; a mid-flight cancellation from another
  thread raises `RenderCancelled`, the child is dead and out of the live registry. Old vs new
  `kill_live_ffmpeg`: both return 0 with nothing running, both stop and **reap** all three sleepers
  and return 3, both safe called twice.
- **S — the 0.39.0 shutdown half still works, and identically.** SIGTERM to the worker mid-render:
  pre-change `encoder gone, staged clean` at t+0.3s; fixed `encoder gone, staged clean` at t+0.3s.
  The parent-kill gap is in Observations and is the same on both copies (11.9s, staged file left).
- **T — no watcher-thread leak.** Server thread count (`ps -M -p`) across 3 completed and 3 cancelled
  renders: `2 → 2 → 2 → 2` (measured 8s after the last cancellation, i.e. 8 poll intervals). The
  three cancellations are in the log as `499` + `client disconnected mid-request — stopped 1 running
  ffmpeg process`.
- **R — real installation, the user's own settings** (127.0.0.1:5001, quality `under50mb`, default
  export dir). An ordinary trim: `200` in 10.0s. The same trim abandoned once its encoder was
  confirmed: encoder **gone after 1.1s**, nothing committed, `.partials` clean. Output directory
  listing identical before and after; the one test file removed.
- **B — build gate.** `python3 -m py_compile app.py ffmpeg_utils.py` clean, both modules import. The
  frontend was rebuilt so the bundle carries the new version (`npx vite build` → `✓ built in 138ms`,
  72 modules, `index-BrAdK1k4.js` 448.85 kB) and `npm run lint` (oxlint) exits 0 with the same 7
  pre-existing warnings as before — no frontend file was touched by this change.

---

## 9. MEDIUM — Failed renders leave corrupt partials in the Export Bin

**Status:** FIXED in 0.34.0 — see [Resolution](#resolution-9)
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

<a id="resolution-9"></a>
### Resolution — 0.34.0 (2026-08-26)

#### Changes made
Four new helpers in `ffmpeg_utils.py` (inserted immediately before `unique_output_name`; nothing
existing in that file was edited), and eight call-site conversions in `app.py`. No filter builder, no
encoder argument, no validation, and no frontend file changed.

`ffmpeg_utils.py` — `_STAGE_DIR_NAME = ".partials"` plus:

| Helper | What it does |
|---|---|
| `stage_output(out_path)` | returns `<dest>/.partials/<pid>.<tid>/<final basename>`, creating the dir |
| `commit_output(staged, out_path)` | `os.replace` into the export dir, never clobbering; returns the name actually used |
| `discard_output(staged)` | `rmtree`s that staging dir, then `rmdir`s `.partials` if empty |
| `run_ffmpeg_staged(args, out_path, timeout=600)` | the whole dance for single-pass writers; returns `(result, final_name)`, `final_name is None` on failure |

`app.py` — the seven single-pass writers each went from `args.append(out_path)` + `fu.run_ffmpeg(...)`
to one `fu.run_ffmpeg_staged(args, out_path)` call: `trim` (:779), `splice` (:851),
`render_timeline` (:1460, its `timeout=1800` preserved), `render_a1` (:1637), `reformat` (:1735),
`hold_frame` (:1800), `reverse` (:1853). `multipass_export_render` (:473) — the shared helper behind
all six size-capped/custom export routes — now stages around its two-pass calls and returns the
committed name. Every route that reports a filename now reports the committed one rather than the
name it asked for; verified that no route reads `out_path` after its write.

#### Reasoning
- **A subdirectory, not a `.part` suffix — this is the crux.** ffmpeg picks its muxer from the output
  extension, so the temp path has to end in the *real* extension. `out_path + ".part.mp4"` (the shape
  #3 uses, where the cache dir is never enumerated) is wrong here: I listed
  `.cand.mp4.4321.part.mp4` through `/api/outputs` and it **appeared in the Export Bin**, where
  `OutputPanel.jsx:105` auto-selects the newest file by mtime and mounts a `<video>` on it — the fix
  would have shipped the very symptom it removes. Keeping the exact final basename one directory down
  needs no `-f` and is invisible to `_list_dir`, which filters on media extensions and skips
  directories.
- **`-f` was investigated and rejected on measurement.** Forcing the format would have allowed a flat
  temp name, but `-f mp4` on a `.m4v` output rewrites the ftyp major brand from `M4V ` to `isom`, and
  `-f m4v` is the *raw* MPEG-4 video muxer, which refuses H.264 ("m4v muxer supports only codec
  mpeg4") and wrote 0 bytes. Staging preserves `M4V ` because the staged name still ends `.m4v`
  (confirmed in verification section E).
- **Same volume by construction.** `.partials` lives inside the destination directory, so
  `os.replace` is always an intra-filesystem rename — atomic — no matter where `get_output_dir()`
  points (#4's territory: it can be any volume).
- **`commit_output` never clobbers.** Two renders asking for one name produce two files today; a bare
  `os.replace` would have silently destroyed the first result. Measured before changing anything: a
  second `dup.mp4` render starting 5s into the first yields `dup.mp4` + `dup_1.mp4`. The `_1` walk at
  commit time preserves exactly that.
- **pid + thread id in the staging dir**, for the same reason as #3: `app.run` defaults
  `threaded=True`, so concurrent renders are real and must not share a staging path.
- **`discard_output` in a `finally`, not an `except`.** Most exit paths here are not exceptions — an
  ffmpeg failure `return`s a 500, and a subprocess timeout raises `TimeoutExpired`, which is not an
  `OSError`. On success the file has already been moved out, so the `rmtree` just removes an empty dir.
- **`/api/execute` was deliberately left alone.** Its output path is model-chosen and can be a
  pattern (`frame_%04d.png`), which staging would have to reason about; it is #16's scope, not this
  finding's.

#### Observations
- **The audit entry's passlog claim was misdiagnosed.** It says the two-pass stats files are "not
  cleaned on the failure path, only on success." They are not: both cleanup loops
  (`ffmpeg_utils.py:757` and `:907`) have been inside a `finally` since the first commit that
  introduced them. The real gap was narrower — `_PASSLOG_SUFFIXES` (:643) lists `-0.log`,
  `-0.log.mbtree`, `.log`, `.log.mbtree` but **not** libx264's `.temp` variants (`-0.log.temp`,
  `-0.log.mbtree.temp`), which is exactly what an interrupted pass 1 leaves behind. Staging fixes
  that incidentally and completely: the stats prefix derives from the output path, so every stats
  file — listed suffix or not — is now born inside the staging dir and dies with it. Verified: after a
  two-pass render killed mid-pass, `0` passlog files of any name in the export dir.
  `_PASSLOG_SUFFIXES` itself was left untouched, since editing it would now be dead code for the
  export dir and is outside this finding.
- **A second orphan the entry never mentioned:** when a size-capped render *succeeds* but overshoots
  its cap, the route reports the overshoot — and the complete-but-rejected file used to stay in the
  export dir under the requested name. It now lives in the staging dir and is discarded with it.
  Recorded rather than claimed as the fix's purpose; it fell out of the same change.
- **`.webm` output returns 500, and it is pre-existing — not caused by this change.** Section E's one
  red result. `fu.encode_args` yields libx264/AAC, which the webm muxer will not accept ("Nothing was
  written into output file, because at least one of its streams received no packets"). Confirmed by
  standing up a **pre-fix instance** (`/tmp/g9pre`, port 5097, `app.py`/`ffmpeg_utils.py` from `HEAD`,
  which contains neither helper): identical 500, identical stderr — and pre-fix it additionally left a
  **264-byte `pre.webm`** in the export dir, i.e. #9 itself. Post-fix the directory is empty. `.webm`
  is in `ALLOWED_EXTENSIONS` but cannot actually be rendered; logged as its own defect, not fixed
  here, because fixing it means choosing VP9/Opus encoder arguments — new behavior, outside this task.
- **A `kill -9` of the Flask process still leaves one staged file.** No `finally` survives SIGKILL.
  Measured. It is inert in the way that matters: `/api/outputs` does not list it (verified after a
  restart), it holds no name, and re-rendering the same name succeeds. Same class as #3's stray and
  #13's missing eviction; the CHANGELOG states plainly that deleting `.partials` clears it.
- **Simultaneous same-name renders got strictly better.** Before, two renders launched at the same
  instant both wrote `sim.mp4` and produced one interleaved file; now each stages privately and
  commits to `sim.mp4` and `sim_1.mp4`, both valid. Not the goal, but a real improvement worth
  recording.

#### Verification
Scratch instance only (port 5096, `/tmp/g9`, with `input/src.mp4` 12s 1080p, `input/big.mp4` 25s 4K
303 MB ≈16s to render, plus small `tiny.mp4`/`mute.mp4` fixtures). `/tmp/g9rep.sh` was written
**before** the fix and re-run **unchanged** afterwards. The real `input/`, `output/`, and `projects/`
were never used as test targets.

| Case | Before | After |
|---|---|---|
| ffmpeg killed 5s into a 16s render | `500` + **53,739,568 B BROKEN `mid.mp4`**, listed by `/api/outputs` | `500`, export dir **empty**, `/api/outputs` `[]` |
| retry of that same name | pushed to `mid_1.mp4` | clean `mid.mp4`, valid |
| ffmpeg killed the instant it starts | `500` + **48 B BROKEN file**, listed | `500`, nothing left |
| Export Bin *during* a render | shows a 90 MB BROKEN file as a real export | shows `[]`; the finished file appears when done |
| uninterrupted renders (both sources) | valid | valid |
| stray temp/passlog files, tracebacks | 0 / 0 | 0 / 0 |

Then I attacked the fix instead of stopping at the repro (`/tmp/g9adv*.sh`, sections A–I):

- **A** — after a normal render the export dir holds the file and nothing else; `.partials` is gone.
- **B** — `kill -9` of the server mid-render: 1 staged file, **not** listed by `/api/outputs` after
  restart, and the same output name renders fine afterwards.
- **C** — staggered same-name renders: still `dup.mp4` + `dup_1.mp4`, both valid, each response
  naming its own file. Pre-fix behavior preserved.
- **D** — simultaneous same-name renders: `sim.mp4` + `sim_1.mp4`, both valid (was: one shared file).
- **E** — every allowed container through `/api/render_timeline`: mp4 `isom`, mov `qt`, mkv, avi
  `AVI`, m4v **`M4V `** all `200` and valid — the brand check that justifies the design. `.webm` 500,
  pre-existing (above).
- **F** — two-pass paths: `under50mb_h264` and `custom` both `200`/valid; **0** passlog files of any
  name in the export dir; a render killed mid-two-pass leaves an **empty** export dir, `[]` from
  `/api/outputs`, and **0** staged leftovers.
- **G** — the A1 `.wav` stem: `200`, valid, 882,154 B; a second stem of the same name correctly
  becomes `stem_1.wav`, with the response naming the committed file.
- **H** — the other five writer routes (`trim`, `splice`, `hold_frame`, `reverse`, `reformat`): all
  `200`, all valid, no hidden leftovers.
- **I** — export directory relocated to `/tmp/g9alt`: render valid there, `.partials` created and
  cleaned inside it, and a mid-render `kill -9` there leaves only the earlier good file.
- Byte identity: `cmp` of a staged render against the same render written in place is **identical**
  for mp4, mov, avi and m4v. (matroska/webm are excluded because their output is inherently
  non-deterministic — SegmentUID/DateUTC differ between two runs of the same command.)
- **Real installation** (5001, restarted onto the new code; `/api/version` → `0.34.0`, Vite 5173
  `200`): one 1.5s render of the user's own media under **their own** `under50mb_hevc` setting, which
  is untouched and happens to exercise the most-changed path (`multipass_export_render`) —
  `200`, `audit9_smoke.mp4`, 27,015,148 B, playable, correctly listed by `/api/outputs`, `.partials`
  gone, 0 passlog files. The test render was deleted afterwards; `input/` 54, `output/` 15,
  `projects/` 8 — all back to baseline.
- 0 tracebacks across every run.

No frontend file was touched, so no rebuild was required beyond the version bundle.

---

## 10. MEDIUM — Frontend races and wedges

**Status:** FIXED in 0.41.0 — see [Resolution](#resolution-10).
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

<a id="resolution-10"></a>
### Resolution — 0.41.0 (2026-08-27)

#### Re-measuring the finding first

All four items are frontend behaviour, so they were re-measured in a real browser rather than by
reading. Scratch instance `/tmp/g10` with its own `PROJECT_ROOT` (Flask on 5096, Vite on 5174, five
generated fixtures in its `input/`), driven from node over the Chrome DevTools Protocol — no new
dependency, because node v26.5.0 has a global `WebSocket` and Chrome takes
`--remote-debugging-port`. Three CDP domains do the work: `Fetch.requestPaused` to hold one specific
`/api/probe` response for 1500 ms (`continueRequest`) or fail one specific `/api/upload`
(`failRequest`), `Page.javascriptDialogOpening` to capture *and answer* alerts and confirms (an
unanswered dialog blocks the page), and a synthetic `DragEvent` carrying a `DataTransfer` built from
real media bytes to exercise the lane drop handlers. Every "before" number below was produced by the
same script that produced the "after" number.

**All four items reproduce.**

| Item | Measured on 0.40.0 |
|---|---|
| Media Bin probe race | Clicked `alpha.mp4` with its probe held 1.5 s, then `bravo.mp4` 120 ms later. Highlighted row `bravo.mp4`, but **File name `alpha.mp4`, Resolution `320×240`, Duration `2.000s`**, and the bin `<video>` pointed at `/input/alpha.mp4`. Every part of the panel described alpha under bravo's highlight |
| Multi-file drop | Three files dropped on V1 with upload #2 failed → **2 clips** (`delta`, `one`); the third was never attempted. One alert: `cannot reach the backend — is the server on 127.0.0.1:5001 running?` |
| Playback wedge | Two clips (alpha 2 s + bravo 3 s) with bravo's media failed → transport still reported `playing=true` with the position frozen at `00:00:02:00` for the rest of the run; zero dialogs, and the Actions log held only `● Unrendered edits — click V1 Render to apply` |
| Open discards work | Saved a 1-clip project, added two more clips without saving, reopened it → **1 clip, `dialogs during open: []`, Undo unavailable.** Two clips and the whole undo stack gone with nothing asked |

**Three of the entry's specifics need correcting:**

1. **"remaining files vanish silently" is no longer accurate.** #6's global `unhandledrejection`
   floor (0.29.1) does put up an alert. What is missing is *which* files it cost: the message names
   the transport failure, not the file that failed, and says nothing about the files after it never
   being attempted. So the loss is unreported rather than unsignalled — a smaller defect than the
   entry claims, and the fix is aimed at the reporting.
2. **The entry lists one bin; there are two.** `OutputPanel.jsx`'s `loadOutput` has the identical
   unsequenced probe, and its copy is worse: `setSelectedName` is *inside* the `.then`, so the stale
   reply drags the highlighted row back with it. Measured: with `ex_alpha`'s probe held and
   `ex_bravo` clicked, **`ex_alpha` won the row as well as the panel and the player**. Fixing both
   bins was agreed with the user as extra scope for this entry, and is recorded here for that reason.
3. **The four pointers are all a few lines low** but land on the right functions. Post-fix they are
   `MediaLibrary.jsx:93` (`selectFile`), `Timeline.jsx:134`/`:208` (`handleV1Files`/`handleA1Files`),
   `useTimelinePlayback.js:318` (`startNativeAt`'s load wait) and `App.jsx:1491`
   (`handleLibraryOpen`).

The entry's own root-cause line — *"there is no `AbortController` anywhere in `frontend/src`"* — is
still true after this fix, deliberately. See the reasoning below.

#### Changes made

Five files, one new module.

| File | Change |
|---|---|
| `MediaLibrary.jsx` | New `probeSeqRef`; `selectFile` takes a ticket (`const seq = ++probeSeqRef.current`) and the reply returns early unless it still holds the newest one |
| `OutputPanel.jsx` | The same guard in `loadOutput`, which also protects the `setSelectedName` that lives inside its reply |
| `Timeline.jsx` | New shared `addFilesInOrder(files, add, lane)`; `handleV1Files` and `handleA1Files` both call it. New `onSourceError` prop, passed through to `useTimelinePlayback` |
| `useTimelinePlayback.js` | New `whenLoaded(v, gen, clip, onReady)` helper pairing an `error` listener with the existing `loadeddata` wait; used by both `startNativeAt` and `freezeStart`. On error it clears `loadedUrlRef`, calls `stop()`, then reports |
| `projectWork.js` (**new**) | `workFingerprint({clips, track2Clips, audioBeds, noiseEnabled, noiseGainDb})` → one comparable string |
| `App.jsx` | `handlePlaybackSourceError` writes the warn line into the Actions log; `savedWorkRef` + `currentWorkFingerprint()`; a confirm in `handleLibraryOpen`; re-baselining on save, save-as, open and clear; `noiseGainNumber()` extracted so `buildProject` and the fingerprint parse the gain identically |

`addFilesInOrder` keeps the original sequential `for` loop and collects failures instead of throwing
out of it:

```js
for (const file of list) {
  try { await add(file) } catch (err) { failed.push(`${file.name} — ${err?.message || err}`) }
}
if (failed.length) alert(`${failed.length} of ${list.length} files could not be added to ${lane}: …`)
```

`handleLibraryOpen` asks only when there is something to lose:

> There are unsaved changes on the timeline. Opening "NAME" replaces all three lanes and clears the
> undo history, so those changes cannot be recovered.
>
> Cancel to go back and save first, or OK to open anyway.

`handleImportProject` funnels through `handleLibraryOpen`, so importing a `.nara` from disk is
covered by the same prompt without a second copy of it.

#### Reasoning

**Why a sequence token and not the `AbortController` the entry asks for.** `api.js`'s `apiFetch`
takes no `AbortSignal`, and it converts *any* fetch rejection into
`ApiError('cannot reach the backend — is the server on 127.0.0.1:5001 running?', 0)`. `main.jsx`'s
global `unhandledrejection` handler (from #6) alerts on any `ApiError`. So an abort would arrive at
the user as **"cannot reach the backend"** on every superseded click — a real regression traded for
a saved HTTP response. Threading a signal through `apiFetch` and teaching it to distinguish
`AbortError` from a dead server is a change to the shared transport used by every call in the app,
which is more than this finding needs. The entry offers the sequence guard as its own alternative;
it is four lines per site, has no effect on any other caller, and its failure mode is a wasted
response rather than a false alarm. The in-flight probe is not cancelled, and that is recorded as
the cost.

**Why the drop loop stayed sequential rather than becoming `Promise.allSettled`.** The entry
suggests `allSettled`, which also parallelises. Order is load-bearing here: each `add` appends to the
lane, so concurrent uploads would land clips in completion order rather than the order the files were
dropped in — the existing comments in both handlers say the sequential await is what keeps drop
order. `allSettled`'s actual contribution is *collecting* failures instead of stopping at the first
one, and that is what was taken. Swallowing each error in the loop is also what keeps #6's global
handler quiet, so the one report the user sees is the one that names the files.

**Why playback reports into the Actions log and not an alert** — the user's decision when asked:
stop cleanly at that clip and name the file, no alert and no modal. A dialog during playback would
also have to be dismissed before the page could do anything else, and the failure is diagnostic
rather than a decision the user has to make. `stop()` runs before the report, so the transport is
already consistent when the line appears.

**Why `loadedUrlRef.current = null` on the error path.** The element caches which URL it was pointed
at so a contiguous clip does not reload. Left set after a failed load, a later Play would treat the
element as already holding that file and never re-attempt it — a file restored between attempts would
still never play. Clearing it makes the next Play a fresh load.

**What counts as "unsaved work", and why.** The fingerprint covers the three lanes plus room tone's
switch and level — everything a `.nara` stores, so anything that would come back from a save is in
it. Three deliberate exclusions: `dirty` is normalized out (it means "not yet rendered", so a Render
would otherwise read as unsaved work the user never did), the selection is not work (clicking a clip
loses nothing, and prompting over it teaches users to dismiss the prompt), and export presets are not
work (opening a project *merges* them rather than replacing them, so they survive). Keys are sorted
before stringifying so a project read back off disk compares equal to the same project held in
state.

**Why a plain `window.confirm` and not a three-way "Save / Discard / Cancel" dialog.** The app has no
modal component of its own and uses `window.confirm` for exactly this class of question already (#5's
project-overwrite prompt). A Save-and-then-open button is a feature, not a fix. Cancel leaves the user
in front of a Save button they can press themselves, which the message says.

#### Observations (out of scope — recorded, not fixed)

1. **Playback has a pre-existing end-of-file stall at 24 fps, unrelated to this fix.** A control run
   of *ordinary* playback across a boundary (no failed source) wedges too. Diagnosed rather than
   assumed: an identical run against a temporarily reverted, pre-fix copy of the hook produced
   byte-identical behaviour, so it is not a regression. Mechanism, measured with a
   `requestVideoFrameCallback` counter: alpha is 2.000 s @ 24 fps so its last frame presents at
   **1.9583 s**, `EPS_SRC = 0.04` requires a frame at ≥ 1.96 s before handing off, and the engine
   schedules one more callback that never fires because the media has `ended` (`ended=1 frames=47
   lastFramePresentedAt=1.9583s`, element `paused=true`, engine still `playing=true`). Intermittent —
   one run of three got past that boundary by a timing accident and stalled at the end of the next
   clip instead. **Added to #14**; fixing it means changing the segment hand-off, which is not this
   finding.
2. **`OutputPanel`'s `handleDelete`/`handleClear` do not invalidate an in-flight probe.** They clear
   `selectedName` and `info`, but a reply already on the wire can land afterwards and repopulate the
   panel for a file that no longer exists. The new sequence ref is the obvious place to bump, but
   doing it is a behaviour change in delete, not part of the click race. **Added to #14** (TRACED).
3. **`freezeStart`'s error branch is not verified by measurement.** Three attempts failed to reach
   it, each for a documented reason: the source was already loaded (`reloaded=false`, so no wait
   happens at all); head holds always attach to the sequence's outer edges by design
   (`HoldFrameForm`'s own comment), so the hold sat on clip 1 whose file was fine and the *native*
   path fired instead; and the loop-around attempt hit observation 1's stall first, with `alpha
   fetches: []` showing the media was being served from the browser cache where interception cannot
   fail it. Its happy path is verified (a head hold plays and stops correctly, with and without a
   later broken clip), and the error branch is the same four lines of shared helper that the native
   path exercises. Recorded as unverified rather than claimed.
4. **The Actions log only exists in the DOM while the Actions tab is open** — the centre dock swaps
   its children. So the warn line is retained but invisible to a user sitting on another tab, who
   sees playback stop with no on-screen reason until they switch. That is the cost of the
   no-alert choice, accepted knowingly.
5. **`api.js` still cannot be cancelled.** Every superseded request runs to completion and is
   discarded on arrival. Harmless for a probe; it would matter for anything expensive, and it is the
   reason the entry's `AbortController` line stays true.

#### Verification

`npx vite build` from `frontend/` → clean, `✓ 72 modules transformed`, `✓ built in 121ms`. `npm run
lint` → exit 0, 7 warnings, **all pre-existing** and none in any of the five touched files
(`Timeline.jsx:481` was already warned about before this change). `projectWork.js` under node →
`ALL 19 ASSERTIONS PASS` (key-order independence, `dirty` ignored on all three lanes, lane and order
sensitivity, a new clip field showing up without the module knowing it exists, `'-20'` vs `-20`,
`null` vs `0`).

**Item 1 — Media Bin, same script before and after:**

| | highlighted row | File name | Resolution | Duration | bin `<video>` |
|---|---|---|---|---|---|
| before | `bravo.mp4` | **`alpha.mp4`** | **320×240** | **2.000s** | **`/input/alpha.mp4`** |
| after | `bravo.mp4` | `bravo.mp4` | 640×360 | 3.000s | `/input/bravo.mp4` |

**Item 1b — Export Bin, same script before and after** (`ex_alpha` held 1.5 s, `ex_bravo` clicked
120 ms later):

| | highlighted row | File name | Resolution | Duration | out `<video>` |
|---|---|---|---|---|---|
| before | **`ex_alpha.mp4`** | **`ex_alpha.mp4`** | **320×240** | **2.000s** | **`ex_alpha.mp4`** |
| after | `ex_bravo.mp4` | `ex_bravo.mp4` | 640×360 | 3.000s | `ex_bravo.mp4` |

**Item 2 — three files dropped on V1, upload #2 failed:**

```
before   clips on V1 ........ 2  (["delta.mp4","one.mp4"])
         dialogs shown ...... [{"alert":"cannot reach the backend — is the server on 127.0.0.1:5001 running?"}]
after    clips on V1 ........ 3  (["delta.mp4","one_1787889801.mp4","three.mp4"])
         dialogs shown ...... [{"alert":"1 of 3 files could not be added to V1:\n\n• two.mp4 — cannot reach the backend — is the server on 127.0.0.1:5001 running?"}]
```

The third file now lands, and the one report names the file that did not. Control — a clean two-file
drop: `BOTH FILES ADDED, IN ORDER, NOTHING SAID` (zero dialogs).

**Item 3 — two clips, bravo's media failed to load:**

```
before   t=1.4s playing=true  pos=00:00:01:09
         t=2.1s playing=true  pos=00:00:02:00   … and unchanged to t=5.6s
         dialogs [] ; Actions log ["● Unrendered edits — click V1 Render to apply"]
         VERDICT: WEDGED — still "playing", position frozen at 00:00:02:00, nothing reported

after    t=1.4s playing=true  pos=00:00:01:09
         t=2.1s playing=false pos=00:00:02:00   … and unchanged to t=5.6s
         dialogs [] ; Actions log ["⚠ playback stopped at \"bravo.mp4\" — its source file could not
                                    be loaded (moved, renamed or deleted?)", "● Unrendered edits …"]
```

The "before" row is the *reverted* hook in the same scratch instance under the same script, so the
only difference is the fix. A head hold whose later clip fails behaves the same way
(`00:00:03:00(stopped)` plus the identical warn line), and a head hold on intact media plays through
and stops with an empty log.

**Item 4 — open with unsaved work, and the two cases that must not regress:**

```
4   3 clips unsaved → opened g10-keeper → confirm shown naming the project, OK → 1 clip
4b  3 clips unsaved → opened g10-keeper2 → confirm shown, Cancel → 3 clips
    (["alpha.mp4","bravo.mp4","charlie.mp4"])                  VERDICT: WORK PRESERVED
4c  opened a just-saved project, then opened it again, nothing edited between
    dialogs [] and [] → 1 clip                                 VERDICT: NO SPURIOUS PROMPTS
```

4c is the one that justifies the fingerprint rather than a boolean flag: the save baseline is taken
from the payload that was written, and re-opening rebuilds it from the normalized values that were
loaded, so neither a save nor an open leaves the app believing there is work to lose.

**Version judgement.** Shipped as **minor** (0.41.0). Opening a project now interrupts with a
question, which under a strict reading of *"major = anything that changes existing behaviour"* argues
for a major bump. Judged minor because the prompt appears **only** where the alternative is
irrecoverable loss (measured: zero prompts with nothing to lose), nothing that previously succeeded
now fails — the same open completes after one confirmation — and the other three changes replace a
wrong answer, a missing answer and a hang with correct ones. Same reasoning as #11's judgement, and
recorded because it is a call rather than an obvious reading.

---

## 11. MEDIUM — Malformed payloads produce HTML 500s instead of 400s

**Status:** FIXED in 0.40.0 — see [Resolution](#resolution-11).
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

<a id="resolution-11"></a>
### Resolution — 0.40.0 (2026-08-27)

#### Re-measuring the finding first
Re-ran the entry on 0.39.0 before touching anything, using two scratch instances with their own
`PROJECT_ROOT`s so a fixed build and the old build could be driven by the same script: `/tmp/g11old`
(port 5098, pre-fix) and `/tmp/g11` (port 5097). `input/` in each held `small.mp4` and a fixture with
no container duration, built with `ffmpeg -v error -i small.mp4 -c copy -f matroska pipe:1 >
nodur.mkv` — the pipe muxer cannot seek back to write the duration, so `format.duration` is simply
absent. The harness (`/tmp/g11ab.py`) sends 59 malformed payloads and 24 valid controls, md5s every
render, and deletes it so output names stay deterministic.

**The core claim holds and is worse than the entry says.** Of the 59 malformed payloads on 0.39.0,
**42 returned 500**. The distribution:

| Status on 0.39.0 | Count | Example |
|---|---|---|
| 500 | 42 | `trim {}` → `internal server error`; `hold_frame duration=NaN` → same |
| 400 but with a Python message, not a field | 10 | `A1 clip 1: string indices must be integers`; `render_a1 outSec=NaN` → `cannot convert float NaN to integer`; `reformat` with no input → `invalid filename: None` |
| 404 for a type error | 2 | `splice inputs="small.mp4"` → `input file not found: .../input/s` — the string was indexed character-wise, so the first "filename" was `s` |
| **200 — malformed input accepted** | 5 | `headHoldSec=-3` and `headHoldSec=NaN` both rendered; `hold_frame time=true` held frame 1s; `browse_directory initial=42` opened the picker |

Four of the 500s (`trim end=banana`, `trim end=NaN`, `trim start 5 > end 1`, `hold_frame time=NaN`)
reported `ffmpeg failed` — i.e. the request was bad enough to be unanswerable but still **started a
real encode** before failing.

**Two of the entry's specifics need correcting:**

1. **"HTML 500s" is out of date.** #6's catch-all `@app.errorhandler(Exception)` (0.29.1) made every
   one of these a JSON 500 (`{"error": "internal server error", "detail": "TypeError: ..."}`). The
   status code and the missing field name are the real defect; the content type was already fixed.
   Recorded in the status table rather than by rewording the original entry.
2. **A duration-less file is not "completely unrenderable."** Measured on 0.39.0: `trim` **200**
   and `reverse` **200** on `nodur.mkv`. Only the routes that do arithmetic with the duration fail.
   This is why the fix does not raise from `get_video_info` — see below.

The NaN mechanism, confirmed at the interpreter: `float("nan")` succeeds, and `nan < 0`,
`nan > duration` are both `False`, so a NaN passes every range check in the file and reaches ffmpeg
as the literal `nan`. Separately, `isinstance(True, int)` is `True`, so a JSON `true` passes any
numeric check as `1`.

#### Changes made

`app.py` — `import math`, and four helpers in a new `# ---------- request fields ----------`
section placed immediately after `_handle_unexpected` and before `# ---------- version ----------`.
Each judges **one value** and raises `ValueError`:

| Helper | Rejects |
|---|---|
| `_str_field(value, field, required=True, default="")` | `None` when required, anything not a `str` |
| `_num_field(value, field, required=True, default=None, lo=None, hi=None)` | non-numbers, **`bool`**, NaN/inf, out-of-range |
| `_obj_field(value, field, required=True)` | anything not a `dict` |
| `_list_field(value, field, required=True)` | anything not a `list` |

Then, per route, the fields that were previously indexed or `float()`-ed raw:

| Route | Fields now judged |
|---|---|
| `trim` | `input`, `output`; **plus** `start`/`end` parsed, checked finite, `start >= 0`, `end > start` on *every* path |
| `splice` | `inputs` (list), each `inputs[i]` (string), `output` |
| `render_timeline` | each `clips[i]` (object), `clip i: input`, `inSec`/`outSec` finite, `headHoldSec`/`tailHoldSec`/`roundHoldSec` (finite, `>= 0`), `clip i overlay` + its `input`, each `audioBeds[n]` + its `input`, `output` |
| `render_a1` | the same clip, hold, bed and `output` checks (the two routes share the loop shape; the same edit was applied to both) |
| `hold_frame` | `input`, `output`, `time`, `duration` — one message per field |
| `reverse`, `reformat` | `input`, `output` |
| `projects` (`_project_filename`) | a non-string `name` → `PathError` → 400 |
| `rename_file`, `reveal_file` | `name`, `newName`, `dir` |
| `set_export_settings` | `output_dir` |
| `chat` | `message`, `session_id` |

`ffmpeg_utils.py` — three edits:

| Change | Why |
|---|---|
| `safe_path`: `if not isinstance(name, str) or not name or os.path.isabs(name)` | `os.path.isabs`/`join` raise `TypeError` on a non-string. Every caller already turns `PathError` into a 400, so this is the floor under the routes that don't name the field themselves. |
| `get_video_info`: `float(fmt["duration"])` in `try/except (KeyError, ValueError, TypeError)`, and a new `duration_known` key in the returned dict | separates "0 seconds" from "no duration recorded" |
| `validate_ffmpeg_command`: `if not isinstance(cmd, str): return False, "command must be a string", None` | `shlex.split` needs a string; a list raised `AttributeError` from inside the route |

`render_timeline`, `render_a1` and `hold_frame` now gate on `info["duration_known"]` and return a 400
that names the cause: *"clip 0: cannot read the duration of nodur.mkv — its container reports none,
so no trim window can be checked against it."*

#### Reasoning

**Why four value-first helpers rather than one schema per route.** The codebase already has this
exact idiom in two places — `_a1_noise_gain_db` and `_a1_bed_lane` raise `ValueError` and the route
catches it into a 400 — so these extend a pattern instead of introducing one. Taking the *value*
rather than `(data, key)` is what makes nested fields nameable: `_str_field(c.get("input"), f"clip
{i}: input")` produces `clip 0: input must be a string`, which a `(data, key)` signature cannot
express. A declarative per-route schema would have been the larger, tidier answer, and was rejected
as a restructure of 14 working routes for a bug that is about error paths only.

**Why `duration_known` instead of raising from `get_video_info` — the entry's own suggestion.** The
entry says to *"treat a 0/absent duration as an explicit 'cannot read duration' error at probe
time."* At probe time would break `trim` and `reverse`, which are measured above as **working** on
such a file — they hand `-ss`/`-to` or `reverse` to ffmpeg, which reads the stream itself and needs
no duration. Raising in the probe would have removed working behaviour to improve a message, which
the working rules forbid. So `duration` still reports `0.0` for every caller that only displays it,
and the new flag is tested only in the three routes where a `0` flows into timeline arithmetic.

**Why `bool` is rejected by `_num_field`.** `isinstance(True, int)` is `True`, so `true` as a
duration silently means one second. Measured: `hold_frame time=true` returned **200** on 0.39.0. A
client sending a checkbox where a number belongs has a bug, and reading it as `1` hides it.

**Why the existing messages were kept.** Every previous error string — `room tone has nothing to
fill on this timeline`, `presets must be a list`, `export settings must be an object`, `invalid
inSec/outSec for source duration 3.0` — is unchanged. The checks are additions in front of them, so
the 10 controls that already returned a good 400 return the identical text (verified below).

**Ranges deliberately not added.** `speed`, `crop`, `overlay x/y` and `noiseGainDb` are type- and
finiteness-checked where they pass through the helpers, but no *plausibility* bounds were invented
for them (no "speed must be under 10×"). Choosing a limit is a product decision, not a bug fix.

#### Observations (out of scope — recorded, not fixed)

1. **The entry's "HTML" wording is stale** — see the re-measurement above. Left as written, per the
   rule about not rewording surrounding text; corrected in the status table's confidence cell.
2. **`browse_directory` interpolates `initial` into AppleScript unquoted.** The fix now requires it
   to be a string, but a string containing a quote still reaches `osascript` inside the script text.
   Injection-flavoured; belongs in **#14** as its own item.
3. **The Media Bin still shows a duration-less file as `0:00`.** `/api/probe` returns 200 with
   `duration: 0.0`; the new `duration_known` flag is in that payload but no frontend code reads it.
   A display fix, not this finding.
4. **An untrimmed A1 bed with `audio_duration == 0` still lands silently on the lane.** Its own
   `reach <= 0` guard only fires when a trim is set, so a duration-less audio file becomes a
   zero-length bed with no message. Same root cause, different route; not gated here because the A1
   bed path was not in the entry's scope.
5. **`trim` does not check `start`/`end` against the source duration.** After this fix they must be
   finite, ordered and non-negative, but `--start 900` on a 3-second file still reaches ffmpeg and
   produces an empty or failed output rather than a 400.
6. **`render_timeline` ignores an unknown `dir` value.** `dir=42` returns 200 because anything that
   isn't the string `"output"` has always meant the input directory. Left as-is: changing it would
   change render behaviour, not an error path.
7. **No Python linter is configured** in this project (`.venv` has no flake8; `conventions.md` lists
   only oxlint, for the frontend), so the Python check here is `py_compile` plus the live A/B.

#### Verification

`python3 -m py_compile app.py ffmpeg_utils.py` → `COMPILE_OK`. `npx vite build` from `frontend/` →
clean (no frontend file changed; run because `VERSION` moved).

**Malformed payloads — 59 cases, before (5098, 0.39.0) vs after (5097, fixed):**

| | 500 | 404 | 400 | 200 |
|---|---|---|---|---|
| before | **42** | 2 | 10 | 5 |
| after | **0** | 0 | 58 | 1 |

Representative rows (before → after):

| Case | 0.39.0 | 0.40.0 |
|---|---|---|
| `trim {}` | 500 `internal server error` | 400 `input is required` |
| `trim input=42` | 500 `internal server error` | 400 `input must be a string` |
| `trim end=banana` | 500 `ffmpeg failed` | 400 `start/end must be numeric seconds or a HH:MM:SS.ms timecode` |
| `trim start 5 > end 1` | 500 `ffmpeg failed` | 400 `end (1) must be later than start (5)` |
| `splice inputs="small.mp4"` | 404 `input file not found: .../input/s` | 400 `inputs must be a list` |
| `splice inputs=[42,42]` | 500 `internal server error` | 400 `inputs[0] must be a string` |
| `render_timeline clips="small.mp4"` | 500 `internal server error` | 400 `clip 0 must be an object` |
| `render_timeline clip input missing` | 400 `'input'` | 400 `clip 0: input is required` |
| `render_timeline outSec=NaN` | 500 `internal server error` | 400 `clip 0: inSec/outSec must be finite numbers` |
| `render_timeline headHoldSec=-3` | **200 rendered** | 400 `clip 0: headHoldSec must be at least 0` |
| `render_timeline headHoldSec=NaN` | **200 rendered** | 400 `clip 0: headHoldSec must be a finite number (got nan)` |
| `render_timeline overlay="x"` | 500 `internal server error` | 400 `clip 0 overlay must be an object` |
| `render_timeline audioBeds=[42]` | 400 `A1 clip 1: 'int' object is not subscriptable` | 400 `A1 clip 1 must be an object` |
| `render_a1 outSec=NaN` | 400 `cannot convert float NaN to integer` | 400 `clip 0: inSec/outSec must be finite numbers` |
| `hold_frame time=NaN` | 500 `ffmpeg failed` | 400 `time must be a finite number (got nan)` |
| `hold_frame time=true` | **200 held a frame** | 400 `time must be a number` |
| `hold_frame duration=[1]` | 500 `internal server error` | 400 `duration must be a number` |
| `reformat input missing` | 400 `invalid filename: None` | 400 `input is required` |
| `projects name=[...]` | 500 `internal server error` | 400 `project name must be a string` |
| `rename_file dir=[...]` | 404 `file not found` | 400 `dir must be a string` |
| `execute command=[...]` | 500 `internal server error` | 400 `command must be a string` |
| `chat session_id=42` | 500 `internal server error` | 400 `session_id must be a string` |
| `browse_directory initial=42` | **200** (opened the real folder picker) | 400 `initial must be a string` |
| `render_timeline` on `nodur.mkv` | 400 `clip 0: invalid inSec/outSec for source duration 0.0` | 400 `clip 0: cannot read the duration of nodur.mkv — its container reports none, so no trim window can be checked against it` |
| `hold_frame` on `nodur.mkv` | 400 `time must be within [0, 0.0)` | 400 `cannot read the duration of nodur.mkv — its container reports none, so the frame to hold cannot be located` |

The one remaining 200 is `render_timeline clip dir=42`, observation 6 above — deliberate.

**Controls — 24 valid payloads, same status and same bytes:** `trim 0-1` `59dacb76`, `trim timecode`
`e8a8a80b`, `trim` with no `start` key `59dacb76`, `splice x2` `db5f32fc`, `render_timeline` 1 clip
`2f04a697`, 2 clips + holds `0786471a`, explicit `hold=0` `2f04a697`, `speed 0.5` `fd1c9264`, `crop`
`5ace8b52`, bed + room tone `daa8bceb`, `noAudio` `264ed4f3`, named output `2f04a697`, `render_a1`
bed `45782b70`, `render_a1` room-tone refusal (400, identical text), `hold_frame t=0` `2124e984`,
`hold_frame` with string numbers `9ad80bd4`, `reverse` `762ac681`, `reformat 720p` `12b3215f`,
`projects save` 200, `export_settings` ×2 200, `execute ffmpeg -h` 200 — **all 22 md5s identical
before and after.**

The remaining 2 controls are `trim` and `reverse` on the duration-less `nodur.mkv` (both still 200,
i.e. the working behaviour the fix was careful not to remove). Their md5s differ, and that is
**Matroska, not the change**: two runs of the identical request against the *same* pre-fix server
produced two different md5s (`0ad61f40`, `d9a30caf`), as did the fixed one (`26704d58`,
`9c612381`) — the muxer stamps a unique SegmentUID per file. Compared on pixels instead:

```
48e9b1e046c0665d1532ef8708c88e27  /tmp/g11old/output/nodur_reversed.mkv   (0.39.0)
48e9b1e046c0665d1532ef8708c88e27  /tmp/g11/output/nodur_reversed.mkv      (0.40.0)
aeab8a62d2dfa9abf9371fd216f19cc6  /tmp/g11old/output/nodur_trimmed.mkv    (0.39.0)  66868 bytes
aeab8a62d2dfa9abf9371fd216f19cc6  /tmp/g11/output/nodur_trimmed.mkv       (0.40.0)  66868 bytes
```

(`ffmpeg -i FILE -map 0:v -f framemd5 -` with the header lines stripped, hashed.) Frame-for-frame
identical, same size.

**Version judgement.** Shipped as **minor** (0.40.0). Three previously-accepted requests now fail —
`headHoldSec=-3`, `hold_frame time=true`, `browse_directory initial=42` — which under a strict
reading of *"major = anything that changes existing behaviour"* argues for a major bump. Judged
minor because none of the three is reachable from the UI (`HoldFrameForm.jsx` already refuses a
negative hold, and no control posts a boolean or an integer folder path), so no working workflow
changes; and because all three were malformed input being silently reinterpreted. Recorded here
because it is a judgement call, not an obvious one.

---

## 12. MEDIUM — Fresh-machine setup failures

**Status:** FIXED in 0.42.0 — see [Resolution](#resolution-12).
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

<a id="resolution-12"></a>
### Resolution — 0.42.0 (2026-08-27)

#### Re-measuring the finding first

Each of the four items is a different environment, so each got its own scratch instance with its own
`PROJECT_ROOT` (`ffmpeg_utils.PROJECT_ROOT` is derived from the module's own file, so a copy of
`app.py` + `ffmpeg_utils.py` in `/tmp` is a self-contained app) and its own port, launched with
`debug=False, use_reloader=False` so no import-time probe of the environment happened twice:

- `/tmp/g12` on **5095** — a clone with **no `input/` and no `output/`**, for items 1 and 4.
- `/tmp/g12nb` on **5094** — `_tool`'s brew prefix repointed at an empty `/tmp/g12nb/nobin/`, run
  under `PATH=/usr/bin:/bin:/usr/sbin:/sbin` so `shutil.which` finds nothing either, with one real
  320×240 24 fps 2 s `input/alpha.mp4`. This is a machine with no ffmpeg, without uninstalling
  anything.
- `/tmp/g12fake/osascript` on **5093** — a fake `osascript` first on `PATH`, reproducing at the
  subprocess boundary the exit status and stderr of a denial, a cancel, a success and a hang. The
  route sees only returncode/stdout/stderr, so that is a complete stand-in — and the real strings
  came from actually invoking `osascript` once (in the background; it blocks for two minutes).

All four items reproduced. The **before** evidence:

| Item | What the user got |
|---|---|
| 1 — no `input/`/`output/` | `GET /api/files` → **500** `{"error":"internal server error","detail":"FileNotFoundError: [Errno 2] No such file or directory: '/private/tmp/g12/input'"}`; same for `/api/outputs` and `POST /api/upload` |
| 2 — no ffmpeg | probe, trim, reverse, hold_frame, `/preview` → **500** `{"error":"internal server error","detail":"FileNotFoundError: … '/tmp/g12nb/nobin/ffprobe'"}`, `/api/execute` the same for `ffmpeg`, `render_timeline` `{"error":"probe failed for …"}`. Startup said nothing at all |
| 3 — Browse denied | `-1743` denial and `-128` cancel both returned **byte-identical** `200 {"cancelled":true,"path":""}` |
| 3 — Browse hung | in this project's own environment, **no dialog ever appeared** and the route returned **500 after 120.006880 s** with `error` set to the *entire AppleScript source* inside a `TimeoutExpired` string |
| 4 — non-Latin names | `видео.mp4` and `影片.mp4` → **400** `{"error":"unsupported file type: mp4"}`; `ГОРА.MOV` → `unsupported file type: MOV` |

Three things the entry gets wrong or understates:

1. **The `App.jsx` half of item 1 is obsolete.** The entry blames `App.jsx:482`'s missing `.catch`
   for the failure "presenting as a merely-empty Media Bin". That `.catch` is now *deliberately*
   absent, with a comment saying so, as part of #6's fix — an unhandled rejection is what reaches
   `main.jsx`'s global handler and alerts. So on today's code a fresh clone alerts; it does not look
   empty. Nothing in `App.jsx` needed changing, and the entry's "+2 in `App.jsx`" is stale.
2. **Item 4 is broader than "non-Latin", and the obvious fix would have made it worse.** The message
   named `mp4` — a *supported* extension — as the unsupported type, because `secure_filename` had
   already eaten the stem. And gating on the raw extension *alone* would have saved `видео.mp4` as
   `mp4`: a file with no extension, which every listing route filters out of sight, i.e. an upload
   that reports success and then cannot be seen. Hence sanitizing the stem and re-attaching the
   extension.
3. **Item 3 has a second face the entry doesn't mention** — the hang above. A denial that *exits* and
   a System Events that *never answers* are the same permission problem with two different code
   paths, and only one of them is a returncode.

Item 2's "opaque" was worth quantifying: the actionable text was never absent, it was in `detail`,
which the render/reformat/chat call sites *do* alert but which `MediaLibrary.selectFile` and
`TechInfoPanel` do not — clicking any file on such a machine drew a metadata table of `—` dashes,
reading as a file with no metadata rather than one that could not be read.

#### Changes made

| Where | Change |
|---|---|
| `ffmpeg_utils.py` after `FFPROBE = _tool(…)` | New `missing_tools()` (which of the two resolved paths don't exist, as `(name, path)` pairs) and `missing_tool_message(path)` (`cannot find ffprobe — this app looked for it at <path>. Install it with: brew install ffmpeg`) |
| `ffmpeg_utils.py` `probe()` | its `subprocess.run` wrapped: `except FileNotFoundError: raise RuntimeError(missing_tool_message(FFPROBE))` |
| `ffmpeg_utils.py` `run_tracked()` | its `Popen` wrapped the same way on `cmd[0]` — the second and last spawn site, and the one `run_ffmpeg` goes through |
| `app.py` `__main__` | before `install_shutdown_handlers()`, print one `!!` line per missing tool |
| `app.py` `_list_dir` | `os.makedirs(base, exist_ok=True)` at the top |
| `app.py` `upload` | gate on `os.path.splitext(f.filename)[1]`, sanitize only the stem, re-attach the original extension, `makedirs(fu.INPUT_DIR)` before saving |
| `app.py` `browse_directory` | new `_PICKER_ERROR` sentence; classify a non-zero exit as cancel (`-128`) vs blocked (everything else) and 500 the latter with stderr in `detail`; new `except _sp.TimeoutExpired` branch with the same sentence |
| `TechInfoPanel.jsx` | early return when the probe result is `{error, detail}`: the filename plus `could not read this file — <error>` in amber, instead of a table of dashes |

The upload naming, in full:

```python
    raw_ext = os.path.splitext(f.filename)[1]
    if raw_ext.lower() not in fu.MEDIA_EXTENSIONS:
        return jsonify({"error": f"unsupported file type: {raw_ext or f.filename}"}), 400
    stem = secure_filename(os.path.splitext(f.filename)[0])
    name = (stem or "upload") + raw_ext
```

#### Reasoning

**Why `makedirs` in `_list_dir` is safe, when `_list_dir` also serves a user-chosen export
directory.** `get_output_dir()` returns the custom path **only** `if os.path.isdir(custom)` — so a
mistyped, deleted or unmounted export directory has already fallen back to `fu.OUTPUT_DIR` before
`_list_dir` ever sees it. The folder created is always the project's own. Putting the `makedirs` in
`get_output_dir()` instead would have reversed exactly that, silently manufacturing a directory
wherever a stale settings file pointed.

**Why the missing-tool check prints instead of refusing to start.** The server without ffmpeg is
still worth having up: the UI loads, both bins list, projects open, and it is the one screen that can
explain the problem. Exiting would replace a specific failure with no app at all. It also stays a
*startup* statement rather than a health route, because the resolution happens once at import — there
is nothing per-request about it.

**Why the message is generated at the spawn sites and not at the route level.** Every media route
would otherwise need its own `except FileNotFoundError`, and a new route would silently lack one.
There are exactly two spawn sites, both funnelled into `RuntimeError`, which every route already
turns into a 500 with the text intact.

**Why `-128` is matched on the number, not the words.** It is AppleScript's own error code and is
locale-independent; `"user canceled"` is checked too, but only as a fallback in case a future macOS
words it without the code. The classification is deliberately "cancel is the *narrow* case, anything
else is blocked": an unrecognised failure surfacing as an explanation the user can act on is a much
better error than an unrecognised failure surfacing as silence.

**Why the extension keeps its original case.** `ГОРА.MOV` lands as `upload.MOV`. Only the *check* is
case-folded, because `MEDIA_EXTENSIONS` is lowercase; lower-casing the stored name would have been a
behaviour change for every existing `.MOV`/`.WAV` upload.

**Rejected:** transliterating non-ASCII names (`видео` → `video`) — it needs a dependency and it
guesses; storing the original name in a sidecar and displaying that — a second naming authority, and
every filename-keyed feature (★, track tags, bin folders, `.nara` references) would have to learn
about it. `upload.mp4` plus the bin's existing Rename is the honest version of what the app can
store.

#### Observations

- **`clear_input` (`app.py:326`) would still 500 on a truly fresh clone** — its `os.listdir` has no
  `makedirs` and no guard. Left alone: it is unreachable in practice, because the frontend calls
  `/api/files` at mount, which now creates `input/` before any button exists to press. Not fixed
  because it is not part of this finding and the fix isn't free (deciding whether "cleared nothing"
  is a success). Recorded in #14. `delete_input_file` already degrades to a clean 404.
- **`rename_file` has item 4's bug in a second place.** It sanitizes the whole `newName`, so renaming
  a file *to* `видео.mp4` fails with `new name required` — a message about a name the user did
  supply. Out of scope (the finding names `upload`), recorded in #14.
- **The startup banner prints twice under the reloader**, once in the parent and once in the reloaded
  child. Expected — `__main__` runs in both — and left as is; suppressing it would mean reading
  `WERKZEUG_RUN_MAIN`, which is machinery in exchange for one duplicate line.
- **`/api/execute` still labels its 500 `internal server error`** with the ffmpeg message in
  `detail`. Left as is: that route has no route-level handler, and the chat panel is one of the call
  sites that *does* display `error` + `detail`, so the user sees the actionable sentence.
- The entry's five `Where:` pointers are all a little low but land in the right functions
  (`_list_dir` is at `app.py:110`'s function today, upload at `:289`, `_tool` at
  `ffmpeg_utils.py:104`, browse at `app.py:647`).

#### Verification

Every number below is from re-running the *same* harness against the fixed code.

**Item 1 — `/tmp/g12`, `input/` and `output/` deleted again before each phase:**

```
  input/ present?  NO          output/ present? NO
  GET  /api/files    200  []
  GET  /api/outputs  200  []
  GET  /api/projects 200  []
  → input/ created, output/ created
  (folders deleted again)
  POST /api/upload   200  {"name":"probe_upload.mp4"}   → input/ created
```

**Item 2 — `/tmp/g12nb`, no ffmpeg or ffprobe anywhere.** Startup, from the real `__main__`:

```
  !!  cannot find ffmpeg — this app looked for it at /tmp/g12nb/nobin/ffmpeg. Install it with: brew install ffmpeg
  !!  cannot find ffprobe — this app looked for it at /tmp/g12nb/nobin/ffprobe. Install it with: brew install ffmpeg
 * Serving Flask app 'app'
```

and every route now names the tool and the cure (`/api/version` and `/api/files` still 200, as they
should — they need no binary):

| Route | Before | After |
|---|---|---|
| `GET /api/probe/alpha.mp4` | `internal server error` / `FileNotFoundError: … '/tmp/g12nb/nobin/ffprobe'` | `cannot find ffprobe — this app looked for it at /tmp/g12nb/nobin/ffprobe. Install it with: brew install ffmpeg` |
| `POST /api/trim` | same | same message |
| `POST /api/reverse` | same | same message |
| `POST /api/hold_frame` | same | same message |
| `POST /api/render_timeline` | `probe failed for …` / `FileNotFoundError` | `probe failed for …` / that message in `detail` |
| `GET /preview/input/alpha.mp4` | `could not build preview` / `FileNotFoundError` | `could not build preview` / that message in `detail` |
| `POST /api/execute` | `internal server error` / `FileNotFoundError: … ffmpeg` | `internal server error` / `RuntimeError: cannot find ffmpeg …` |

**Item 3 — `/tmp/g12fake` on 5093, one request per mode:**

```
  deny   (-1743)  500  {"error":"macOS would not open the folder picker — allow this app to control
                        System Events under System Settings ▸ Privacy & Security ▸ Automation, or
                        type the folder path into the field instead",
                        "detail":"43:47: execution error: Not authorized to send Apple events to
                        System Events. (-1743)"}
  cancel (-128)   200  {"cancelled":true,"path":""}
  ok              200  {"cancelled":false,"path":"/Users/sarmieaj/Movies"}
  hang            500  after 120.009653s — the same error sentence, detail "the folder picker did not
                        respond within 120 seconds"   (before: the whole AppleScript, as `error`)
```

`ExportSettings.handleBrowse` already did `if (result.error) setError(result.error)`, so the dialog
displays that sentence with no frontend change.

**Item 4 — the naming function A/B'd over 18 filenames, old code against new:**

```
filename             BEFORE                             AFTER                              same?
clip.mp4             saved: clip.mp4                    saved: clip.mp4                    yes
My Clip 02.mp4       saved: My_Clip_02.mp4              saved: My_Clip_02.mp4              yes
café.mp4             saved: cafe.mp4                    saved: cafe.mp4                    yes
../evil.mp4          saved: evil.mp4                    saved: evil.mp4                    yes
a.b.mp4              saved: a.b.mp4                     saved: a.b.mp4                     yes
TRAILER.MOV          saved: TRAILER.MOV                 saved: TRAILER.MOV                 yes
take 1 (final).mp4   saved: take_1_final.mp4            saved: take_1_final.mp4            yes
sound.WAV            saved: sound.WAV                   saved: sound.WAV                   yes
song.mp3             saved: song.mp3                    saved: song.mp3                    yes
日本語 clip.mp4        saved: clip.mp4                    saved: clip.mp4                    yes
noext                400: unsupported file type: noext  400: unsupported file type: noext  yes
(empty)              400: unsupported file type:        400: unsupported file type:        yes
видео.mp4            400: unsupported file type: mp4    saved: upload.mp4                  CHANGED
影片.mp4              400: unsupported file type: mp4    saved: upload.mp4                  CHANGED
ГОРА.MOV             400: unsupported file type: MOV    saved: upload.MOV                  CHANGED
notmedia.txt         400: unsupported file type: notmedia.txt   400: unsupported file type: .txt   CHANGED
archive.mp4.bak      400: unsupported file type: archive.mp4.bak  400: unsupported file type: .bak  CHANGED
.mp4                 400: unsupported file type: mp4    400: unsupported file type: .mp4   CHANGED
```

Every ASCII name is byte-identical, so `secure_filename`'s traversal and whitespace handling is
untouched; the only changes are the three names that should now be accepted and three refusals that
now name the extension instead of the filename. Live over HTTP, the two same-stem uploads got the
existing collision suffix rather than clobbering each other (`upload.mp4`, then
`upload_1787891967.mp4`), and all seven landed files appeared in `GET /api/files`.

**Controls, real ffmpeg present, on the fixed code** — nothing that worked stopped working:

```
  upload "My Clip 02.mp4"  → {"name":"My_Clip_02.mp4"}
  probe alpha.mp4          → 320×240, 24.0 fps, 2.0 s, 48 frames, h264
  trim                     → {"output":"ctl_trim.mp4"}
  render_timeline          → {"output":"ctl_render.mp4"}
  /api/outputs             → both files listed (98630 / 98613 bytes)
  /preview/input/alpha.mp4 → 200  video/mp4  31762 bytes
```

`npx vite build` clean (448.62 kB, 0.42.0 in the bundle), `npm run lint` exit 0 with the same 7
pre-existing warnings, `py_compile` clean on both backend files.

#### Version judgement

**Minor (0.42.0).** New self-healing behaviour and new messages; nothing that worked before behaves
differently — the A/B above is the evidence for the one change that could plausibly have been a
compatibility break.

---

## 13. LOW — `.preview_cache` never evicted

**Status:** FIXED in 0.43.0 — see [Resolution](#resolution-13).
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

<a id="resolution-13"></a>
### Resolution — 0.43.0 (2026-08-28)

#### Re-measuring the finding first

The finding recorded **414 MB / 301 files, ~211 MB dead**. Today, on the same machine:

| | Files | Size |
|---|---|---|
| `.preview_cache` total | 334 | **602.0 MB** |
| unreachable ("dead") | 298 | **501.8 MB — 83%** |
| reachable | 36 | 100.2 MB |

So the finding is right and **understates it**: the dead share has gone from roughly half to 83%. It
gets worse with use, not better, which is the argument for evicting rather than for a bigger disk.

**The stated cause is the minor one.** The entry says "every edit to a source file strands its old
entry forever". Splitting the 298 dead entries by *why* they are dead:

| Why | Files | Size |
|---|---|---|
| the source file no longer exists at all — a deleted or cleared Export Bin render, a rename | **274** | **434.6 MB** |
| the source still exists but was rewritten, so its mtime moved (the entry's own explanation) | 24 | 67.2 MB |

92% of the dead bytes are files that are simply *gone*. That matters for the fix: an age or
size-based policy would have been aiming at the wrong thing, while matching entries against the media
that actually exists reclaims exactly that 435 MB and is not a heuristic at all.

**Why "unreachable" is exact, and therefore safe to delete on.** `serve_preview` (`app.py:219`)
returns 404 before it ever asks for a preview unless the source file exists, and
`get_or_make_preview` then builds the cache key out of *that file's own* basename and whole-second
mtime. So an entry whose `(name, mtime)` matches no file in the live directories cannot be named by
any request, whatever the user does next — deleting it can at worst cost one re-transcode if the
user later restores the file. Measured cost of that: **2.2 s** for a 4 s HEVC clip, **11.5 s** for a
13 s one, against **0.06–0.08 s** to serve a cached copy.

Also confirmed while measuring: nothing else in the repo enumerates or deletes from this directory
(`grep` found the cache named only in `get_or_make_preview`, `.gitignore`, the **share-project**
skill's exclude lists, and `agentic_installation.MD`'s "leave it alone" row), and there were **no
leftover `.part.mp4` temp files** on this machine — the `finally` block in `get_or_make_preview`
already handles those.

#### Changes made

| Where | Change |
|---|---|
| `ffmpeg_utils.py` | `PREVIEW_CACHE_MAX_BYTES = 2 * 1024**3` |
| `ffmpeg_utils.py` | `preview_cache_key(name, mtime)` — the cache filename is now spelled out in one place, so the writer and the sweeper cannot drift |
| `ffmpeg_utils.py` | `prune_preview_cache(live_dirs, max_bytes=…)` → `(files_removed, bytes_reclaimed)`: delete every `*.preview.mp4` whose key matches no file in `live_dirs`, then, if what remains is over the cap, delete least-recently-used first |
| `ffmpeg_utils.py` `get_or_make_preview` | new optional `prune_dirs`; sweeps **after** a successful transcode (i.e. on a miss), and on a **hit** does `os.utime(cached)` so the cap is LRU rather than FIFO |
| `app.py` `serve_preview` | passes `prune_dirs=[fu.INPUT_DIR, get_output_dir()]` |
| `app.py` `__main__` | sweeps once before serving and prints `..  preview cache: removed N file(s), reclaimed M MB` when it reclaimed anything |

#### Reasoning

**Why the live directories are passed in rather than read here.** Only `app.py` knows where the
Export Bin is — `get_output_dir()` reads `.export_settings.json`. Having `ffmpeg_utils` reach for
that would put settings knowledge in the module that is deliberately free of it, and would make the
sweeper untestable without a settings file. The cost is one parameter.

**Why both a startup sweep and a per-miss sweep.** Startup is the only moment with no request in
flight, and it is what gives a user who has *stopped* previewing new files their space back. But this
app is routinely left running for days, so startup alone would never fire again; a miss is the ideal
second hook because the caller is about to spend seconds on an encode, which makes a few hundred
`stat` calls free by comparison. A sweep on every *hit* was rejected: a `<video>` issues many range
requests per file, and none of them creates new garbage.

**Why LRU, and why the touch is what makes the cap safe.** The size cap is the only part that deletes
*reachable* entries, so it is the only part that could delete a file a request is streaming. Touching
an entry on every hit means the file being served right now is the newest and therefore the last
candidate the loop would ever reach — a lock-free guarantee. It is also better policy: an old preview
that is still being clicked survives, where deleting by age would evict it. Nothing reads the cache
file's own mtime (the key carries the *source's* mtime in its name), so moving it is free.

**Why the cap is 2 GiB rather than "a few hundred MB" as the entry suggests.** Sweeping alone took
this machine from 602 MB to 100 MB, so the cap is a backstop against a project with hundreds of live
non-playable sources, not the working mechanism. Set it low and it starts evicting previews the user
is actively clicking, buying seconds of re-encoding for space the sweep was going to reclaim anyway.

**Why only `*.preview.mp4` is considered.** An in-progress transcode writes
`<key>.<pid>.<tid>.part.mp4` in this same directory. Deleting one out from under a running encode
would make its `os.replace` raise `FileNotFoundError`, which `serve_preview` does **not** catch (it
catches `RuntimeError`) — so a sweep triggered by one request would have turned a *concurrent*
preview into a 500. Skipping temp names also preserves the existing invariant that a leftover temp
file is inert, and the existing comment saying "nothing enumerates `.preview_cache`" was amended
rather than left to go stale.

**Rejected:** deleting the cache entry at the point of deletion/rename (in `delete_output_file`,
`clear_output`, `rename_file`, `delete_input_file`, `clear_input`) — it would have to be added to
five routes, each would need the key-derivation logic, and any future route that removes a file would
silently omit it; the sweep needs no cooperation from anything. Also rejected: fixing the
directory-blind cache key at the same time (AUDIT #14) — a real bug, but a different one, and
changing the key would invalidate every existing entry.

#### Observations

- **The finding's own numbers were stale in the direction that matters.** Recorded 414 MB/211 MB dead,
  measured today 602 MB/502 MB dead. Anything sizing a fix off the numbers in this document should
  re-measure first.
- **Nothing in the delete paths touches the cache, and after this fix that is fine but not obvious.**
  Measured: deleting `rendered.mov` through `DELETE /api/outputs/<name>` left its cached preview in
  place; it was reclaimed by the next miss. So disk is returned lazily, not at the moment of deletion.
- **The 2 GiB cap is currently unreachable in normal use** (the live set is 100 MB), so it is verified
  by unit-level measurement with a small cap rather than by a real session. Worth knowing that the
  first real exercise of that code path will be on someone's much larger project.
- **The sweep makes the directory-blind key (AUDIT #14) marginally *less* likely to bite**, since a
  colliding entry now gets removed once either source changes, instead of persisting forever. It does
  not fix it: two live files sharing a name and a whole-second mtime still share one entry.
- The entry's `Where:` pointer (`ffmpeg_utils.py:924-927`) is low by about 60 lines but lands in
  `get_or_make_preview`'s neighbourhood; the function is at `:1080` today.

#### Verification

**Unit-level, on a scratch instance `/tmp/g13` with its own `PROJECT_ROOT`** (so `PREVIEW_CACHE_DIR`,
`INPUT_DIR` and `OUTPUT_DIR` are all under `/tmp`), against real `prune_preview_cache`:

| Case | Result |
|---|---|
| one sweep over a live input entry, a live export entry, a deleted-source entry, an mtime-stale entry, an in-progress `.part.mp4`, and a non-preview file | removed exactly **2** files / 18000 bytes — the two unreachable ones; **both live entries, the temp file and the junk file survived** |
| second sweep immediately after | `(0, 0)` — idempotent |
| a `live_dir` that cannot be listed | does not raise; input/ previews kept |
| cap 900 bytes over three 400-byte live entries | removed **1**, and it was the **least recently used**; the middle and the most-recently-used survived |
| cap 0 | removes all remaining reachable entries (the loop terminates rather than looping) |
| no `.preview_cache` directory at all | `(0, 0)` |
| `preview_cache_key("a.mov", 1700000000.987654)` | `a.mov.1700000000.preview.mp4` — whole-second, matching the writer |

**End to end over HTTP on the same scratch instance** (real ffmpeg, real ProRes/HEVC sources):

```
  1. first request, a miss   200  video/mp4  95320 bytes  0.247s   -> 1 entry cached
  2. same request again      200             95320 bytes  0.043s   (served from cache)
  3. real sources            big_hevc.mp4 cold 2.159s / warm 0.058s
                             mid_hevc.mp4 cold 11.493s / warm 0.083s
  4. delete an export, then miss on another file:
       after DELETE /api/outputs/rendered.mov  -> its preview is still there (delete does not sweep)
       after one miss on prores_c.mov          -> rendered.mov's entry is gone, prores_c's is present
  5. a hit touches the entry: cache-file mtime forced 9999s into the past, moved forward by 9999s
  6. three long transcodes at once, each miss sweeping while the others encode:
       all three 200, all three ffprobe-readable at the correct duration (13.041667 / 13.041667 /
       4.000000), no leftover .part files
  7. touch a source in place: 1 entry before, 1 entry after — the stale one swept, not stranded
  8. control: a browser-playable .mp4 preview leaves the cache count unchanged (7 -> 7)
```

**Startup path**, seeded with five 3 MB unreachable entries:

```
  ..  preview cache: removed 5 file(s), reclaimed 15 MB
 * Serving Flask app 'app'
```

**On the real repo.** The dev server's own reloader restarted on the edit and swept the live cache
with no intervention — which is the fix working through the ordinary path rather than a test:

```
  before:  334 files, 602.0 MB
  after:    36 files, 100.2 MB          (502 MB reclaimed)
  every survivor reachable?  True       unreachable left: []
  a second sweep now finds nothing:     removed 0, reclaimed 0
  preview still served:  /preview/input/Batch_01_V002_r01.mp4  200  video/mp4  9364948 bytes  0.062s
```

`py_compile` clean on both backend files; `npx vite build` clean with 0.43.0 in the bundle;
`npm run lint` exit 0 with the same 7 pre-existing warnings (no frontend source changed).

#### Version judgement

**Minor (0.43.0).** New behaviour — a cache that evicts — with no change to what any request returns:
a preview still resolves to the same bytes, and anything the sweep removes is rebuilt on demand. The
one thing a user could notice is disk usage going down and a new line at startup.

---

## 14. LOW — Remaining sharp edges

**Status:** FIXED in 0.44.0 — see [Resolution](#resolution-14). 13 of the 16 rows fixed, 2 were
already fixed before this pass, 1 knowingly left as found; three rows did not say what was actually
true and are corrected there.

| Item | Where | Note | Confidence |
|---|---|---|---|
| `probe()` has no timeout | `ffmpeg_utils.py:159` | One unresponsive file wedges a request indefinitely; nothing bounds it | PLAUSIBLE — nobody could produce a file that actually hangs ffprobe |
| Chat "Run" hangs 10 minutes | `app.py:1885` | If the generated command omits `-y` and the output exists, ffmpeg blocks on the overwrite prompt until the 600s timeout | VERIFIED |
| Output name joined unsanitized | `app.py:1266`, also `:1489`, `:1573` | `8/25 hero cut` fails with ffmpeg's **version banner** as the error text; `../x.mp4` writes outside the bin and reports success. Nothing is overwritten (the uniqueness loop does check `os.path.exists`) | VERIFIED |
| `validate_ffmpeg_command` checks only the last output | `ffmpeg_utils.py:2389` | Permits writing into `input/`, so the "source files are never modified" invariant depends on the Agent tab not emitting such a command | PLAUSIBLE |
| `.export_settings.json` is committed | `app.py:249` | Every clone inherits the developer's `under50mb_hevc` mode. It is also a non-atomic read-modify-write, so concurrent saves lose an update and a crash can reset the export dir, quality and **all saved presets** | VERIFIED |
| `.webm` is offered but cannot be rendered | `ffmpeg_utils.py` `ALLOWED_EXTENSIONS` / `encode_args` | Naming an output `.webm` always 500s: `encode_args` yields libx264/AAC and the webm muxer accepts neither ("Nothing was written into output file, because at least one of its streams received no packets"). Found during #9 and confirmed identical on pre-#9 code, so it is not a regression | VERIFIED by running, both before and after #9 |
| Chat-produced files are invisible once the export dir is moved | `app.py:1875` `build_file_context`, `:2010` `_output_arg_info` | The chat/execute sandbox writes to `fu.OUTPUT_DIR` — deliberately, since it is a write-permission boundary (`fu._media_path_ok`), not a display preference. With a custom export dir its files are not in the Bin, and since 0.36.0 they no longer probe or preview either. Renders using them as a clip source already failed before 0.36.0 (clip resolution has always used `get_output_dir()`), so nothing that worked stopped working | VERIFIED on pre- and post-0.36.0 code |
| Export dir can be set to `input/` | `app.py` `POST /api/export_settings` | Any absolute directory is accepted, including the source folder. Source bytes are safe (`O_EXCL` + the uniqueness loop give `a_1.mp4`), but exports then appear in the Media Bin's **input** list. `render_timeline` behaved this way before 0.36.0; five routes now share it | VERIFIED, md5 of the source unchanged both ways |
| `.preview_cache` key ignores the directory | `ffmpeg_utils.py` `get_or_make_preview` | The key is `<basename>.<int mtime>.preview.mp4`, so two different non-browser-playable files sharing a name and a whole-second mtime share one transcode — the preview player shows the wrong video. Measured: two ProRes files named `same.mov` both served the identical 7,335-byte file. Identical before and after 0.36.0, but that fix widens the colliding set from {`input/`, `output/`} to {`input/`, any export dir used} | VERIFIED by running |
| `browse_directory` interpolates `initial` into AppleScript unquoted | `app.py` `POST /api/browse_directory` | The value is pasted into the `osascript` source text. Since 0.40.0 it must be a *string* (#11), but a string containing a quote still reaches the interpreter as script rather than as data. Only reachable from the export-settings dialog on the local machine | PLAUSIBLE — not exploited by hand |
| A duration-less A1 bed lands silently on the lane | `app.py` A1 bed loop | An untrimmed bed whose `audio_duration` is 0 becomes a zero-length bed with no message; its own `reach <= 0` guard only fires when a trim is set. Same root cause as #11's `duration_known` gate, which was applied to the three *video* routes only | VERIFIED by running |
| `trim` never checks `start`/`end` against the source duration | `app.py` `POST /api/trim` | Since 0.40.0 they must be finite, ordered and non-negative (#11), but `start=900` on a 3s file still reaches ffmpeg and produces an empty or failed output rather than a 400 naming the real problem | VERIFIED by running |
| Playback stalls at a 24 fps clip's last frame | `useTimelinePlayback.js` `EPS_SRC`, `runNative`'s `step` | A 2.000s @24fps file presents its last frame at **1.9583s**, but `EPS_SRC = 0.04` only hands off to the next segment once a frame lands at ≥ 1.96s. `step` schedules one more `requestVideoFrameCallback` that never fires, because the media has `ended` — element `paused=true`, engine still `playing=true`, position frozen. Measured `ended=1 frames=47 lastFramePresentedAt=1.9583s`. Intermittent (1 run in 3 got past a boundary by timing accident and stalled at the next clip instead). Identical on pre-#10 code, so not a regression. No `ended` listener exists as a backstop | VERIFIED by running, on both pre- and post-#10 code |
| A deleted export can reappear from a late probe | `OutputPanel.jsx` `handleDelete`, `handleClear` | Both clear `selectedName` and `info` but do not invalidate the in-flight probe #10 added a sequence ref for, so a reply already on the wire can repopulate the panel for a file that has just been deleted. Bumping that ref is the fix; it was left out of #10 because it changes delete's behaviour, not the click race | TRACED |
| `clear_input` 500s when `input/` is absent | `app.py` `POST /api/clear_input` | Its `os.listdir` has no `makedirs` and no guard, so on a clone that never created the folder it raises `FileNotFoundError` where `delete_input_file` degrades to a clean 404. Unreachable in practice since 0.42.0 — the frontend's mount-time `/api/files` now creates `input/` before any button exists to press — so it was left out of #12, which also avoids deciding whether "cleared nothing" should read as success | TRACED, from #12's fresh-clone instance |
| Renaming a file *to* a non-Latin name is refused as "new name required" | `app.py` `POST /api/rename_file` | `secure_filename(raw_new)` drops every non-ASCII character, so `видео.mp4` sanitizes to the empty string and the route reports a missing name for a name the user did supply — item 4 of #12 in a second route. #12 fixed `upload` only, because that is the route the finding names. Unlike upload there is no obvious right answer here: the app can only store ASCII filenames, so the honest fix is a *message* saying so rather than a silent substitution | VERIFIED by reading the sanitizer's output; same measurement as #12 item 4 |

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

<a id="resolution-14"></a>
### Resolution — 0.44.0 (2026-08-28)

#### Re-measuring the finding first

All 16 rows were re-measured on a scratch instance (its own `PROJECT_ROOT`, its own `input/` and
export bin) before anything was edited. **Three rows do not say what is actually true today:**

| Row | What the entry claims | What it does now |
|---|---|---|
| output name joined unsanitized | "`8/25 hero cut` fails with ffmpeg's **version banner** as the error text" | It **succeeds**. `stage_output`'s `os.makedirs(stage_dir, exist_ok=True)` builds the whole parent chain, so the `/` silently created a `8/` subdirectory *inside* the export bin and the render landed in it. `commit_output` then returns `os.path.basename(final)`, so the reply said `25 hero cut.mp4` and the Export Bin — which lists one directory, not a tree — showed nothing at all. A hidden render is worse than a bad error message, not better. (`../x.mp4` still writes outside the bin, as the row says.) |
| `validate_ffmpeg_command` checks only the last output | permits writing into `input/` | **Already refused**, by name, before this pass: a non-final output pointed into `input/` is rejected. Superseded by **#16** as the entry itself notes. |
| renaming *to* a non-Latin name is refused as "new name required" | the route reports a missing name | It does **not** refuse. `видео.mp4` sanitizes to `mp4` — the extension survives because `secure_filename` keeps ASCII — the route re-appends the original extension, and the file is silently renamed to **`mp4.mp4`**. A silent substitution to a nonsense name, not a bad error message. (My first attempt to measure this posted the wrong request keys and *appeared* to confirm the row; the route's keys are `name`, `newName`, `dir`.) |

Two rows were upgraded from PLAUSIBLE by measurement rather than by argument. `probe()` has no
`timeout=` — that is the fact, and it does not depend on anyone producing a file that hangs ffprobe,
which is why the fix is a bound rather than a hunt. `browse_directory`'s `initial` really is compiled
as AppleScript: a value containing `"` returned **`-2741`** (a syntax error from `osascript`), so the
mundane consequence is that anyone whose folder name contains a quote cannot open the directory
picker.

Disposition of all 16 rows: **13 fixed here, 2 already fixed before this pass** (chat "Run" hangs, in
0.31.0; `validate_ffmpeg_command`, superseded by #16), **1 knowingly left as found** (chat-produced
files under a custom export dir — see Observations).

#### Changes made

| Where | Change |
|---|---|
| `ffmpeg_utils.py:169` | `RENDERABLE_EXTENSIONS` — `ALLOWED_EXTENSIONS` minus `.webm`: the set a render may *write*, as against the wider set the app may *read* |
| `ffmpeg_utils.py:219`, `:222` | `PROBE_TIMEOUT = 120`; `probe(path, timeout=PROBE_TIMEOUT)` raises a `RuntimeError` naming the file and the bound on `TimeoutExpired` |
| `ffmpeg_utils.py:1578` | `check_output_name(name, allowed=RENDERABLE_EXTENSIONS)` — one gate for "is this a filename this app may write": non-empty string, `os.path.basename(name) == name`, not `.`/`..`, and an extension from `allowed`. Raises `PathError` |
| `ffmpeg_utils.py:1624` | `unique_output_name` calls `check_output_name` **first**, then applies its existing `_1`, `_2` … uniqueness loop |
| `ffmpeg_utils.py:1018` | `preview_cache_key(path, mtime)` now takes a path and folds a 10-hex-digit SHA-1 of `os.path.realpath(dirname)` into the key |
| `ffmpeg_utils.py:1044` | `prune_preview_cache` builds its live set from each file's **own** directory, so the sweeper and the writer still agree |
| `app.py:500` | `_save_export_settings` writes `.export_settings.json.<pid>.tmp` then `os.replace`s it; any failure removes the temp and re-raises |
| `app.py:910` | `POST /api/export_settings` refuses an export directory that `os.path.realpath`s to `input/` |
| `app.py:1047` | `POST /api/trim` returns 400 when `start` is at or past a known source duration, naming the duration |
| `app.py:1279` | the A1 bed loop raises when an untrimmed bed's reach is `<= 0`, naming the clip and the file |
| `app.py:719` | `browse_directory` passes the path as **`item 1 of argv`** to an `on run argv` handler instead of interpolating it into the script text |
| `app.py:830` | `POST /api/rename_file` refuses a name whose stem sanitizes away, saying what a name needs, instead of storing `mp4.mp4` |
| `app.py:336` | `POST /api/clear_input` creates `input/` before listing it, so a fresh clone gets `200 {"removed": []}` rather than a 500 |
| `app.py:2314` `_derive_name` | a derived name whose extension is not renderable becomes `.mp4` |
| `app.py` × 7 | every export writer now goes through `fu.unique_output_name` inside `try/except fu.PathError → 400`: trim `:1052`, splice `:1131`, `render_timeline` `:1775`, `render_a1` `:2053` (with `allowed=(".wav",)`), reformat `:2143`, hold-frame `:2211`, reverse `:2288`. `render_timeline` and reformat had their own inline uniqueness loops; those are gone |
| `.gitignore` | `.export_settings.json` → `.export_settings.json*`, and `git rm --cached .export_settings.json` untracked the file (the working copy is left alone) |
| `OutputPanel.jsx:82`, `:120`, `:134` | `probeSeqRef.current++` in the three places the panel empties itself — `handleDelete`, the `files.length === 0` branch, `handleClear` |
| `useTimelinePlayback.js:62`, `:178`, `:193`, `:241`, `:300-322` | an `ended` listener armed for the life of each native driver calls `step()`, `step` treats an ended element as "not inside the body", and `cancelLoops` disarms it through its own `endedCleanupRef` slot |

#### Reasoning

**Why one shared name gate rather than a check per route.** Seven routes write into the export bin and
each had its own idea of what a name is — two had inline copies of the uniqueness loop, one accepted
whatever `_derive_name` produced. A gate inside `unique_output_name` catches all seven by
construction, including any added later, because a writer that skips it has no name to write to. It
lives in `ffmpeg_utils` next to `PathError` and the other path helpers, not in `app.py`, so the rule
travels with the module that owns paths.

**Why an extension allowlist rather than sanitizing the name.** Silently rewriting `8/25 hero cut`
into `8_25 hero cut.mp4` would hand the user a file they did not name, which is the same class of
defect as `mp4.mp4` below. A 400 that says *why* leaves the naming decision with the person doing the
naming. Spaces, unicode and long names are still accepted — the gate only refuses a name that is not
a filename at all, or whose container cannot be written.

**Why `.webm` is excluded from writing but not from reading.** Every render path encodes through
`encode_args`, which emits H.264/HEVC video and AAC audio, and the WebM muxer accepts none of them —
so a `.webm` output was always a 500 ("Nothing was written into output file"). The alternative,
teaching `encode_args` VP9/Opus, is a new feature with its own quality modes, size targets and
verification, not a sharp edge. Reading stays wide: a `.webm` source imports, probes, previews and
renders (to `.mp4`) exactly as before, which is what the extension was in `ALLOWED_EXTENSIONS` for.

**Why the settings file is temp + `os.replace` and what that does *not* buy.** `os.replace` is atomic
within a directory, so a crash mid-write can no longer leave a truncated file that resets the export
directory, the quality mode and every saved preset. It does **not** make concurrent saves safe: two
savers still race, and the loser's update is still lost. It only guarantees that whoever loses leaves
a *valid earlier state* behind instead of rubble. Locking would be the fix for the update loss, and
this app has one user and one settings dialog; the docstring says so rather than implying more than
the change delivers. The `except` is `Exception`, not `OSError`, because `json.dump` raises
`TypeError` on a value it cannot serialize — measured, after a first attempt left the temp file
behind.

**Why the preview key hashes the directory instead of storing the full path.** A key is a filename, so
it cannot contain `/`; the options were a hash or a flattened path, and a flattened absolute path in a
filename is both unbounded in length and unreadable. Ten hex digits of SHA-1 over the *realpath* of
the directory keeps entries recognisable (`same.mov.7c1a3f9e02.1756…preview.mp4`) and makes two
directories that are the same directory through a symlink share one entry, which is correct. Cost,
stated plainly: every entry written before 0.44.0 matches no key any request can now produce, so the
first sweep deletes all of them — one re-transcode per file that is still previewed, once.

**Why the AppleScript takes an argument rather than escaped quotes.** Escaping is a rule you have to
re-apply correctly at every call site forever; `osascript -e SCRIPT ARG` delivers `ARG` to
`on run argv` as *data* that the interpreter never parses. It also fixes the ordinary case the
injection framing obscures — a folder named `Bob"s footage` now opens the picker instead of failing
with `-2741`.

**Why rename refuses instead of transliterating.** The app can only store ASCII filenames
(`secure_filename` NFKD-normalizes and drops what is left), so there are three options: store
`mp4.mp4`, transliterate to something the user did not type, or say what a name needs here. The first
is what it did and is indefensible. The second is the silent-substitution class again. So: a 400
naming the requirement — "a name needs at least one Latin letter, digit, dash or underscore before its
extension" — and the user renames it themselves. The stem is checked with an explicit
`MEDIA_EXTENSIONS` suffix strip rather than `os.path.splitext`, because `os.path.splitext(".mp4")`
returns `('.mp4', '')`, which made a first attempt still accept `.mp4` and store it as `mp4.mp4`.

**Why 120s for `probe()`.** It is far longer than any real probe (0.09 s for the test media here,
under 2 s for the largest file on this machine) and far shorter than a wedged request that never
returns. The point of the number is that one exists.

**Why the playback fix is an `ended` listener and not a wider `EPS_SRC`.** `EPS_SRC = 0.04` is one
frame at 30 fps. A 2.000 s @24 fps file presents its last frame at 1.9583 s, so the hand-off condition
(`≥ 1.96`) is never met, `step` asks for one more frame, and the element fires `ended` instead —
playhead frozen mid-timeline, engine still "playing", nothing said. Widening the tolerance to cover 24
fps would cut a frame off every 30 fps clip, and no fixed tolerance covers every frame rate (25 fps
lands at 1.96 exactly). `ended` is the one signal that means "no more frames are coming" at *any*
frame rate, so it drives the hand-off, and `step` re-decides the boundary from the element's own clock
exactly as it would have on the frame that never arrived. The listener gets its own `endedCleanupRef`
slot because `listenerCleanupRef` holds short-lived listeners that are cleared the moment they fire,
while this one has to stay armed for the whole driver; `cancelLoops` disarms it, so at most one is
ever attached (measured).

**Why the Export Bin bumps the probe ticket rather than aborting the request.** #10 added the sequence
ref for the click race and deliberately left the emptying paths alone. Bumping it is the same
mechanism, one token per site, and it makes the panel's rule uniform: *the newest ticket wins*. An
`AbortController` would mean threading a controller through `api.js` for every caller — a wider
change, for a request that costs nothing to let finish and ignore.

#### Observations

- **Left as found: chat-produced files under a custom export directory (row 7).** `/api/chat` and
  `/api/execute` write to `fu.OUTPUT_DIR` because that is the write-permission boundary
  (`fu._media_path_ok`), not a display preference. Pointing them at `get_output_dir()` would widen
  where the chat sandbox may write, which is a behaviour change with its own security argument — out
  of scope for a sharp-edges pass. The row's own analysis stands: nothing that worked stopped working.
- **`café.mp4` is still accepted and still stored as `cafe.mp4`.** That is the same silent
  substitution the rename fix objects to, and it is deliberately untouched: it is upload's documented
  behaviour after #12, the result is a legible name the user asked for, and changing it would refuse
  files that import correctly today.
- **`withDefaultExt` (`frontend/src/renderNames.js`) appends `.mp4` only when the typed name contains
  no dot at all**, so `my.video` reaches the server as `my.video` and is now refused by the new gate
  (before this pass it produced a file with no usable extension). Worth a UI hint one day; not
  changed here.
- **The `files.length === 0` branch clears `selectedName` and `info` but does not clear the
  `<video>`'s `src`** — `handleDelete` and `handleClear` both call `removeAttribute('src')`, that
  branch does not. So when the Export Bin empties from *outside* the panel, the player keeps the last
  preview loaded under an empty list. Pre-existing, unchanged by this pass, visible in the R14c
  harness output below (`video_src: /output/b.mp4` in both engines).
- **`os.path.join(base, absolute)` discards `base` entirely**, which is why the output-name gate
  refuses anything that is not a bare basename rather than trying to re-root it.
- `probe()` was, as #7 recorded, the last spawn site in the repo without a `timeout=`. It now has one,
  so that statement is retired.

#### Verification

Scratch instance under `.venv/bin/python3`, `PROJECT_ROOT` of its own, real media.

**Output names — every route, before and after.** `8/25 hero cut.mp4`, `../escape.mp4`, `x.webm`,
`.`, `..`, `""` and `noext` all return **400** with an actionable message, and nothing is written
outside the export bin (checked by listing the bin's parent). Before the change, `8/25 hero cut.mp4`
returned **200** and left the render in `<export>/8/25 hero cut.mp4`, invisible to the Bin.

```
trim            8/25 hero cut.mp4  ->  400  output name must be a filename, not a path
splice          ../escape.mp4      ->  400  output name must be a filename, not a path
render_timeline out.webm           ->  400  output name must end in .mp4, .mov, .mkv, .avi, .m4v, .wav
render_a1       out.mp3            ->  400  output name must end in .wav
reformat        ..                 ->  400  output name must be a filename, not a path
hold_frame      (empty)            ->  400  output name is required
reverse         noext              ->  400  output name must end in .mp4, ...
```

**Nothing that worked stopped working.** All seven routes 200 on ordinary names; a name with spaces is
preserved verbatim; `.mov` is honoured; the `_1` duplicate suffix still appears; a `.webm` *source*
imports, probes, previews and renders to `.mp4` (the first time that has worked).

**The other backend rows, each by running:**

```
POST /api/trim   start=900 on a 3.000s file   -> 400  start (900) is at or past the end of v.mp4, which is 3.000s long
POST /api/export_settings  output_dir=input/  -> 400  the export directory cannot be the source folder (input/)
POST /api/render_timeline  bed with no audio duration -> 400  A1 clip 1 (silent.mp4): no audio duration could be read
POST /api/render_a1        same bed                   -> 400  (same message; a real bed still renders)
POST /api/clear_input      with input/ deleted -> 200  {"removed": []}
POST /api/rename_file      видео.mp4  -> 400  'видео.mp4' cannot be used as a filename here — a name needs at
                                              least one Latin letter, digit, dash or underscore before its extension
POST /api/rename_file      .mp4       -> 400  (same); café.mp4 -> 200, stored as cafe.mp4 (knowingly unchanged)
probe()  with the bound forced to 1s  -> RuntimeError: ffprobe did not respond within 1 seconds for big.mov
probe()  normal call                  -> 0.09s
```

**Settings file.** A save interrupted by an injected exception mid-write left the previous file intact
— export dir, quality mode and all three saved presets still readable — and **no temp files left**.
`git ls-files .export_settings.json` is now empty while the working copy is untouched.

**Preview cache.** Two different ProRes files both named `same.mov`, one in `input/` and one in the
export bin, with the same whole-second mtime: before, **one** entry served both (a 6,281-byte preview
of the wrong video for one of them); after, **two** entries, 6,281 and 2,484 bytes, each the right
video. The sweep still removes stranded and legacy-format entries and nothing live (it runs on a cache
*miss*, per #13 — a hit deliberately does not sweep, which is why an earlier test looked like a
failure).

**AppleScript.** Real `osascript` on the valid path opens a picker and blocks in this environment, so
the proof is compile-time: `Bob"s footage` produced **`-2741`** (syntax error) before the change and
compiles cleanly after, as do a path containing `\` and one containing a newline.

**Frame-hash verification** (the standard procedure, since the render pipeline's writers all changed):
105 rendered frames — a 1 s head hold, a 60-frame reversed body, a 0.5 s tail hold — and **every frame
hash equals its expected source frame's hash**.

**Playback stall (row 13), the real hook under node.** `useTimelinePlayback.js` was copied with only
its two `import` lines re-pointed (at a hooks stub and at the real `clipMath.js`; `diff` confirms
nothing else differs) and driven by a fake `<video>` that stops presenting frames at the last frame a
2.000 s file has and then fires `ended`. The A/B pair differs by *exactly* #14's change, nothing else:

```
############ 24 fps, clip out at 2.000s (the finding's case)
  no14   file_last_frame_at=1.9583s  frames= 47 ended=1 playing=True  pos=1.9167 selected=a
         -> STALLED mid-timeline, engine still "playing"
  after  file_last_frame_at=1.9583s  frames= 94 ended=2 playing=False pos=4      selected=a,b
         -> ran to the end of the timeline and stopped
############ 30 fps (EPS_SRC's own frame rate) — must be unchanged
  no14   file_last_frame_at=1.9667s  frames=118 ended=0 playing=False pos=4      selected=a,b   -> ran to the end
  after  file_last_frame_at=1.9667s  frames=118 ended=0 playing=False pos=4      selected=a,b   -> ran to the end
############ 25 fps — must be unchanged
  no14   file_last_frame_at=1.9600s  frames= 98 ended=0 playing=False pos=4      selected=a,b   -> ran to the end
  after  file_last_frame_at=1.9600s  frames= 98 ended=0 playing=False pos=4      selected=a,b   -> ran to the end
############ 24 fps, clip trimmed to 1.5s of a 2.0s file (the ordinary case) — must be unchanged
  no14   frames= 72 ended=0 playing=False pos=3 selected=a,b   -> ran to the end
  after  frames= 72 ended=0 playing=False pos=3 selected=a,b   -> ran to the end
```

`ended_listeners_left: 0` after every run, `max_ended_listeners_at_once: 1` — the backstop is disarmed
by `cancelLoops` and never accumulates.

**Late probe (row 14), the real component under node.** `OutputPanel.jsx` was bundled from source with
`react` and the JSX factory aliased to inert stubs (children are never invoked), against the real
`api.js` over a `fetch` the harness holds open; the harness fires the component's own handlers off the
tree it returned and reads back what a user would see. The A/B bundle differs by exactly the three
ticket bumps. In every case the stale reply lands while the file-list prop is still the old one, which
is the window the race lives in (the parent refetches `/api/outputs` only after `onCleared`):

```
                                    WITHOUT the bumps                    WITH them
R14a  Delete the selected export while its own probe is on the wire
  after Delete           panel empty                            panel empty
  stale probe lands      highlighted=newest.mp4 info=newest.mp4  highlighted=null info=null
                         video=/output/newest.mp4               video=null
                         => GHOST: showing a file gone from disk  => stale reply dropped
R14b  Clear the Export Bin while a probe is on the wire
  stale probe lands      highlighted=a.mp4 info=a.mp4            all null
                         => GHOST                                 => stale reply dropped
R14c  The list goes empty from outside mid-probe
  stale probe lands      highlighted=null info=a.mp4             info=null download=null
                         download=a.mp4 video=/output/a.mp4      video=/output/b.mp4 (see Observations)
                         => GHOST                                 => stale reply dropped
```

**Tool chain.** `npx vite build` clean (72 modules, 118 ms); `npm run lint` exit 0 with the same 7
pre-existing warnings as before the change.

---

## 15. HIGH — The documented launch command stops the server at boot, before any render

**Status:** FIXED — 2026-08-26, shipped in 0.31.1 (see Resolution below)
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

### Resolution — fixed 2026-08-26, shipped in 0.31.1

Option 1, as recommended above.

#### Changes made

1. **`agentic_installation.MD:209`** — the Flask launch line becomes
   `source .venv/bin/activate && nohup python3 app.py < /dev/null > /tmp/flask_dev.log 2>&1 &`,
   plus a "Notes that matter" bullet saying the redirect is required and why, so nobody tidies it away.
2. **`.claude/skills/run-app/SKILL.md:24`** — the same one-token change, with the same warning in
   short form.
3. **`ffmpeg_utils.py:949-953`** (`run_ffmpeg` docstring) and **`.claude/docs/gotchas.md:42`** — both
   asserted that the launch *this project documents* leaves fd 0 on the tty. That sentence became
   false the moment change 1 landed, so both were narrowed to "a hand-typed `nohup … &`" with a
   pointer to the docs' `< /dev/null`. The #7 rationale is untouched and still stands: users can type
   whatever they like, so `run_ffmpeg` still needs its own defense.

The `nohup npm run dev … &` lines in both docs were **deliberately left alone** — see Verification.

#### Reasoning

`< /dev/null` fixes this at the actual precondition rather than around it. `ensure_echo_on` returns
at `_reloader.py:421-422` when `sys.stdin.isatty()` is false, so with stdin on `/dev/null` the
termios code is never reached at all — there is no tty to touch, no SIGTTOU, nothing to be stopped
by. It is one token, it changes no code, and it fixes the command a person actually copies.

Options 2 and 3 were left on the table on purpose. Option 3 (`use_reloader=False`) removes live
reload, a real workflow loss for a fix to a launch line. Option 2 (redirect stdin inside `app.py`)
is the app second-guessing its own terminal, and it is only worth adding if launching from Terminal
is meant to be supported for non-developers — a product decision, not a bug fix. Worth noting the
two are not equivalent in coverage: option 1 protects the documented command, option 2 would also
protect a user who types their own `nohup python3 app.py &`. If that case matters, option 2 is still
open and this fix does not conflict with it.

#### Observations

- **The entry above is incomplete on the mechanism, and this is the correction that matters.** It
  reads as though a background process group on a tty is sufficient. It is not — there are **three**
  preconditions, and the third was missed: `ensure_echo_on` only calls `tcsetattr` **if ECHO is
  already off** (`_reloader.py:431`). With ECHO on, `tcgetattr` succeeds, the `if` is false, and
  nothing is written to the terminal, so the server boots normally *even in a background group*. I
  measured exactly that: the documented line with ECHO **on** → HTTP 200, all processes `SN`. What
  supplies the third condition in real life is the interactive shell itself: zsh's line editor holds
  the tty in no-echo mode while it sits at the prompt, so a job backgrounded from a prompt is
  reliably launched into an echo-off terminal. That is why the original bisection (which used an
  interactive zsh) reproduced it every time, and why a script-mode shell — which leaves ECHO on —
  does not. Anyone re-testing this must set the echo state deliberately or they will get a false
  clean bill of health.
- **Vite does not have this bug, tested rather than assumed.** Both docs also background
  `npm run dev` with stdin left on the tty, and Vite binds stdin for its `h`/`r` keyboard shortcuts,
  which made it a plausible second instance of the same defect. It is not: `npm run dev` in the same
  background-group-on-a-tty position served HTTP 200 with `npm` and `node` both in `STAT S`, in
  **both** echo states. So the fix is one line per doc, not two, and the frontend instructions were
  left unchanged.
- **`README.txt` was already safe and needed no edit.** Its start-up instructions (`:170`, `:174`)
  run `python3 app.py` in the **foreground** with no `&`, which makes the process group the
  terminal's foreground group — `tcsetattr` is then perfectly legal. The human-facing doc had the
  right shape all along; only the two backgrounded, agent-facing launch lines were exposed.
- This is a **werkzeug/debug-mode** defect, not a Flask-app one: it needs `debug=True` *and* the
  reloader. `use_reloader=False` boots fine, `debug=False` boots fine. It therefore cannot affect any
  future packaged build that runs without the reloader.
- The stop is silent in the worst way — `nohup`'s log holds only the two normal banner lines, exit
  status is nothing (the process is stopped, not dead), and `lsof -ti :5001` is empty. zsh does print
  `you have suspended jobs` on exit, which is the only clue, and it appears long after the fact.

#### Verification

All four arms run inside a real pty (`pty.fork()`), with the launched job in a genuine background
process group — asserted from `ps`, not assumed (`PGID 12088 != SHELL_TPGID 12075`) — and with the
ECHO state set explicitly so the third precondition is controlled rather than inherited. Harness:
`/tmp/g15arm.py --arm <arm> --echo on|off`. The backend arms ran against a **scratch copy** on port
5099 (`/tmp/g15`, `.venv` symlinked, `port=5001` → `5099`); the real server on 5001 was never
touched. The Vite arms ran the real `frontend/` on port **5199** via `--strictPort`, so the user's
own 5173 session was left alone.

| arm | command | echo | result |
|---|---|---|---|
| `flask-doc` | documented line, as it was | **off** | **DEAD** — HTTP 000; all 4 Python processes `TN`; zsh: `you have suspended jobs` |
| `flask-fix` | `< /dev/null` added | **off** | **SERVES** — HTTP **200**; all 4 processes `SN` |
| `flask-doc` | documented line, as it was | on | SERVES — HTTP 200, `SN` — *the control that isolates ECHO as the third precondition* |
| `vite-doc` | `nohup npm run dev … &` | **off** | SERVES — HTTP 200; `npm` + `node` both `SN` |
| `vite-doc` | `nohup npm run dev … &` | on | SERVES — HTTP 200; `SN` |

The `flask-fix` command string is byte-identical to the line now in both docs, so what was tested is
what shipped. Bisection from the original finding still holds and was re-confirmed: `use_reloader=False`
→ serves, `debug=False` → serves, shipped `app.py` → stopped.

Two dead ends worth recording so nobody repeats them: an interactive-zsh pty harness (`zsh -i`) is
unusable for this — the line editor's bracketed-paste and prompt escapes swallow scripted input, and
the run wedges with no output. And a script-mode harness (`zsh -f script.sh`) runs fine but leaves
ECHO **on**, which silently turns the gate into a false pass. The working shape is script-mode plus an
explicit `tcsetattr` clearing `ECHO` on the pty before exec.

Cleanup: scratch instance killed, `/tmp/g15` and the port-5199 Vite removed, ports 5099/5199 clear,
`input/` 54 / `output/` 13 / `projects/` 7 unchanged, and the user's own server on 5001 untouched
throughout.

---

## 16. HIGH — The Agent tab can overwrite source media in `input/`

**Status:** FIXED — 2026-08-26, shipped in 0.32.0 (see Resolution below)
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

### Resolution — fixed 2026-08-26, shipped in 0.32.0

#### Changes made

Both in `ffmpeg_utils.py`, both inside the validator. No route changed, no behavior added.

1. **`_in_input_dir(p)`** — new 6-line helper beside `_media_path_ok`, resolving a path exactly the
   way `_media_path_ok` does so the two cannot disagree about what a path means. Compares
   **case-insensitively**; see Reasoning.
2. **`validate_ffmpeg_command`** — a new loop after the existing `_media_path_ok` pass: a path that
   resolves inside `input/` is legal **only** as an `-i` value. Anything else that looks like a path
   and lands in `input/` is rejected with `cannot write to input/: <path> — source files are never
   modified; write to output/ instead`, returned as the route's normal **400**.
3. **`CHANGELOG.md`, the 0.31.0 entry** — it told users ffmpeg's overwrite refusal "is what keeps a
   file in `input/` from being replaced, and that still holds". That is false, and this finding is the
   proof. Corrected in place with a pointer to 0.32.0, and 0.32.0's own entry says plainly that source
   files were never actually protected before. The identical false claim had already been caught and
   removed from `/api/execute`'s code comment during #7.

#### Reasoning

**The rule is "input/ only after `-i`", not "the output must not be in input/".** Inverting it that
way is what makes the fix small and hard to slip past. Identifying which positionals are *outputs*
in an ffmpeg command needs an option table — with only the "predecessor is not a flag" heuristic,
`-y -i a.mp4 -an out.mp4` reads `out.mp4` as the value of `-an`, so any such guard has holes by
construction. Asking the opposite question needs no parse at all: the sole legitimate reason for an
`input/` path to appear is as an input, and inputs are unambiguous because `-i` immediately precedes
them. That single rule covers `-y`, `-n` and the bare form together, covers positions nobody
enumerated, and cost 5 lines.

**Checking every token, not just `argv[-1]`, is required for the fix to hold at all** — this is
#14's "only checks the last output" row, and it is not a separable follow-up here. ffmpeg writes
*every* output it is given, and `-y -i input/a.mp4 -c copy input/victim.mp4 -f null -` puts the
victim in the middle where nothing ever looked. Measured before the fix: **HTTP 200**. Leaving that
in place would have shipped a guard with a one-token bypass.

**Filter expressions needed no exemption, which I expected to need and verified I didn't.** My first
draft skipped tokens containing `=` to protect `-vf scale=320:-2` and `movie=input/b.mp4[m];...`.
That exemption is not just unnecessary but harmful: it would have let `input/vic=tim.mp4` through as
an output. It is unnecessary because a filter expression is *one token* — joined onto `PROJECT_ROOT`,
`movie=input/b.mp4[m];[0:v][m]hstack` does not resolve inside `input/`, so it never trips the check.
Confirmed by running the `movie=` case (A7) both before and after: 200 both times. Dropping the
exemption made the rule simultaneously simpler and stricter.

**`-y` was deliberately not blocked.** Denylisting it would be the obvious move and it is the wrong
one: `-y` into `output/` is legitimate and useful, blocking it removes working behavior, and it
misses the bare and `-n` forms of the same write. Guarding the destination covers every form.

#### Observations

- **My own first fix had a real hole, found by adversarially attacking it rather than by re-reading
  it: macOS case-insensitivity.** `realpath` does **not** canonicalise case, and APFS is
  case-insensitive by default, so `INPUT/victim.mp4` opens exactly the file `input/victim.mp4` does
  while failing a case-sensitive `startswith`. As a *middle* positional it wrote straight through the
  first version of the guard — HTTP 200, source md5 changed. Fixed by lowercasing both sides in
  `_in_input_dir`. Worth noting it only worked from a middle positional: the same trick as the final
  argument was caught by the pre-existing `_media_path_ok` as "path outside input/output", so the two
  defects had to combine to be exploitable, which is exactly why neither showed up alone.
- **`_media_path_ok` is case-blind in the same way, and was left alone on purpose.** There the blind
  spot fails *safe* — `INPUT/x.mp4` is read as "outside input/output" and rejected — so making it
  case-insensitive would only *accept* more paths than today. That is a behavior expansion, not a fix.
- **`_output_arg_info` (`app.py:1993-1994`) still has a `dir: "input"` branch** that reports a
  successful write into `input/` back to the frontend so it can offer to load it onto the timeline.
  With this fix, no write can reach it. Left in place — it is inert and defensive, and removing it is
  unrelated cleanup.
- **This closes #14's `validate_ffmpeg_command` row only for `input/`.** A middle positional pointing
  somewhere else entirely — `-i input/a.mp4 -c copy /tmp/evil.mp4 -f null -` — is still unchecked,
  because only `argv[-1]` goes through `_media_path_ok`. I did not extend the containment check to
  every token: unlike the `input/` rule, that one *would* reject commands that work today (a
  `-passlogfile /tmp/...`, for instance), so it removes existing capability and needs its own decision.
  Recorded here rather than fixed, and #14's row stands.
- ffmpeg refuses `-y -i input/a.mp4 -c copy input/a.mp4` — the *same* path in and out — on its own,
  with a non-zero exit and the source intact (measured pre-fix: 500, md5 unchanged). That protection
  does **not** extend to a different file in the same directory, which is the whole finding. It is
  now rejected at validation instead, before ffmpeg is started.

#### Verification

A scratch instance on port **5098** (`/tmp/g16`, its own `input/` holding `src.mp4`, `src2.mp4`,
`victim.mp4`), reached through the real `/api/execute`. The user's server on 5001 and the real
`input/` were never test targets. Every case run pre-fix and post-fix with the *same* script, so the
baseline is measured rather than assumed: `/tmp/g16bat.sh` (regression) and `/tmp/g16adv.sh`
(adversarial, resetting `victim.mp4` and comparing md5 around every single attempt).

**Regression battery — 12 cases, `victim.mp4` md5 checked around the whole run:**

| | pre-fix | post-fix |
|---|---|---|
| R1 `-y` write into `input/` | **200, victim md5 CHANGED** `e7618b18…` → `2d017ca3…` | **400** |
| R2 same without `-y` | 500 — but only incidentally, via #7's overwrite guard | **400**, at validation |
| R3 multi-output `… input/victim.mp4 -f null -` | **200** | **400** |
| R4 absolute path into `input/` | **200** | **400** |
| R5 same file in and out | 500 (ffmpeg's own refusal), src intact | **400**, before ffmpeg starts |
| A1–A7 legitimate: normal render, two `input/` inputs, `scale=` filter, `image2` pattern output, `-y` into `output/`, `-f null -`, `movie=input/…` filter | 200 ×7 | **200 ×7** |

Post-fix: both source md5s identical to baseline, all 7 expected files in `output/`, 0 tracebacks.

**Adversarial pass — 11 naming tricks, `victim.mp4` restored and md5-compared per attempt:**
`INPUT/` and `Input/` case variants, `./input/`, `input//`, `input/../input/`, `output/../input/`,
middle positional, three outputs with the victim second, victim as both an `-i` and an output,
`VICTIM.mp4`, and a symlink in `output/` pointing back at `input/victim.mp4`. First run: **1 hole**
(`INPUT/` as a middle positional, 200, file modified). After the case fix: **11/11 refused, victim
byte-identical to baseline, 0 tracebacks.** The symlink case is caught because `_in_input_dir`
resolves through `realpath`.

Finally, the shipped module was exercised against the **real** repo's paths and real filenames
(`fu.validate_ffmpeg_command` called directly — validation only, no ffmpeg run, nothing written):
3 write-into-`input/` forms including the case variant all REJECTED, 3 legitimate forms all ACCEPTED.

Cleanup: scratch instance killed, `/tmp/g16` removed, port 5098 clear, `input/` 54 / `output/` 13 /
`projects/` 7 unchanged.

---

## 17. HIGH — Hold Frame fails on every silent source — all 27 of this machine's videos

**Status:** FIXED in 0.38.0 — re-measured first (5 of 5 quality modes failed), then fixed, then the
same script re-run. A silent source now stays silent, which was decided deliberately rather than by
default — see [Resolution](#resolution-17).
**Confidence:** VERIFIED by running, on the real installation and on a scratch instance
**Where:** `ffmpeg_utils.py:1250-1253` (`build_holdframe_filter`), `app.py:1780-1784` (`hold_frame`)

Found by #4's real-installation smoke test. Unrelated to #4 — reproduced identically on pre-fix code.

### What's wrong
`build_holdframe_filter` unconditionally references the source's audio stream:

```python
f"[0:a]atrim=start=0:end={t},asetpts=PTS-STARTPTS[a0];"
...
f"[0:a]atrim=start={t},asetpts=PTS-STARTPTS[a1];"
```

If the source has no audio stream, ffmpeg refuses the whole filtergraph:

```
Stream specifier ':a' in filtergraph description [0:v]trim=... matches no streams.
```

The route then returns a 500 whose `detail` is the tail of ffmpeg's stderr — which begins with the
**version banner**, so the UI shows the user "ffmpeg version 8.0 Copyright (c) 2000-2025…" as the
reason their hold failed (the same class of symptom as #11).

`hold_frame` even documents the assumption that makes it wrong (`app.py:1782-1784`):

> `build_holdframe_filter` always maps an `[outa]` track (original audio plus `anullsrc` silence
> during the hold), so audio is present regardless of the source's `has_audio` flag.

It forces `has_audio: True` on the info dict on that basis, so the encoder is told to expect audio
too. The `anullsrc` half is fine; the two `atrim`s of `[0:a]` are not.

**This is not an edge case on this machine.** Measured with `ffprobe -select_streams a` over
`input/`: **27 video files, 27 with no audio stream.** Hold Frame cannot succeed on any of them.
(The timeline's own head/tail/round holds are a different code path — `build_timeline_filter` — and
are not affected; this is the standalone `/api/hold_frame` route the Hold Frame panel calls.)

### How to reproduce
```bash
ffmpeg -f lavfi -i "testsrc=size=320x180:rate=25" -t 2 -c:v libx264 -qp 0 silent.mp4   # no -i audio
# put silent.mp4 in input/, then:
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"input":"silent.mp4","time":0.5,"duration":0.5}' http://127.0.0.1:5001/api/hold_frame
# -> 500  {"error":"ffmpeg failed","detail":"ffmpeg version 8.0 Copyright ... matches no streams."}
```
Any real video from this machine's `input/` reproduces it without the synthetic file.

### Fix
Branch on the source's audio the way the rest of the module already does — `get_video_info` returns
`has_audio`, and `hold_frame` has the info dict in hand before it builds the filter. When there is no
audio, emit the video half only (`[outv]`, no `[outa]`, no `anullsrc`) and drop the forced
`has_audio: True` so `encode_args` doesn't ask for an audio stream that isn't there. That means
`build_holdframe_filter` needs a `has_audio` parameter and `hold_frame` needs to map `[outa]`
conditionally — the two `-map` args and `hold_info` at `app.py:1785-1787`, plus the two-pass and
single-pass paths below it, all read from the same two values.

Worth deciding deliberately, not by default: whether a silent source should stay silent, or gain a
full silent track (`anullsrc` for the entire output) so the result concatenates cleanly with
audio-bearing clips later. The former is less surprising; the latter is what the current code was
reaching for.

**Effort:** ~15 lines across the two files. Verify against a silent source **and** an audio-bearing
one (both quality paths — `MULTIPASS_QUALITIES` and single-pass — build their args separately).

<a id="resolution-17"></a>
### Resolution — 0.38.0 (2026-08-27)

#### Re-measuring the finding first
Every claim held, on a scratch instance (port 5096, `/tmp/g17`) with two fixtures: `silent.mp4`
(`testsrc`, no audio stream) and `sound.mp4` (`testsrc2` + `sine`, h264 + aac). Baseline script
`/tmp/g17rep.sh`, output `/tmp/g17_before.txt`, re-run **unchanged** afterwards into
`/tmp/g17_after.txt`. The entry only claimed the failure; the re-measurement establishes that it is
every quality mode, not just the default:

| quality | silent source | audio-bearing source |
|---|---|---|
| `lossless` | **500** | 200, h264+aac |
| `match` | **500** | 200, h264+aac |
| `high` | **500** | 200, h264+aac |
| `under50mb` (two-pass) | **500** | 200, h264+aac |
| `under50mb_hevc` (two-pass) | **500** | 200, hevc+aac |

5 of 5 modes fail on silence; 5 of 5 succeed with audio. The `detail` opens with
`ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers` exactly as the entry describes,
and ends with `...concat=n=3:v=0:a=1[outa];[outv_pre]format=yuv420p10le[outv] matches no streams.
Error binding filtergraph inputs/outputs: Invalid argument`.

#### The decision the entry asked to be made deliberately
**A silent source stays silent** — no audio stream in the output at all. Chosen with the user rather
than by default, because it changes what the exported file contains. The reasons it beats a
full-output `anullsrc`:
- It matches `/api/trim` and `/api/reverse`, the other **single-source** routes, both of which pass
  the probed `info` straight to `encode_args` and so preserve the source's stream layout.
  `/api/splice`'s forced `has_audio: True` — which is what the broken code was imitating — is a
  *multi-input* necessity: `concat` needs every input to present the same streams, which is why
  `build_concat_filter` synthesizes `anullsrc` per silent input. A one-input freeze has no such
  constraint.
- Nothing downstream needs the track. `build_timeline_filter` already synthesizes `anullsrc` for any
  clip whose `has_audio` is false, so a silent hold output re-imported as a clip source still
  concatenates against audio-bearing clips.
- It suits this machine's material: the 27 sources are silent by design, with their sound in sibling
  `.wav` files that ride on A1.

#### Changes made

**`ffmpeg_utils.py`** — `build_holdframe_filter` gained a **required** fourth positional parameter
`has_audio` (before the `sample_rate`/`channel_layout` keyword defaults, the same shape
`build_concat_filter` already uses for its `has_audio_flags`). The video chains were extracted into a
local `video` string; when `has_audio` is false that string is returned as-is, and when it is true the
four audio chains are appended to it exactly as before. The docstring records why `[0:a]` on a
stream-less source is fatal to the *whole* graph rather than just its audio half.

**`app.py`** `hold_frame` — three edits:
- `fu.build_holdframe_filter(t, dur, fps, info["has_audio"])`.
- `hold_info = {**info, "has_audio": True}` **deleted**; the two places that consumed it
  (`multipass_export_render` and `encode_args`) now take the probed `info` unchanged, so
  `fu.audio_args` emits `-an` for a silent source and its existing AAC args for an audio-bearing one.
- `-map "[outa]"` moved behind `if info["has_audio"]`, so no label is mapped that the graph did not
  define.
- The comment that asserted the opposite ("always maps an `[outa]` track … so audio is present
  regardless of the source's `has_audio` flag") replaced with one that states the actual contract.

No frontend file, no other route, and no encoder argument changed.

#### Reasoning
- **`has_audio` is required rather than defaulted**, following #4's `unique_output_name(export_dir)`
  precedent. A default of `True` reproduces this exact bug for the next caller, and — unlike a wrong
  directory, which merely misplaces a file — a wrong value here fails the render outright. Verified:
  a three-argument call raises `TypeError: build_holdframe_filter() missing 1 required positional
  argument: 'has_audio'`.
- **The video chains were extracted to a local rather than duplicated across two return statements.**
  It is what makes "the video half is byte-identical whether or not there is audio" a property of the
  code instead of a claim needing a test — though it was tested anyway (60/60 below).
- **`hold_info` was deleted, not corrected to `{**info, "has_audio": info["has_audio"]}`.** That
  would have been a no-op wrapper around the value it already had, and the whole purpose of the dict
  was the override being removed.
- **`_inject_pixel_format` needed nothing**, which is worth stating because it is the one shared
  helper this graph passes through on the two-pass 10-bit path. It keys on `[outv]` alone and is
  indifferent to `[outa]`; its own docstring already promised only that "every filter builder in this
  module terminates its video chain with the literal label `[outv]`", which the video-only graph still
  does. Confirmed by running it against a video-only graph.

#### Observations
- **The entry misattributes the caller, and it matters for how the severity reads.** It says "the
  standalone `/api/hold_frame` route the Hold Frame panel calls". The React Hold Frame panel does
  **not** call it: `HoldFrameForm.jsx` only sets `headHoldSec`/`tailHoldSec` on a clip, which renders
  through `build_timeline_filter`. A repo-wide grep finds exactly one caller —
  `static/app.js:307`, the **feature-frozen legacy UI** at `127.0.0.1:5001` — plus direct API use.
  So the practical blast radius is the fallback interface, not the main app. The route was still
  wholly broken for 27 of this machine's 30 videos and the fix stands on its own; but "Hold Frame is
  broken" would read to a user of the React UI as something they can see, and it is not.
- **`input/` is no longer 27-for-27 silent.** It now holds 30 videos: the same 27 silent sources plus
  3 audio-bearing files (`Batch_01_V002_r01.mp4`, `_r02.mp4`, `_r02_1787867337.mp4`) the user has
  copied back in since the audit was written. That is what allowed the no-regression half of the
  verification to run on **their own** media rather than only on a fixture.
- **One source frame is dropped at the freeze boundary.** A 2 s / 25 fps source with a 0.5 s hold
  yields 61 frames where 62 is the arithmetic — the frame at the `t_end` boundary satisfies neither
  `trim=end=t` nor `trim=start=t_end`. **Pre-existing and untouched**: the video half of the graph is
  byte-identical before and after this fix (proven below), so this is out of scope and is logged
  rather than fixed. It is also the reason a hold's output is one frame shorter than
  `source + duration` would predict — worth knowing before anyone treats that as a new defect.
- **The freeze cannot be verified by frame hash on a lossy mode**, and an early attempt to do so on
  the `under50mb_hevc` output was misleading (runs of 2–3 identical frames instead of the expected
  12). The frozen frames are identical *going in* and are re-encoded independently coming out. The
  frame-hash proof is therefore taken from the `lossless` mode, where the run is exact.
- **The 500 only appears with a real ffmpeg**, so the argv-capture harness below reports 200 for the
  pre-fix silent cases — its `run_ffmpeg_staged` stub always returns rc 0. The failure evidence is
  the end-to-end run; the harness's job is only to compare command lines.

#### Verification

**A. Unit level, `build_holdframe_filter` over 60 shapes** (t ∈ {0, 0.5, 1.0, 2.375} × dur ∈ {0.04,
0.5, 3.0} × fps ∈ {24, 25, 29.97, 30, 60}):
- `has_audio=True`: **60/60 byte-identical** to the pre-fix builder (the old body pasted into the test
  verbatim, not paraphrased).
- `has_audio=False`: 60/60 contain no `[0:a]`, no `[outa]` and no `anullsrc`, end at
  `concat=n=3:v=1:a=0[outv]`, and equal the audio version's video half exactly.
- 3-argument call → `TypeError`; `fu.audio_args({"has_audio": False})` → `['-an']`;
  `_inject_pixel_format` on a video-only graph → `...[outv_pre];[outv_pre]format=yuv420p10le[outv]`
  with `-map [outv]` intact.

**B. Argv-level A/B across all 5 quality modes × both sources.** `/tmp/g17old` holds a copy of the
code with **only** this change reverted, and `/tmp/g17argv.py` drives both copies through the Flask
test client with the ffmpeg spawn stubbed, capturing the exact command each would run (scratch root
normalized out of the paths):

| case | pre-fix vs post-fix argv |
|---|---|
| `lossless` / `match` / `high` / `under50mb` / `under50mb_hevc`, **audio-bearing** | **IDENTICAL, all 5** |
| the same 5 modes, **silent** | differ by exactly three things: the four audio chains gone from the graph, `-map [outa]` gone, and the AAC args (`-c:a aac -b:a 192000 -ar 44100 -ac 2`) replaced by `-an` |

Nothing else moved in any of the ten command lines — which is the statement that audio-bearing holds
render byte-for-byte the file 0.37.0 rendered.

**C. End-to-end, the finding's own script re-run unchanged** (`/tmp/g17rep.sh`):

| quality | silent: before → after | audio-bearing: before → after |
|---|---|---|
| `lossless` | 500 → **200, video only** | 200 → 200, video+audio |
| `match` | 500 → **200, video only** | 200 → 200, video+audio |
| `high` | 500 → **200, video only** | 200 → 200, video+audio |
| `under50mb` | 500 → **200, video only** | 200 → 200, video+audio |
| `under50mb_hevc` | 500 → **200, video only** | 200 → 200, video+audio |

10 of 10 succeed; 0 leftover `.partials`, `.ffpass*` or `.part*` files; 0 zero-byte files. Silent and
audio-bearing outputs carry the **same 61 video frames at the same 2.440000 s** — the audio case's
larger *container* duration (2.520000 s) is its AAC tail, pre-existing and unrelated.

**D. Frame level (`lossless`, where hashes are meaningful).** Both outputs contain a run of **12
consecutive identical frames** — the freeze — in sources whose every frame otherwise differs, and
both are 61 frames at 25/1.

**E. Edge cases, silent source unless noted** (all through the live scratch route): `t=0` (empty
leading trim) → 61 frames, video only; the same at `t=0` with audio → 61 frames, video+audio;
`t` = last frame → 61; hold of one frame (0.04 s) → 50; hold of 10 s on a 2 s source → 299. The
guards still reject what they always did, as JSON: `t == duration` and `t < 0` → 400
`time must be within [0, 2.0)`; `duration 0` → 400 `duration must be positive`; unknown file → 404.

**F. Real installation** (port 5001, hot-reloaded to `0.38.0`, the user's **own** `under50mb_hevc`
two-pass setting left exactly as found — never written to, md5 identical before and after):
- **Silent source** `SPHE_002_0310_fg01_v001_AI-MP4.mp4` (1.583 s, the shortest in `input/`), the case
  that returned 500: **200** in 11 s, `hevc` video only, 49 frames / 2.041667 s, 25,157,760 B.
- **Audio-bearing source** `Batch_01_V002_r01.mp4` (14.04 s): **200** in 98 s, `hevc` + `aac`,
  360 frames / 15.000000 s. The hold's audio behaviour is intact and was measured rather than
  assumed — with a 1 s hold at t=3.0, `volumedetect` reads −41.0 / −44.2 / −33.9 dB before it,
  **−91.0 dB (silence floor) at 3.1 and 3.5 s**, and −47.0 / −52.0 / −49.7 dB after.
- **The exact legacy-UI payload** (`{input, time, duration}` as strings, no `output` field, which is
  what `static/app.js:307` sends): 200 → `SPHE_002_0310_fg01_v001_AI-MP4_held.mp4`, video only.
- Cleanup: all three test renders deleted; `input/` 57, `output/` 26, `projects/` 8 unchanged; 0
  `zz_g17*` files anywhere; no `.partials` directory. The 2 `.ffpass*` files and 1 zero-byte file
  that `find` reports under `output/old/` are dated 2026-08-10 and 08-13 and predate this session.

**G. Build:** `npx vite build` ✓ 71 modules, 137 ms (also the check that `VERSION` and
`frontend/package.json` agree at 0.38.0); `npm run lint` — the same 7 pre-existing warnings, none in
a file this fix touched (no frontend file was touched).

Scripts kept at `/tmp/g17rep.sh` and `/tmp/g17argv.py`; the pre-fix comparison copy at `/tmp/g17old`.

---

## 18. HIGH — The V2 lane drew SHORT of V1 even when its file was longer, so its end read frame 356

**Status:** FIXED in 0.37.0 (the reported cause). Two adjacent defects measured and deliberately
**left alone** — see *Not fixed* below.
**Confidence:** VERIFIED by measurement against the real `clipMath.js`, not by reading
**Where:** `frontend/src/clipMath.js:9` (`GAP_PX`), `frontend/src/components/Timeline/Timeline.jsx:18`
(`GAP`) + the V1/V2/ANIM lane classes + the Ruler wrapper,
`frontend/src/components/Timeline/Ruler.jsx:4-8`

Reported by the user: *"on v2 the track end in 356 but the file information says 361."*

### What's wrong
A flex `gap` **consumes width but represents zero time.** Every lane was a flex row with
`gap-0.5` (2px), so a lane's seconds→pixels scale was a function of **that lane's own clip count**:

| surface | clips | gap pixels injected | drew | should draw |
|---|---|---|---|---|
| V1 lane | 6 | 5 × 2 = **10px** | 910px | 900px (15.000s) |
| V2 lane | 1 | **0px** | 902.5px | 902.5px (15.041667s) |
| Ruler | lays out none | **0px** | ticks at `t × PPS` | — |

The three could never agree. Measured consequences, all reproduced with node against the real
module:

- **V2's right edge sat 7.5px LEFT of V1's** even though its file is one frame *longer*. The
  correct answer is 2.5px to the **right** — one frame at 60px/s and 24fps.
- `clientXToTimelinePos` subtracts the same phantom 10px back out (`clickPx -= clipPx + GAP`), so a
  click on V2's drawn right edge resolved to 14.875s = **frame 357**; 2–3px inside it, **frame 356**
  — the user's number, exactly. 10px ÷ 2.5px-per-frame = 4.0 frames, which is 100% of the error with
  nothing left over for a second cause.
- A **second, independent** origin error: the Ruler's wrapper carried the 48px gutter but *not* the
  lanes' own `px-2`, so every tick sat 8px (**3.2 frames**) left of the time the lanes and the click
  mapper put it at. `Ruler.jsx`'s `+ clips.length * 2` width term was also wrong on its own terms —
  a flex row of *n* items has *n−1* gaps, not *n*.

**The `361` itself is not a bug.** `ffprobe` on the file (read-only): video stream
`duration=15.041667`, `duration_ts=184832` ÷ 512 ticks-per-frame = **361.000**, `nb_frames=361`,
`r_frame_rate=24/1` (not `24000/1001`). The media genuinely contains 361 frames, so a 15.000s V1 and
this V2 cannot line up frame-for-frame. The app was reporting the file correctly; it was *drawing*
it wrongly.

### How to reproduce
`/tmp/v2laneproof.mjs` imports the real `clipMath.js` and asserts, over 9 clip configurations, that
each lane's drawn width equals `duration × PPS`, that the playhead is linear at 0/25/50/75/100%,
and that the A1 bed's boundaries land on V1's. **Before the fix: 33 failures**, including
`V1 lane width == 900px: got 910 want 900` and
`V2 right edge is 2.5px (1 frame) PAST V1's: got -7.5 want 2.5`. **After: ALL PASS.**

### Changes made
Seven edits, all pixel accounting. No function signature, call site, or arithmetic changed.

1. `clipMath.js:9` — `GAP_PX` 2 → **0**, with a comment recording *why* it is load-bearing. This is
   the default `gapPx` for `sequencePosToPx` and `sequenceClipBounds`, which lay out the A1 bed.
2. `Timeline.jsx:18` — `GAP = 0.5 * 4` → **0**. One line reaching all three consumers at once: the
   playhead (`timelinePosToPx`, :230), the click/drag mapper (:617), and the A1 bed (:1290).
3–5. `gap-0.5` deleted from the **V1**, **V2** and **ANIM** lane class lists.
6. `px-2` added to the Ruler's wrapper, so its ticks share the lanes' 8px content origin.
7. `Ruler.jsx` — the dead-and-wrong `+ clips.length * 2` dropped from `totalWidth`.

Plus three comments corrected to stop describing a gap that no longer exists (the fused-group
wrapper in `Timeline.jsx`, `sequencePosToPx`'s header in `clipMath.js`, and the insertion line in
`TimelineClip.jsx`, whose 2px teal line moved from `-2` to `-1` so it straddles the seam instead of
sitting in a gap that is gone).

### Reasoning
Zero is the only value of `GAP` for which `px = pos × PPS` holds on *every* surface at once. Any
non-zero value is a per-lane correction that each future consumer has to re-derive independently —
which is precisely how this defect was born; there were three consumers and they disagreed. Clips
remain visually distinct: each already carries a 2px palette border, and two adjacent borders meet
as a 4px seam that reads as a stronger boundary than the old 2px void did.

### Verification
- `/tmp/v2laneproof.mjs`: **ALL PASS** (was 33 failures). V1 lane **900.0px exact**, V2 lane
  **902.5px exact**, V2's right edge **+2.5px** past V1's — one frame, the correct answer. A click
  at V2's drawn end now reads **frame 360** instead of 356.
- `npx vite build` — ✓ built, 71 modules. `npm run lint` — no new warnings (the 7 pre-existing
  `exhaustive-deps` / `only-export-components` warnings are unchanged).
- Backend untouched: no render-path change, so no frame-hash re-verification was required.

### Not fixed — measured, reported, left to the user
Both are real and both would violate *"fix only what is broken or explicitly requested"* to change
unilaterally, because each removes or reverses documented existing behavior.

- **`MIN_CLIP_PX = 24` inflates V2 after Batch Analyzer.** `clipRenderedPx` floors every box at 24px
  for clickability, and `sequencePosToPx`/`sequenceClipBounds` honor that floor while
  `timelinePosToPx` and `clientXToTimelinePos` do not. Batch Analyzer emits the Raise round-up as a
  **separate** V2 clip; at 2 frames that segment wants 5px and draws 24, inflating V2's lane by
  **19px = 7.6 frames**. (V1 draws the same round-up as an amber sub-segment *inside* its last clip,
  so V1 is unaffected.) The floor is a deliberate clickability feature — removing it is the user's
  call. The proof harness reports these two configurations as **SKIP**, not PASS.
- **`useTimelinePlayback.js:69-74` takes the picture from V2 and the length from V1.** `segments`
  come from `source` (`displayClips ?? clips`, i.e. V2 when it exists) but `totalDuration` is summed
  from `clips` (V1). That single number drives the seek clamp (:386), the stop boundaries (:198,
  :233) and `goToEnd()` (:425), so when V2 is longer its tail frames are unreachable by any seek and
  `goToEnd()` parks on V2's frame 359. The code documents the intent — *"V1 is the timeline of
  record"* — so reversing it is a design decision about what the timeline's length **means**, not a
  bug fix.

---

## 19. MEDIUM — The documented restart command orphans a running encoder

**Status:** FIXED — 2026-08-28, shipped in 0.45.1 (see [Resolution](#resolution-19) below). Found
while re-measuring #8's shutdown half; recorded then, fixed now.
**Confidence:** VERIFIED by measurement, on both the pre-0.45.0 and post-0.45.0 code
**Where:** werkzeug `_reloader.py:275` (`subprocess.call`) + `_reloader.py:446`
(`signal(SIGTERM, lambda *a: sys.exit(0))`); triggered by `.claude/skills/run-app/SKILL.md:23`
(`lsof -ti :5001 | xargs kill`)

### What's wrong
#8's 0.39.0 fix kills live encoders when the server exits, and it works when the **worker** process
is signalled. Under `debug=True` there are two processes — the reloader monitor and the worker — and
both listen on 5001, so `lsof -ti :5001 | xargs kill` (this project's own documented way to stop the
backend, and what `pkill -f app.py` does too) signals **both**.

That is the case where the cleanup never runs. `run_with_reloader` installs
`signal(SIGTERM, lambda *a: sys.exit(0))` in the monitor as well, and the monitor is blocked in
`subprocess.call(args, ...)` — whose `except:` clause is `p.kill()`, i.e. **SIGKILL to the worker**.
The worker dies with no handler, no `atexit`, and no staging cleanup:

```
port 5095: listeners=[89221, 89225] encoder=['89249'] staged=['89225.6135984128/sd_5095_both.mp4']
SIGTERM -> [89221, 89225]
  t+ 0.0s  server_alive=True   encoder=['89249']  staged=['89225.…/sd_5095_both.mp4']
  t+ 0.3s  server_alive=False  encoder=['89249']  staged=['89225.…/sd_5095_both.mp4']   # orphaned
  t+11.9s  server_alive=False  encoder=None       staged=['89225.…/sd_5095_both.mp4']   # ran to completion
final: staged=['89225.6135984128/sd_5095_both.mp4'] committed=False
```

Identical numbers on the pre-change copy (`/tmp/g8old`, 11.9s, same leftover), so this is a limit of
0.39.0's coverage, not a regression from 0.45.0. For contrast, signalling only the worker is clean:

```
SIGTERM -> [88446]
  t+ 0.3s  server_alive=False  encoder=None  staged=None
```

Ctrl-C is also clean (SIGINT reaches the whole group and the worker unwinds normally). So the
reachable path is precisely the scripted/documented one: an orphaned encoder at full CPU plus a
staged file that nothing will ever commit or clean, left in `output/.partials/`.

### Fix
Either stop the worker first and the monitor second (a two-step in the run-app skill, `lsof -ti :5001`
sorted so the worker is signalled first, then the monitor), or make the worker's exit path
independent of how it dies — e.g. have the monitor forward SIGTERM to its child and wait, rather than
letting `subprocess.call`'s `p.kill()` be what stops it. The skill's own instructions are the cheaper
half and probably where this belongs; the staging leftover would then be cleaned by the worker's
existing handler.

**Effort:** ~10 minutes for the skill-side ordering; longer if the monitor's shutdown is reworked.

<a id="resolution-19"></a>
### Resolution — 0.45.1 (2026-08-28)

#### Re-measuring the finding first
The 0.45.0 rigs had been deleted, so this was measured from scratch: a scratch instance on port
5095 with its own root (`/tmp/g19`, `port=5001` → `5095`, launched with the repo's own
`.venv/bin/python`), a 60.0s / 255 MB 1080p `-qp 0` fixture, and a real `/api/reformat` render in
flight — encoder confirmed running and its staged file confirmed present before any signal was sent.
Harness `/tmp/h19/rig.py`. The real server on 5001 was never signalled. Five ways of stopping the
backend, all on shipped 0.45.0 code:

| what was signalled | signal | encoder afterwards | staged file |
|---|---|---|---|
| **both listeners** — the documented `lsof -ti :5001 \| xargs kill` | TERM | **orphaned**, ran 8.5s more to completion | **left** |
| **worker then monitor** — this entry's own Fix suggestion | TERM | **orphaned**, ran 4.8s more | **left** |
| monitor only | TERM | **orphaned**, ran 4.8s more | **left** |
| **worker only** | TERM | stopped by t+0.0s, log `stopped 1 running ffmpeg process on exit` | cleaned |
| both listeners | INT | stopped by t+0.0s, same log line | cleaned |

```
case=both listeners=[97022, 97027] worker=97027 monitor=[97022] encoder=['97038'] staged=['97027.…/case.mp4']
SIGTERM -> [97022, 97027]
  t+  0.0s  listening=False worker_alive=False  encoder=['97038']  staged=['97027.…/case.mp4']
  t+  8.5s  listening=False worker_alive=False  encoder=None       staged=['97027.…/case.mp4']
  t+  9.2s  FINAL listeners=[] encoder=None staged=['97027.…/case.mp4'] committed=False

case=ordered listeners=[97750, 97755] worker=97755 monitor=[97750] encoder=['97765'] staged=['97755.…/case.mp4']
SIGTERM -> [97755, 97750]                      # worker FIRST, monitor second
  t+  4.8s  listening=False worker_alive=False  encoder=None       staged=['97755.…/case.mp4']

case=worker listeners=[97242, 97247] worker=97247 monitor=[97242] encoder=['97257'] staged=['97247.…/case.mp4']
SIGTERM -> [97247]
  t+  0.0s  listening=False worker_alive=False  encoder=None       staged=None
```

So the finding reproduces exactly as recorded, and the fix this entry proposed does **not** work —
see Reasoning.

#### Changes made
Documentation only; no application code was touched. Every place the project told an operator how to
stop the backend now signals the reloader **worker** alone, identified by `WERKZEUG_RUN_MAIN=true` in
its environment:

```bash
for p in $(lsof -ti :5001); do ps -Eww -p $p | grep -q WERKZEUG_RUN_MAIN=true && kill $p; done
```

- **`.claude/skills/run-app/SKILL.md:23`** (step 2, "kill any stale backend") — command replaced, plus
  a paragraph after the block explaining why both-pids is wrong and what to do if something is still
  holding 5001 afterwards (then it is not a reloader worker, and the blunt kill is the right tool).
- **`.claude/skills/run-app/SKILL.md`, Cleanup** — same command, referred back to step 2.
- **`agentic_installation.MD`, Phase 5** — the backend line in the start block. The `:5173` Vite line
  is unchanged: Vite has no reloader monitor and no encoder to orphan.
- **`agentic_installation.MD`, the two-process note** — was *"`lsof -ti :5001 | xargs kill` handles
  both"*, which is true and is precisely the problem; it now says signal the worker only and why.
- **`agentic_installation.MD`, Stopping** and its **`Address already in use`** troubleshooting row —
  the row now points at the Stopping commands instead of carrying its own copy of the blunt kill.
- **`README.txt`**, the same troubleshooting entry — this one is for a person, not an agent, so it
  keeps the one-line `lsof -ti :5001 | xargs kill` and gains the sentence that actually helps at that
  keyboard: if the old copy is still rendering, close its browser tab first and give it a second,
  which since 0.45.0 stops the render cleanly.

#### Reasoning
- **Worker only, in one step — not the two-step this entry proposed.** Measured above: signalling the
  worker first and the monitor second still orphans the encoder. The monitor's SIGTERM handler
  (`_reloader.py:446`) calls `sys.exit(0)` immediately, which unwinds through
  `subprocess.call`'s bare `except: p.kill()` (`subprocess.py:349-355`) — SIGKILL to a worker that is
  only just starting its cleanup, and that cleanup needs up to the 2.0s grace `_stop_procs` gives
  ffmpeg. Signalling the monitor *at all* is the defect, in either order; monitor-only orphans too.
- **The second step is not needed.** `restart_with_reloader` returns as soon as the child exits with
  anything other than 3 (`_reloader.py:275-277`), so the monitor exits by itself. Measured: port free
  0.8s after the worker was signalled, and three back-to-back stop/start rounds with no
  `Address already in use`.
- **Not SIGINT to both, even though it measured clean.** It is clean by timing, not by construction:
  `Popen.wait` gives the child `_sigint_wait_secs = 0.25` (`subprocess.py:848`) before re-raising into
  the same `p.kill()`, so the worker's cleanup only completes if it finishes inside 250 ms while the
  encoder's own SIGTERM grace is 2.0s. Worker-only has no such window, and it costs the operator no
  more than SIGINT would.
- **Not a code change, because there is no code of ours that could win.** The killing signal is
  SIGKILL and it comes from werkzeug's monitor. `run_with_reloader` installs its own SIGTERM handler
  *after* `install_shutdown_handlers()` has already run, so the app cannot keep a handler in the
  monitor process; the only in-process alternatives are dropping the reloader — which #15's fix and
  the `extra_files=[VERSION_FILE]` version watch both depend on — or monkeypatching a third-party
  internal, which would silently rot on the next werkzeug bump. The reachable trigger was this
  project's own documentation, so that is where the fix belongs. Same shape as #15, also fixed by
  correcting a documented command line rather than the app.
- **The worker is identified by its environment, not by pid order.** The worker is spawned after the
  monitor and respawned on every reload, so "highest pid of the two" would usually be right — but
  macOS pids wrap at 99999 and this machine was already handing out pids in the 97000s during these
  measurements. After a wrap the newest listener has the *lowest* number and a `sort -n | tail -1`
  command would silently signal the monitor: exactly the failure it was written to prevent.
  `WERKZEUG_RUN_MAIN=true` is set by `restart_with_reloader` for the child only, and is what werkzeug
  itself uses to tell the two apart. This stopped being hypothetical during this very task — bumping
  `VERSION` restarted the real server's worker and the pid wrapped, so on 5001 right now:

  ```
  485   ppid=44065  werkzeug_run_main=1     <- the worker
  44065 ppid=8001   werkzeug_run_main=0     <- the monitor
  -- naive 'newest pid' selector would pick: 44065
  -- env-marker selector picks: 485
  ```

#### Observations
- **This entry's own Fix section was wrong** about the two-step, and about ordering being the issue at
  all. Left in place above as written, with the measurement that refutes it, because the reasoning was
  the reason the fix looked like a ten-minute job.
- **An operator-initiated stop shows up in the UI as a failed render (HTTP 500), not as a
  cancellation (499).** 0.45.0's client-disconnect path is not involved: the worker kills ffmpeg from
  `atexit`, the request thread sees ffmpeg fail, and the 500 goes out before the process exits. That
  is honest — the render really did fail — and it is what the log shows too.
- **`ps -Eww -p <pid>` shows the environment only for your own processes** on macOS. Anyone stopping
  someone else's worker (a different account, or root looking at another user's process) will not see
  the marker, the loop will kill nothing, and they will fall through to the blunt kill and the old
  behaviour. Not worth guarding for a single-user local app; recorded so it is not a surprise.
- **The monitor leaves nothing behind when it is not signalled** — port free, no stray process. In the
  harness it lingers as a zombie only because the harness is its parent and never waits on it; a real
  shell reaps it.
- **Out of scope, recorded not fixed:** nothing here helps a `kill -9` of the worker, Force Quit, or a
  crash — those still leave a staged file under `output/.partials/` (already recorded as #9's SIGKILL
  caveat). The only thing that could clean them is a startup sweep of `.partials/<pid>.<tid>`
  directories whose pid is no longer alive, next to the preview-cache prune. That is new behaviour
  rather than a repair of this finding, so it stays unbuilt.

#### Verification
The stop line was not retyped for the test — it is **read out of `SKILL.md`** by the harness and
executed as-is (only `:5001` → `:5095` for the scratch instance), so what was verified is what
shipped:

```
case=snippet listeners=[99024, 99027] worker=99027 monitor=[99024] encoder=['99038'] staged=['99027.…/case.mp4']
  doc line: for p in $(lsof -ti :5001); do ps -Eww -p $p | grep -q WERKZEUG_RUN_MAIN=true && kill $p; done; sleep 1
  zsh rc=0 out='' err=''
  t+  1.2s  listening=False worker_alive=False  encoder=None  staged=None
  t+  1.7s  FINAL listeners=[] encoder=None staged=None committed=False
  log tail: … "POST /api/reformat HTTP/1.1" 500 - | stopped 1 running ffmpeg process on exit
  cleaned: staged=None outputs=(empty)
```

Restart loop, no render running — the ordinary case the skill is actually used for:

```
round 1: stop_rc=0  api/files=200  listeners=[98178 98183]
round 2: stop_rc=0  api/files=200  listeners=[98208 98212]
round 3: stop_rc=0  api/files=200  listeners=[98231 98234]
after final stop: listeners=[]  'Address already in use' in log: 0
```

Both documented copies of the line parse under `zsh -n` **and** `bash -n` (rc=0, no stderr). Selection
was then checked against the **real installation** with a dry run that echoed instead of killing —
`would kill 92065` out of listeners `44065 92065`, i.e. the worker, not the monitor — so the shipped
line targets correctly on 5001 without the user's server being touched. Cleanup: scratch instance and
its 255 MB fixture removed (`/tmp/g19`, `/tmp/h19`), port 5095 clear, no ffmpeg processes left, and
`git status` shows only the intended files.

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
  file today; see #4 for why the two should be unified anyway. *(As of 0.36.0 the helper takes a
  required `export_dir`, so both now check the same directory; the inlined loop was deliberately
  left in place — see #4's Resolution.)*
