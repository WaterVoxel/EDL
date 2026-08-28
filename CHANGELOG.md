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

## 0.45.1 — 2026-08-28

**Restarting the app no longer leaves a render running in the background.**

The instructions for stopping the engine — in the install guide, in the restart skill, and the note
in README — told you to kill everything listening on port 5001. There are two programs there when
the app is running: the one that serves the app, and a small supervisor that watches the code for
changes and restarts the first one. Killing the supervisor takes the server down the hard way, with
no chance for it to tidy up, so a render that was in progress kept going with nobody watching: the
video encoder ran on at full speed to the end, wrote its file into a temporary folder, and then
nothing ever collected it. On the measurement here that was another 8.5 seconds of a busy Mac
producing a file the app would never show you.

The stop command now signals only the program that serves the app. It shuts the render down properly
on its way out — the encoder stops within a second and the half-finished file is cleaned up — and the
supervisor notices its charge has gone and exits by itself, so the port is free for the restart
exactly as before. Three back-to-back restarts, no port conflicts.

Nothing inside the app changed; this is the documented procedure being wrong rather than the software.
If you are the one at the keyboard and the old copy is still rendering, the friendliest way to stop it
is still to close its browser tab and wait a second — that has cancelled the render since 0.45.0.
A render interrupted by stopping the server is reported as a failed render, which is what it is.

## 0.45.0 — 2026-08-28

**Closing the tab, hitting reload, or pressing Stop in the browser now actually stops the render.**
Until now it only stopped *you* watching it: ffmpeg carried on at full speed for as long as the job
needed, wrote its file, and put it in the export folder, so a mistaken 90-second render meant either
waiting it out or quitting the whole app. Now the render is stopped within about a second of the
browser going away, and nothing is left behind — no file in the export folder, no half-written file
in the staging folder, and no leftover pass-1 statistics files from the size-limited modes. A
two-pass render abandoned during pass 1 no longer starts pass 2.

Two things this deliberately does **not** do. Renders you did *not* abandon are untouched — if you
have two renders going and close one tab, the other finishes and commits exactly as before, and a
render nobody interrupts produces the same bytes as it did in 0.44.0. And **previews are not
cancelled**: the small proxy file the app builds so a clip can play in the browser keeps building
even if you navigate away, because it lands in the preview cache and the next person to open that
clip gets it instantly instead of waiting again.

One rough edge worth knowing: a command you run from the chat panel writes straight to the export
folder rather than staging, so cancelling one leaves the truncated file it had written so far under
the name you gave it — the same leftover any failed chat command already leaves. Delete it and
re-run.

## 0.44.0 — 2026-08-28

**A round of small sharp edges, most of which used to fail quietly.** Nothing here changes how a render
looks; what changes is that the app now says what went wrong instead of doing something surprising.

**A render can no longer disappear into a folder you didn't ask for.** Typing an output name with a
slash in it — `8/25 hero cut` — used to succeed and quietly write the render into a new `8/` folder
inside your export directory, where the Export Bin could not list it, preview it, rename it or delete
it. The name was still reported back as if all was well. Names like that, plus `../something.mp4`, `.`,
`..` and a name with no usable extension, now come back as a clear refusal that says why, and every one
of the seven things that writes a file (Render, Trim, Splice, Reformat, Hold, Reverse, Render A1) checks
the same way, so they can't disagree.

**Naming a render `.webm` no longer fails after the encode.** WebM files can be imported, previewed and
used on the timeline exactly as before — that part now works end to end for the first time — but the app
only ever writes H.264/HEVC, which a `.webm` file cannot contain, so asking for one used to run the
whole render and then fail. It is refused up front, and a `.webm` source renders to `.mp4`.

**Playback no longer freezes at the end of a 24 fps clip.** A clip trimmed all the way to the end of its
file could stop mid-timeline: the picture froze, the transport still said it was playing, and nothing
said anything. It now hands off to the next clip when the file genuinely runs out of frames, at any
frame rate.

**A deleted render can no longer reappear in the panel.** Deleting or clearing an export while the app
was still fetching its details could put that file straight back into the right-hand column — selected
row, Media Info Out, and the player pointed at a file no longer on disk. Those answers are now ignored.

**Preview thumbnails no longer mix two files up.** Two different files with the same name — one in your
Media Bin, one in your export folder — could be served the same converted preview, so one of them showed
the wrong video. Previews are now kept per folder as well as per file. One-time effect of the fix:
existing cached previews no longer match, so they are cleaned up and rebuilt the next time you preview
those files.

**Your export settings are no longer someone else's.** `.export_settings.json` was committed to the
repository, so a fresh copy of the app inherited the developer's quality mode. It is no longer tracked,
and it is written in a way that a crash mid-save can't wipe your export folder, quality mode and saved
presets.

**Smaller ones, all of them messages that were missing or wrong:**

- Setting your export folder to the app's own `input/` folder is refused — renders used to land there and
  show up as if they were your footage.
- Trimming from a start time past the end of the file says so, and names the file's real length, instead
  of producing an empty or failed render.
- An audio bed whose length can't be read is reported by name instead of silently landing as a
  zero-length clip on A1.
