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
| 8 | MEDIUM | No cancellation; abandoned renders burn CPU | `app.py:1901` | VERIFIED | NOT STARTED |
| 9 | MEDIUM | Failed renders leave corrupt partials in the Export Bin | `app.py:651` | VERIFIED | **FIXED** (0.34.0) |
| 10 | MEDIUM | Frontend races and wedges | `MediaLibrary.jsx:91` | VERIFIED | NOT STARTED |
| 11 | MEDIUM | Malformed payloads produce HTML 500s, not 400s | `app.py:681` | VERIFIED | NOT STARTED |
| 12 | MEDIUM | Fresh-machine setup failures | `app.py:110` | VERIFIED | NOT STARTED |
| 13 | LOW | `.preview_cache` never evicted (414 MB, 211 MB dead) | `ffmpeg_utils.py:924` | VERIFIED | NOT STARTED |
| 14 | LOW | Remaining sharp edges (5 small items) | various | mixed | NOT STARTED |
| 15 | HIGH | Documented launch command stops the server at boot | `_reloader.py:429` | VERIFIED | **FIXED** (0.31.1) |
| 16 | HIGH | The Agent tab can overwrite source media in `input/` | `ffmpeg_utils.py:2410` | VERIFIED | **FIXED** (0.32.0) |
| 17 | HIGH | Hold Frame fails on every silent source — all 27 of this machine's videos | `ffmpeg_utils.py` `build_holdframe_filter` | VERIFIED | **FIXED** (0.38.0) |
| 18 | HIGH | V2's lane drew short of V1's; its end read frame 356, not 361 | `clipMath.js:9`, `Timeline.jsx:18` | VERIFIED | **FIXED** (0.37.0) |

Items 15 and 16 were found while fixing #7 and are new since the original audit. Item 17 was found
by #4's real-installation smoke test. Item 18 was reported by the user.

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
| `.webm` is offered but cannot be rendered | `ffmpeg_utils.py` `ALLOWED_EXTENSIONS` / `encode_args` | Naming an output `.webm` always 500s: `encode_args` yields libx264/AAC and the webm muxer accepts neither ("Nothing was written into output file, because at least one of its streams received no packets"). Found during #9 and confirmed identical on pre-#9 code, so it is not a regression | VERIFIED by running, both before and after #9 |
| Chat-produced files are invisible once the export dir is moved | `app.py:1875` `build_file_context`, `:2010` `_output_arg_info` | The chat/execute sandbox writes to `fu.OUTPUT_DIR` — deliberately, since it is a write-permission boundary (`fu._media_path_ok`), not a display preference. With a custom export dir its files are not in the Bin, and since 0.36.0 they no longer probe or preview either. Renders using them as a clip source already failed before 0.36.0 (clip resolution has always used `get_output_dir()`), so nothing that worked stopped working | VERIFIED on pre- and post-0.36.0 code |
| Export dir can be set to `input/` | `app.py` `POST /api/export_settings` | Any absolute directory is accepted, including the source folder. Source bytes are safe (`O_EXCL` + the uniqueness loop give `a_1.mp4`), but exports then appear in the Media Bin's **input** list. `render_timeline` behaved this way before 0.36.0; five routes now share it | VERIFIED, md5 of the source unchanged both ways |
| `.preview_cache` key ignores the directory | `ffmpeg_utils.py` `get_or_make_preview` | The key is `<basename>.<int mtime>.preview.mp4`, so two different non-browser-playable files sharing a name and a whole-second mtime share one transcode — the preview player shows the wrong video. Measured: two ProRes files named `same.mov` both served the identical 7,335-byte file. Identical before and after 0.36.0, but that fix widens the colliding set from {`input/`, `output/`} to {`input/`, any export dir used} | VERIFIED by running |

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
