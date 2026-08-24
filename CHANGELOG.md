# Changelog

What changed in GenAI Editor, newest first.

The version numbers here are the ones in [`VERSION`](VERSION) at the repo root — the
single place the version is written. Semantic versioning: **patch** for fixes,
**minor** for new features that don't change existing behavior, **major** for
anything that does. `0.x` means no stability promises yet.

**On the numbering below 0.25.0:** version tracking was added *during* 0.25.0, so
everything before it is a retroactive label, not a release that someone once
downloaded. Those numbers were assigned by walking the git history and counting
feature rounds, so the current number reflects the size of the app rather than
the day the version file appeared. There are no tags for them and never will be —
`v0.25.0` is the first real tag. Treat the older entries as a history, not a
download list.

## 0.25.0 — 2026-08-21

**V2 Reconstruct now reverses clip moves**

Reconstruct is the return leg of the round trip: you render V1, take the file to
an outside tool, bring it back, drop it on V2, and Reconstruct un-applies what V1
baked in. It used to ignore reordering — a V1 cut into `[A][B][C]` and shuffled
to `[C][A][B]` came back as one flat clip still in the shuffled order. It now
cuts the returned file at V1's shot boundaries and puts the shots back in the
order they appear in the source footage.

What it still can't undo, and now says so instead of failing quietly: speed
changes (the repeated frames are already in the file), crops (the pixels outside
the frame are gone), and footage V1 never used (it was never in the file).

One precondition worth knowing: the file on V2 must have been rendered from V1 in
V1's *current* order. Reorder V1 after rendering and every boundary lands on the
wrong frame — the durations still add up, so nothing can detect it. The app warns
when V1 has unrendered changes.

**A reconstructed shot list is one clip on V2, not many**

When Reconstruct produces several ranges, V2 draws and counts them as a single
clip: no seams, no 2px gaps, one name, one delete button, and the V2 shot count
reads 1. The ranges are still separate underneath — nothing is re-rendered and no
new file is written; the render still happens when you press V2 Render. Deleting
the clip deletes the whole run.

**Version tracking**

- `VERSION` at the repo root is the single source of truth. The backend reads it
  at startup and serves it at `GET /api/version`; the Vite build bakes the same
  string into the bundle. Both sides show the same number by construction, not by
  coincidence — the build fails if the copy in `frontend/package.json` drifts.
- The version shows in the top-left of the toolbar next to the EDL mode chip, and
  in the About dialog's colophon. Include it in bug reports; it's the only way to
  tell which build you're running.
- Shared archives are now named for their version (`nara-editor-0.25.0.zip`), so
  three people with three downloads can tell them apart.
- `python3 bump_version.py patch|minor|major` moves it everywhere at once.

---

# Earlier history

Reconstructed from git. Dates are the real commit dates; the numbers were
assigned after the fact, one minor per feature round.

## 0.24.0 — 2026-08-21

Clips can be moved along the timeline. Clip icons and text labels reworked.

## 0.23.0 — 2026-08-21

Audio clips on A1 can be cut/split independently of the video tracks.

## 0.22.0 — 2026-08-20

Per-clip audio levels with a dB stepper, and clip labels on the timeline.

## 0.21.0 — 2026-08-20

Undo (Cmd/Ctrl+Z) across all three tracks, sharing one history — so undo steps
back the last edit on whichever lane it happened.

## 0.20.0 — 2026-08-20

A1 Room Tone: a bundled room-tone asset that can be laid under the audio bed at
an adjustable gain.

## 0.19.1 — 2026-08-19

Agentic install instructions (`agentic_installation.MD`) so the app can be set up
on a new machine by handing the file to Claude. Contact details in the About
dialog, giving a recipient somewhere to report a bug.

## 0.19.0 — 2026-08-17

Batch Analyzer: cuts a returned file against V1's shot boundaries in one pass,
instead of one Analyze at a time.

## 0.18.0 — 2026-08-14

Custom encode settings — codec, preset, profile, pixel format — plus saved
setting bundles, all validated by the backend so the UI can't offer a combination
the encoder would reject. Menu and general UI rework alongside it.

## 0.17.0 — 2026-08-13

A1 audio track: an audio lane independent of the video tracks, rendered to its
own stem.

## 0.16.0 — 2026-08-12

V2, the smart overlay/scratch track — the second video lane the whole round-trip
workflow is built on.

## 0.15.0 — 2026-08-10

Export quality modes (lossless through size-capped two-pass), Duplicate, the
Actions log panel, the About dialog, and a guided tour.

## 0.14.0 — 2026-08-10

Analyze and Reconstruct: the round trip out to an external tool and back.

## 0.13.0 — 2026-08-10

Projects save and load as `.nara` files.

## 0.12.0 — 2026-08-10

Reformat — aspect-ratio conversion.

## 0.11.0 — 2026-08-10

Per-clip speed.

## 0.10.0 — 2026-08-10

Crop, including crop that animates across a clip via keyframes.

## 0.9.0 — 2026-08-10

Playback transport: scrubbing, a playhead that tracks the render, and per-frame
stepping.

## 0.8.0 — 2026-07-24

The timeline renders as one continuous video rather than per-clip files.

## 0.7.0 — 2026-07-24

Lossless output — `-qp 0` video with quality-matched audio, so a render can be
frame-identical to its source.

## 0.6.3 — 2026-07-24

Reverse auto-confirms instead of prompting twice. Left resize handle on clips,
and Clear buttons for the bins.

## 0.6.2 — 2026-07-24

Split naming, selection highlighting, per-clip delete, and a denser UI.

## 0.6.1 — 2026-07-24

Fixed hold and raise placement. Per-clip colors and a resizable panel.

## 0.6.0 — 2026-07-24

Raise, Splice, and Trim. The app took the name Nara Editor.

## 0.5.0 — 2026-07-24

Held frames became real timeline segments rather than a separate operation, and
the playhead lines up with them.

## 0.4.0 — 2026-07-24

Editing driven from the timeline itself instead of from forms beside it.

## 0.3.0 — 2026-07-24

NLE-style layout with an EDL table and always-visible clip metadata.

## 0.2.0 — 2026-07-24

React + Vite + Tailwind frontend with the first timeline UI, replacing the
vanilla-JS page as the primary interface.

## 0.1.0 — 2026-07-24

The original Flask + vanilla-JS ffmpeg editor. Still present as the fallback UI
at `127.0.0.1:5001`.