- Renaming a file to a name written in a non-Latin script (`видео.mp4`) used to store it as `mp4.mp4`.
  It now explains that a name needs at least one Latin letter, digit, dash or underscore.
- Choosing an export folder works when a folder in the path contains a quote mark.
- Clearing the Media Bin on a fresh copy of the app no longer errors when the `input/` folder was never
  created.
- Reading a file's details can no longer hang forever on an unreadable file or a disconnected drive.

## 0.43.0 — 2026-08-28

**The preview cache now cleans up after itself — 502 MB of it on this machine.** Files the browser can't
play natively (ProRes, HEVC, WAV) get converted once behind the scenes so the preview player can show
them, and the result is kept in a hidden `.preview_cache` folder. Nothing ever removed anything from it:
delete a render from the Export Bin, rename a file, or re-render over one, and its converted copy stayed
on disk forever with nothing able to reach it again. Measured today: 602 MB across 334 files, of which
298 files and 502 MB were already unreachable — most of it from Export Bin renders that had long since
been cleared.

The app now sweeps the folder when it starts and again whenever it converts something new, removing only
entries that no longer match any file in your Media Bin or export folder, and printing what it reclaimed
(`preview cache: removed 298 file(s), reclaimed 502 MB`). There is also a 2 GB ceiling on what remains, so
the folder can't grow without limit on a very large project; if that ever kicks in, the previews you've
used least recently go first. Nothing you can see changes — previews still play the same and still open
instantly the second time — and anything the sweep removes is rebuilt automatically the next time you
click that file, which takes a couple of seconds.

## 0.42.0 — 2026-08-27

**A fresh copy of the app now works without being told to make folders first.** The setup notes ask you
to create `input/` and `output/` by hand, and a copy that skipped that step answered every request about
media with a server error: the Media Bin, the Export Bin and uploading all failed, and the reason given
was a missing-file error naming a folder rather than anything you could act on. Both folders are now
created the moment anything looks in them or saves into them, so the empty bins you see on a new copy
are genuinely empty rather than broken. Your own chosen export folder is never invented this way — if
the folder in Export Settings isn't there, the app still falls back to `output/` as before.

**When ffmpeg isn't installed, the app now says so.** Previously every render, trim, reverse, hold,
preview and click-a-file-for-details came back as "internal server error", with the real reason buried in
a detail line that most of the screens don't show — so on a machine without ffmpeg the app looked broken
in eight different ways instead of one. Now each of those failures reads "cannot find ffprobe — this app
looked for it at /opt/homebrew/bin/ffprobe. Install it with: brew install ffmpeg", the terminal prints the
same sentence once at startup, and clicking a file whose details can't be read shows that sentence in the
Media Info panel instead of a table of dashes. (README.txt has always had a troubleshooting entry called
"The app says it can't find ffmpeg"; the app now actually says it.)

**Browse for an export folder no longer does nothing in silence.** If macOS has been told not to let this
app control System Events, the folder picker never opens — and the app used to treat that exactly like you
pressing Cancel, so the button appeared dead. It now explains that the picker was blocked and where to
allow it (System Settings ▸ Privacy & Security ▸ Automation), and reminds you that you can type the path
into the field instead. Pressing Cancel still closes quietly, as it should. If the picker hangs instead of
failing, the two-minute wait now ends with that same explanation rather than with a paragraph of AppleScript.

**Files with non-Latin names can be added again.** Dropping `видео.mp4` or `影片.mp4` into the Media Bin was
refused with "unsupported file type: mp4" — naming a format the app fully supports as the unsupported one.
The problem was that the app checked the extension after stripping non-English characters from the name.
It now reads the extension from the name your system actually sent, so these files are accepted; because the
app can only store plain-ASCII filenames, they land as `upload.mp4` and can be renamed in the bin. Files
that really aren't media are still refused, and now the message names the extension it objected to (`.txt`)
rather than the whole filename.

## 0.41.0 — 2026-08-27

**Clicking through the bins quickly no longer shows one file's details under another file's name.**
Both bins ask the backend about a file when you click it, and the answers come back in whatever order
the backend finishes them — so clicking a big file and then a small one could leave the small file's
name highlighted with the big file's resolution, duration and codec beside it, its picture in the
preview, and the Reformat panel pointed at it. Measured in a real browser: with one answer held back
1.5 seconds, every part of the panel described the earlier click. Now the newest click always wins
and older answers are discarded. The Export Bin had the same problem, and there it also dragged the
highlighted row back to the older file; it is fixed the same way.

**Dropping several files at once no longer stops at the first one that fails.** A drop of three files
where the second failed used to add the first and abandon the third without attempting it, and the
only message named the connection rather than the files. Now every file is attempted, the ones that
work still land in the order they were dropped, and one message at the end lists exactly which files
didn't and why: "1 of 3 files could not be added to V1: • two.mp4 — cannot reach the backend…". The
same applies to the A1 audio lane.

**Playback no longer hangs forever on a clip whose file has gone missing.** If a source file was
moved, renamed or deleted while the app was open, playback would reach that clip and stop dead —
still showing itself as playing, with the timecode frozen and nothing said. It now stops cleanly at
that point and writes a line in the Actions tab naming the file: "playback stopped at "bravo.mp4" —
its source file could not be loaded (moved, renamed or deleted?)". The clip stays on the timeline and
still renders; it's only the preview that can't show it.

**Opening a project now asks before throwing away unsaved work.** Opening a project (or importing
one) replaces all three lanes and clears the undo history with them, so anything unsaved was gone for
good with no warning — measured: three clips became one, with Undo unavailable and no prompt. There
is now a confirmation naming the project you're about to open, with Cancel returning you to your work
so you can save first. It only asks when there is something to lose: a project opened and not touched
— or edited and then edited back to how it was saved — opens without a prompt, and neither does
opening one on a fresh session. What counts as work is the three lanes plus the room-tone settings;
which clip happens to be selected doesn't, and a Render doesn't either.

## 0.40.0 — 2026-08-27

**When a request is malformed, the app now says which field is wrong instead of "internal server
error".** Every operation the app performs — trim, splice, render, hold, reverse, reformat, saving a
project, renaming a file, changing export settings, the Agent tab — is a small message sent to the
backend. If any part of that message was the wrong shape (a number where a filename belongs, a list
where a duration belongs, a key missing altogether), the backend used to fall over and report
"internal server error", naming a Python type at best. That reads as *the app is broken* for what is
really *this request was wrong*, and it gave nobody — user or developer — a clue which field to look
at. Of 59 malformed requests tested, 42 came back as errors of that kind.

All 59 now come back as a plain refusal that names the field: "clip 0: input must be a string",
"inputs must be a list", "output must be a string", "time must be a number". Four of them used to
get as far as starting a real encode before failing, so a bad request could occupy the machine for
a while before saying anything.

Three specific cases used to be *accepted* and now aren't, which is the only behaviour here that
someone could notice as a change rather than an improvement:

- A negative head or tail hold (`-3` seconds) used to render silently, as if it were zero. It is now
  refused. A hold extends a clip, so a negative one is always a mistake — and the Hold form in the
  interface already refuses to send one.
- `true` in place of a hold time used to be read as one second. It is now refused.
- A wrongly-typed starting folder for the export-directory Browse button used to open the folder
  picker anyway. It is now refused before the dialog appears.

**Files whose duration can't be read now say so.** A few containers don't record their own length —
most commonly anything that was written to a pipe rather than a file, because the writer can't go
back and fill the number in. Such a file measured as a confident zero seconds, so every attempt to
use it on the timeline came back as "invalid inSec/outSec for source duration 0.0" or "time must be
within [0, 0.0)". Both statements are true and neither mentions the actual problem. The message now
names it: "cannot read the duration of nodur.mkv — its container reports none, so no trim window can
be checked against it". Trim and Reverse still work on these files, exactly as before, because
neither needs to know the length.

Nothing about a valid request changed. All 24 normal operations tested produce the same result as
0.39.0 — 22 of them byte-for-byte identical, and the two that write Matroska files are
frame-for-frame identical (Matroska stamps a unique ID into every file it writes, so two runs of the
same command never match byte-wise even without a code change).

## 0.39.0 — 2026-08-27

**Quitting the server no longer leaves a render running behind it.** Because the app runs in
development mode, it restarts itself the moment you save a code file or bump the version — and
until now, if a render was in progress when that happened (or when you pressed Ctrl-C, closed the
Terminal window, or ran `kill`), the ffmpeg doing the encoding was cut loose. It kept running at
full tilt on every CPU core, with no window left to deliver its result to, and a two-pass export
left its scratch files (`.ffpass`, `.mbtree`) sitting in a hidden folder that nothing would ever
clean up. The only way to notice was a fan spinning up for a file you were never going to get.

The app now keeps track of the ffmpeg processes it starts and stops them when it shuts down for
any of those reasons, clearing the half-written scratch files with them. Renders that finish
normally are untouched — same output, byte for byte — and this changes nothing you can see while
the app is running.

One thing this deliberately does **not** change: if you close the browser tab or your connection
drops while the server itself stays up, the render still runs to completion (it just has nowhere
to send the finished file). Stopping a single render on demand would need a Cancel button, which
is a separate piece of work.

## 0.38.0 — 2026-08-27

**Hold Frame now works on video with no sound.** Before this, freezing a frame failed on any
clip whose file has no audio track — and since every one of the 27 videos in `input/` on this
machine is silent (the sound lives in separate `.wav` files on the A1 track), it failed on all
of them. The error shown was worse than useless: it began with ffmpeg's version banner, so the
reason read as "ffmpeg version 8.1.2 Copyright (c) 2000-2026…" instead of anything about audio.

The cause was that the freeze always tried to cut and re-join the source's audio, which makes
ffmpeg reject the entire job — picture included — when there is no audio to cut. A silent clip
now produces a silent result, matching what Trim and Reverse already do. Clips that *do* have
sound are completely unaffected: the audio still plays up to the freeze, goes quiet for exactly
the length of the hold, and resumes after it, and the command sent to ffmpeg for those clips is
byte-for-byte the one 0.37.0 sent.

This is the Hold Frame in the fallback interface at `127.0.0.1:5001`. The Head/Tail hold buttons
in the main timeline are a different mechanism and were never affected.

## 0.37.0 — 2026-08-27

**The timeline now draws every track to its true length, so V2's end reads the frame it actually is**

Drop a video on V2 and its block used to stop *short* of where V1 ends — even when the file was
longer. Click at that end and the frame counter said **356** while Media Info said the file was
**361 frames** long. Nothing was wrong with the file or with the reading of it; the timeline was
drawing it wrong.

The cause was a 2-pixel cosmetic space between clips. That space took up room but stood for no time
at all, so how much a track over-drew depended on how many clips happened to be sitting on it. A V1
with six clips picked up five of those spaces — 10 extra pixels, four whole frames of nothing — while
a V2 holding a single clip picked up none, and the ruler above them picked up none either. Three
strips of the same timeline, three different ideas of where a given second was. The clip you dropped
on V2 was measured against V1's stretched-out ruler, and that is where the missing frames went.

That space is now zero. Clips still read as separate blocks — each one already carries its own
coloured border, and two of them meeting makes a crisper edge than the old gap did. What changed is
that one second is now the same number of pixels on V1, on V2, on the ruler, and under the playhead,
by construction rather than by four separate corrections that had drifted apart.

Two more things were off by the same kind of accounting and are fixed with it: the ruler's ticks and
labels sat 8 pixels to the left of the times the tracks put them at (about three frames' worth), and
its overall width was calculated one gap too wide.

Worth knowing about the file that prompted this: it really does contain 361 frames, not 360. At 24
frames per second that is 15.042 seconds, so it genuinely runs one frame longer than a 15-second V1
and its block now correctly sticks out past V1's end by that one frame. The app was right about the
number all along.

Two related problems were measured and deliberately **left alone**, because fixing either would
change how the timeline behaves rather than how it draws:

- Very short clips are still drawn at a 24-pixel minimum so they stay clickable. After Batch
  Analyzer that minimum stretches V2 by about 19 pixels (7.6 frames), because the Analyzer puts the
  round-up on V2 as its own tiny clip while V1 keeps it tucked inside the last one.
- Playback and seeking still measure the timeline's total length from V1 even while showing V2's
  picture, so when V2 is longer its final frames can't be reached and **Go to End** stops just short
  of them.

Both are written up with numbers in [AUDIT.md](AUDIT.md) (#18) for a decision.

## 0.36.0 — 2026-08-27

**If you chose your own export folder, the app now agrees with itself about where your exports are**

Export Settings lets you point exports at any folder you like. Until now only Render (and Reformat and
Render A1) actually used that folder. Trim, Splice, Hold Frame and Reverse ignored it and wrote into the
app's own `output/` folder instead — so the file you had just made didn't appear in the Export Bin at all.
It was on your disk, in a folder you hadn't chosen, and the Bin couldn't list it, preview it, rename it,
reveal it in Finder, or delete it.

The Bin had the mirror-image problem. It listed your chosen folder correctly, but Media Info Out and the
preview player looked in the app's `output/` folder — so clicking a render you had just made showed
nothing, or, if a file of the same name happened to exist in the other folder, showed **that** file's
details and played **that** video instead. Nothing said anything was wrong.

Both sides now use your chosen folder, and so does the numbering that keeps names from clashing: asking
for a name that's already taken in your export folder gets you `name_1` as it should, and a name that
merely exists in the app's `output/` folder no longer causes a pointless rename.

Nothing changes if you haven't chosen an export folder — everything keeps going to `output/`.

Not covered: files produced by the chat assistant. Those are written to the app's own `output/` folder by
design (it's the folder the assistant is allowed to write to), so they still don't show up in a relocated
Export Bin.

## 0.35.0 — 2026-08-27

**Two renders finishing at the same moment can no longer overwrite each other**

0.34.0 stopped two same-name renders from colliding in the ordinary case, but it left a narrow window
open: the app checked whether a name was free and then, a fraction of a second later, moved the
finished file into it. If a second render finished inside that gap, both had already seen the name as
free, so the second one wrote over the first. You got one file, both requests told you they had
written it, and the render you lost left no trace — no error, nothing in the Bin, nothing in the log.

The window was small but the thing that opens it is completely ordinary. Reloading the page while a
render is running and pressing Render again is enough: the first render keeps going after the reload
(closing the tab doesn't stop it), so now two renders are heading for the same name. Two browser tabs
do it too, and the Render button being greyed out doesn't help, because that only applies to the tab
you're looking at.

Now the name is claimed in a single, indivisible step rather than checked and then used, so exactly
one render can own each name and any others move on to `_1`, `_2`, and so on. Under a test that
widened the window deliberately, eight simultaneous renders of the same name used to leave **one**
file — seven results destroyed, all eight reporting the same filename. All eight now survive, each in
its own file, each request naming the file it actually wrote.

This affects every kind of export — the timeline, trims, splices, held frames, reverses, reformats,
the audio-only stem, and the size-capped and custom quality modes — because they all finish through
the same step. Single renders are unchanged: you still get exactly the name you asked for.

## 0.34.0 — 2026-08-26

**A render that fails no longer leaves a broken file in your Export Bin**

Until now, when a render stopped partway — you quit the app while it was working, the machine slept,
the disk filled, ffmpeg hit something it couldn't encode — whatever had been written so far stayed
in the export folder, and the Export Bin listed it like any finished export. It had a normal name
and a plausible size, so nothing about it looked wrong until you clicked it and the player refused
to open it, or you handed it to someone else. A render killed the instant it started left a 48-byte
file that no player on earth can open. The Bin also showed the file *while* a render was still
running, so a growing, incomplete file looked like a finished one.

The failed file also took the name. Rendering `promo.mp4` again after a failure gave you
`promo_1.mp4`, and the useless `promo.mp4` sat above it in the list until you noticed and deleted it
by hand.

Now every render is written off to the side in a hidden folder and moved into the export folder only
once it has finished successfully. A render that fails leaves nothing behind: no file, no name taken,
no entry in the Bin — just the error, and you can retry with the same name. A render in progress no
longer appears in the Bin until it's done. Renders that finish are byte-for-byte identical to before,
including `.m4v` files, which keep their original format marking.

Two smaller things came with it. The scratch files the size-capped and custom quality modes write
during their two measuring passes (up to a few MB each) used to be left in the export folder when a
render was interrupted; they're now inside the hidden folder and go away with it. And two renders
started at the same moment with the same output name used to collide into a single file — now each
gets its own, the same way staggered renders always have.

Not covered: a render already in flight when the app is force-quit can leave one file in the hidden
folder, since nothing is running to clean it up. It's invisible to the app, it never blocks a name,
and deleting the hidden `.partials` folder inside your export folder clears it.

## 0.33.0 — 2026-08-26

**A preview that fails once no longer stays broken forever**

Some formats can't play in a browser, so the app quietly makes a playable copy the first time you
click such a file and reuses that copy afterwards. If anything interrupted the very first copy —
you quit the app mid-way, the machine slept, ffmpeg ran out of disk — the half-written file stayed
behind, and the app treated it as finished. Every later click on that file handed you the same
broken piece. The video window stayed black or refused to load, clicking away and back changed
nothing, and restarting the app changed nothing either, because the bad file was on disk. The only
way out was knowing about the hidden `.preview_cache` folder and deleting the file by hand.

There was a second, quieter version of the same problem. One click can ask for a preview twice, and
a second request arriving while the first copy was still being written was served that partly
written file — so the player failed while the copy it was reading finished perfectly a moment
later. That one looked random, which made it the harder of the two to report.

Now the playable copy is built off to the side and only moved into place once it's complete. A
preview that fails says so, with the error, and the next click simply tries again. Nothing
half-finished is ever handed to the player.

If a file of yours is already stuck from before this fix, it stays stuck — the bad copy is already
on disk and this change can't tell it apart from a good one. Deleting `.preview_cache` at the
project root fixes it; the app rebuilds whatever it needs.

## 0.32.0 — 2026-08-26

**The Agent tab can no longer write over your source footage**

Files in `input/` are meant to be read and never touched — it is the promise the whole
non-destructive design rests on. The Agent tab could break it. If the command it generated named
one of your source files as the file to *write*, it ran, reported success, and replaced that
file's contents. Your original footage was gone, with no warning and no undo. It did not take
anything unusual to trigger: writing `-y` in front of a command is the ordinary way to tell ffmpeg
"don't ask, just do it", and that is exactly what turns the refusal-to-overwrite into an overwrite.

Any command that would write into `input/` is now refused before ffmpeg starts, with a message
saying to write to `output/` instead. Reading from `input/` is untouched — that is what it is for —
and so is writing into `output/`, including with `-y`.

**What you may notice:** an Agent request that used to appear to work will now come back with
"cannot write to input/". That request was destroying a source file, so the refusal is the fix
rather than a limitation. Everything that writes to `output/` behaves exactly as before: twelve
ordinary Agent commands — plain trims, two inputs combined, filters, thumbnail sequences, a
`-y` overwrite in `output/` — were checked before and after and all behave identically.

**Correction to the 0.31.0 note below.** That entry said ffmpeg's refusal to overwrite is "what
keeps a file in `input/` from being replaced". That was wrong: the refusal is skipped entirely when
a command carries `-y`, so source files were never actually protected. 0.32.0 is what makes that
statement true, and it is enforced by the app rather than left to ffmpeg.

**Numbering note:** minor rather than patch, for the same reason as 0.27.0 and 0.30.0 — commands
that used to run are now refused, which is a change to existing behavior, and `0.x` means no
stability promises yet.

## 0.31.1 — 2026-08-26

**The documented start-up command no longer stops the engine before it starts.**

If you started the app by copying the command out of the install guide into a Terminal window, it
could stop dead during start-up: nothing ever answered on port 5001, and the log file held only the
normal start-up banner with no error in it to explain why. The command now ends up with the engine
properly detached from the Terminal window, and it starts normally.

This was the same family of problem as the render freeze fixed in 0.31.0, one step earlier in the
day: a background program is not allowed to reach back and adjust the Terminal it was launched from,
and gets frozen by the operating system if it tries. 0.31.0 stopped the video encoder from doing it
during a render; this stops the engine itself from doing it at start-up. The two are independent —
fixing the render freeze did not fix this one, which is why it needed its own change.

Nothing about the app's behavior changed, and no fix is needed if you already had it running.
The instructions for starting the frontend are unchanged — it was tested in the same conditions and
was never affected.

## 0.31.0 — 2026-08-26

**Renders no longer freeze the whole app when the engine was started from a Terminal window**

If you started the engine by typing the background command from `agentic_installation.MD`
into Terminal — the line ending in `&` — then every Render would sit at 0% forever.
Nothing was written, nothing appeared in the log, and the app stopped answering
anything else at all: the Media Bin, the file list, the version readout, all of it went
dead until you force-quit and started over. It looked exactly like a crash, but nothing
had crashed.

The cause was one flag. ffmpeg tries to listen for the `q` keystroke that stops an
encode, and to do that it reaches for the Terminal window the engine was launched from.
A background job is not allowed to touch that window, so macOS *suspended* ffmpeg the
instant it tried — and because ffmpeg was suspended as part of the engine's own group,
the engine was suspended right along with it. The half-hour render timeout could not
save you either, since the timer was suspended too. ffmpeg is now told not to listen
for keystrokes at all, which it never needed to here.

Two things worth knowing:

- **Your finished renders are unaffected.** This changes when ffmpeg runs, never what
  it produces. Five kinds of render — a plain trim, a multi-clip sequence with holds
  and reverse and a speed change, both size-capped two-pass modes, and an A1 audio
  stem — came out identical to the frame on a patched and an unpatched copy.
- **If renders have always worked for you, nothing was wrong and nothing changes.**
  This only ever affected engines started as a background job from a Terminal window.
  Started any other way, the flag was never needed.

**The Agent tab now tells you when ffmpeg declined to replace a file**

Ask the Agent for an edit whose output filename is already taken and ffmpeg refuses to
overwrite it — which is what protects your existing files. Previously that refusal was
invisible: the request just hung until it timed out. Now you get a clear message saying
nothing was written, so you can rename and try again.

(This entry originally claimed the same refusal is what keeps a file in `input/` from being
replaced. That was not true — a command carrying `-y` skips the refusal altogether. See 0.32.0,
which actually protects `input/`.)

**Numbering note:** minor rather than patch. The fix itself changes no behavior anyone
relied on, but the Agent tab now returns a real error where it used to time out, and
that is a visible change to how an existing feature responds. Same reasoning as 0.27.0.

## 0.30.0 — 2026-08-26

**Renders no longer drift out of step with the timeline**

If your timeline mixed clips at different frame rates, or used the 0.75× or 0.4×
speed presets, the rendered file could come out slightly longer than the timeline
said — and every cut after the first one landed a little later than where you put
it. The error built up clip by clip, so the further into the sequence you looked,
the further off it was. On a 20-clip mix of 24 and 30 fps footage the last cut
ended up two frames late; twelve clips at 0.75× ended up four frames late.

The cause was each clip's audio being measured on a slightly different grid than
its picture. When the two disagreed, the longer of the two won and pushed
everything after it along. The picture itself was always right — the frames were
correct and in the correct order — but the file's timing around them wasn't, which
also made the render come out with a variable frame rate instead of a steady one.

Two things follow from this. **Round-tripping through V2 now cuts in the right
place**: Batch Analyze and Reconstruct work out where each shot begins by
predicting the render's own frame count, so previously they were cutting on
boundaries the file had moved out from under them. And **the A1 audio stem now
matches the render it belongs to exactly** — it could be up to 100 ms off before,
which is enough to notice when you drop it into another tool alongside the video.

The same fix closes the opposite case, which nobody had reported: on some
combinations the audio was *shorter* than its picture instead of longer, leaving up
to 21 ms of silence at the end of each clip.

**Nothing about the picture changes.** Every rendered frame is byte-for-byte what
it was — verified across 195 filter graphs, where no video-only render differed by
a single character, plus a frame-hash check of holds and reverse against the
source. Timelines from a single-frame-rate source at normal speed — the common
case, and why this went unnoticed — rendered correctly before and are untouched.

**Numbering note:** this changes what existing timelines render to, so by the rule
at the top of this file it is a breaking change. It gets a **minor** bump for the
same reason 0.27.0 did: `0.x` means no stability promises yet, and `1.0.0` should
mean the app is stable rather than merely that it once changed a behavior.

## 0.29.1 — 2026-08-26

**Failures say so now, instead of the app quietly stopping**

Some things could go wrong and tell you nothing at all. A render that ran past its
time limit is the clearest case: the spinner stopped, no error appeared, and the
only clue was that no file showed up in the Export Bin. It looked exactly like a
render that had worked. The same silence covered a few other places — the Media
Bin showing an empty list when the backend wasn't actually running, the AGENT tab
sitting on "Thinking…" with Send greyed out until you reloaded the page, and the
Project Library stuck on "Loading…".

All of those now say what happened. A render that times out says so and suggests
retrying. A backend that isn't running says *"cannot reach the backend — is the
server on 127.0.0.1:5001 running?"* rather than looking like an empty project
folder. The AGENT tab puts the failure in the conversation and lets you type
again. And anything unexpected that the app doesn't have a specific message for
now produces a readable error rather than nothing.

Nothing that already worked changes, and errors the app already reported well —
"need at least 1 clip", "input file not found", the new overwrite prompt from
0.29.0 — read exactly as before. The terminal running the server also still gets
the full technical traceback, which is unchanged.

## 0.29.0 — 2026-08-26

**Saving a project can no longer quietly destroy a different one**

Saving under a name that already belongs to another project now asks first —
*"Batch 1 V002.nara already exists. Replace it? This cannot be undone."* — and
does nothing if you say no. Before, it replaced that project on the spot, with no
prompt and no way back. Delete has always warned; Save was the more destructive
of the two and didn't.

The worst version of this was invisible. Project names used to be rewritten
before being saved: spaces became underscores and accented or non-Latin
characters were dropped entirely. So **Save As → `Batch 1 V002`** landed on the
existing `Batch_1_V002.nara` and overwrote it, and a project named `видео` saved
itself to a hidden file with no name at all. Names are now kept exactly as you
type them — spaces, accents, any alphabet — and only names that genuinely cannot
be filenames here are refused (a slash, or a leading dot). Existing projects are
unaffected and open as before.

Saving a project you already have open still just saves, with no prompt. That is
what Save means.

Two smaller fixes in the same area:

- A save that fails partway — disk full, or the app quitting mid-write — used to
  leave the project truncated and unopenable, with the previous good copy already
  gone. The file is now written beside the old one and swapped in only once it is
  complete, so a failed save leaves the previous version intact.
- Clicking a damaged project in the library did nothing at all: no error, no
  open, no clue. It now says the file is corrupt.

Numbering note: the same reasoning as 0.27.0 applies. This changes behavior that
existed before — Save As asks, and typed names keep their spaces — which the
project's rule calls a major bump, but the behavior that changed *was* the bug,
and `0.x` puts that in the minor slot.

## 0.28.0 — 2026-08-24

**Folders in the Media Bin**

The bin groups files now. There's a folder button in its header next to Clear,
and **New Folder** on the right-click menu — on a file, on a folder, or on empty
space in the list. A new folder arrives with its name already selected for
typing, so naming it is part of making it rather than a second click. Enter or
clicking away keeps the name; Escape leaves it as "New Folder"; double-clicking a
folder's name renames it later.

Drag a file onto a folder to file it there. The folder under the cursor lights up
so you can see where it's going, and the file you're dragging goes faint. Drag it
onto empty space in the list to bring it back out to the top level, or use **Move
out of folder** on its right-click menu. Folders open and close with the arrow
beside them, and dropping a file into a closed folder opens it so you can see the
file land.

Sorting, the Filter box, the V1/V2/A1 track buttons and the preview all work as
before. Sort and favourites now apply *inside* each folder as well as at the top
level — a ★ file still floats to the top of wherever it lives. Folders sit above
the loose files, in name order, and the number beside a folder is how many of its
files you're currently looking at.

**One thing worth knowing: these folders are a view of the bin, not folders on
disk.** Your files stay exactly where they are in `input/`, so nothing you drag
in the bin can ever break a clip on the timeline — you can file away a file that
V1 is using right now, which is usually the one you most want to tidy. That's the
trade: **the folders don't appear in Finder**, and because they're remembered in
this browser (the same place favourites and the V1/V2 tags live), they don't
travel with a saved `.nara` project and won't be there in a different browser.

Two smaller consequences of the same design:

- **Clear** empties `input/`, so the folders stay behind, empty. Filing is
  remembered per filename — the way favourites and track tags already are — so
  re-adding a file with the same name puts it back in the folder it was in.
- Removing a folder deletes nothing. Its files go back to the top level.

While the Filter box has something in it, or a track button other than All is
selected, folders are held open and the collapse arrows grey out — a file that
matched your search would otherwise be hidden inside a shut folder. Folders with
no match drop out of the list entirely while you're searching.

Also fixed: dragging a file *within* the bin no longer lights up the upload
button as though it were about to upload something.

## 0.27.0 — 2026-08-24

**Reconstruct now undoes a slow-down instead of reporting it**

If you slowed a shot on V1 — say 24 frames stretched to 48 — Reconstruct used to
hand that shot back at its stretched length and tell you so. The frames the
slow-down repeated were real frames in the rendered file, and the app had no
speed-up to compress them with, so all it could honestly do was warn.

It can now. A V1 slow-down comes back as its exact opposite: the reconstructed
clip carries the reciprocal speed, which drops the repeated frames again and puts
the shot back at its original length. 48 frames become 24 again.

This is exact, not close. A slow-down only ever *duplicates* frames, so speeding
it back up only ever drops those duplicates. Every speed the app offers was
rendered out and back and came home frame for frame identical, awkward
reciprocals included (75% → 133%, 40% → 250%). Checked the whole way through too:
a three-shot render with only its middle shot slowed reconstructed to footage
byte-identical to the original camera file.

Two things it still can't do, both said in the Actions log:

- **Sound doesn't come back.** Retimed footage renders silent in either
  direction, so there was never any audio in the stretched file to restore.
- **A slow-down more extreme than anything the app offers can't be inverted** —
  undoing it would need a speed past what the renderer accepts. You can only get
  there by editing a project file by hand; those shots stay stretched and are
  named in the log.

**One thing to know:** a reconstruction where *some* shots were slowed and others
weren't now arrives as more than one clip on V2 — one per run of matching speed.
A single clip can only carry one speed, and a single box can only show one
duration, so the seam is where the timing genuinely changes rather than a lie
about it. Reconstructing a sequence with one speed throughout (or none at all)
still gives you the one fused clip it always did, and **V2 Render** joins the
whole chain into one file either way.

Also fixed: the Speed dropdown reads the clip's actual speed. A reconstructed
clip at 200% used to display "100%", because the menu only lists slow-downs and a
menu with no matching entry shows its first one.

Numbering note: this changes behavior that existed before, which the project's
own rule calls a major bump — but the app is still `0.x`, where that same
convention puts breaking changes in the minor slot. `1.0.0` should mean the app
is stable, not that Reconstruct got better, so this is 0.27.0.

## 0.26.1 — 2026-08-24

**Reconstruct now cuts on the right frame when V1 changed any timing**

Reconstruct works out where each of V1's shots ended up in the rendered file and
cuts V2 there. It was working that out in plain seconds, but a render lays footage
down in whole **frames** — it rounds each shot to a frame boundary, and it stretches
a slowed shot by repeating frames. So the two disagreed, slightly, and the
disagreement piled up shot after shot.

The effect was a cut landing a frame or several off. On a real 3-shot render here
(24fps, hand-dragged trim points, one shot at 0.75× and one at 0.5×, with head,
tail and Raise holds) the second shot was being cut **two frames early** — so
Reconstruct handed back that shot two frames short with two frames of the *next*
shot stuck on the end, and reported the sequence a frame shorter than it was.
Worst case measured across 3000 generated sequences was 27 frames — nearly half a
second at 60fps.

It now counts in frames the same way the render does, so the boundaries match
exactly. That was verified against an actual render, not just on paper: predicted
92 frames, rendered 92 frames, every cut on a whole frame.

The error was worst on exactly the shots whose speed you had changed, because a
slow-down multiplies it — a 0.2× shot could be off by five frames on its own.
Sequences with frame-aligned trim points and no speed changes were already
correct and are unaffected.

**Half-frames now round the way ffmpeg rounds them**

A shot's length in frames often works out to exactly a half — a 0.4× or 0.2×
shot does it constantly. ffmpeg breaks that tie by rounding to the nearest *even*
frame; the app was rounding up. So on roughly one timeline in five, one shot was
predicted a frame longer than it renders, and everything after it shifted. Fixed
at the root, so Reconstruct, the V2 Batch Analyzer and Raise all agree with the
render now. Checked against 2500 generated timelines run through the real
renderer, 632 of whose shots land on exactly a half frame: every one matches.

**Round Up now lands on the whole second**

Round Up measured the timeline instead of the render, so it was wrong both ways:
it offered a round-up on a sequence that already came out whole — and pressing it
made the render a frame *longer* than the second it promised — and it said
"whole" about sequences that didn't come out whole. On a real 30fps render that
comes out at exactly 4.5s, it offered "+0.48s → 5s", and that actually rendered
to 4.967s. It now offers +0.50s, which renders to exactly 5.000s.

Where the whole second genuinely can't be hit — the freeze is measured on the
last clip's frame rate, so on a mixed-frame-rate timeline it moves the total in
steps bigger than one frame — it adds the smallest freeze that reaches the second
rather than falling short of it, and the readout says `≈ 5s` with the reason in
its tooltip instead of promising a number it won't hit.

**Reconstruct says how much slow-down is baked in, not just that some is**

Its warning about slowed shots now gives the numbers: how many seconds of original
footage are sitting there as how many seconds of stretched footage, and how much of
that is repeated frames. It also says plainly that the app has no speed-up to
compress it back with, and that the cut points themselves *do* account for the
stretch — so the warning describes one specific limit instead of sounding like
Reconstruct ignored speed altogether.

**No more "not rounded up" warnings about clips that come out whole**

The log's per-clip round-up warning measured a clip on its own. A hold that sits
in the middle of the sequence is discarded by the render, and a clip's length is
counted on the sequence's frame rate rather than its own — so the log could warn
that a clip needed rounding while the render landed it exactly on a whole second
and Round Up sat greyed out beside it. It now measures each clip's real
contribution to the render.

**V2 Batch Analyzer** cuts on the same boundaries, so it got the same fix.

## 0.26.0 — 2026-08-24

**A warning when a V1 edit throws footage away for good**

Reconstruct on V2 can only rebuild what a V1 render actually contains. Footage
you trim off or delete is never written to the file, so there is nothing left for
it to restore from — and until now the app said nothing about it until you tried
to reconstruct and got back less than you expected.

Narrowing a V1 clip's trim or deleting a V1 clip now raises a short popup saying
how many seconds of which file just left the sequence, and why Reconstruct can't
get them back. It's informational: the edit stands, one OK dismisses it, and
Cmd+Z still undoes the edit if you changed your mind.

It appears **once per session** — trimming is the most common thing you do here,
so a popup on every trim would just be noise — and there's a **Don't show this
again** checkbox if you don't want it at all.

Deliberately quiet about things that don't lose footage: moving clips, splitting
them, deleting a hold segment, widening a trim, or Reset. Dragging an edge inward
and back out again nets to nothing and stays silent too. V2 edits never warn —
V2 is where a reconstruction lands, not what it's built from.

Speed and crop changes are equally impossible for Reconstruct to undo, but they
aren't something you do by accident, and Reconstruct already reports both in its
own log, so they don't trigger the popup.

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
