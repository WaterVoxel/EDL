---
name: share-project
description: Build a verified, portable copy of GenAI Editor to hand to someone else — media-free folder plus versioned zip on the Desktop
---

Use this when the user wants to give this project to another person or another machine.

The product is two things on the Desktop, both carrying the version from `VERSION` at the repo root:
`~/Desktop/nara-editor-<version>/` (a folder they can browse) and `~/Desktop/nara-editor-<version>.zip`
(the thing they actually send). Re-sharing the *same* version overwrites both in place, so an
incremental re-share is the same procedure, not a special case.

**One hard rule: never mutate the working tree to make the share.** The user's app keeps running
throughout. Nothing is deleted from `input/`, `output/`, `.venv/`, or `node_modules/` — the share is
a copy with things left out, not a cleanup. If a portability problem turns up, fix it in the *source*
so the repo improves too (see step 0), never only in the copy.

Every command runs from the repo root — the folder containing `app.py` — unless it says otherwise.

## The two shell variables every block uses

```bash
V=$(cat VERSION); S=~/Desktop/nara-editor-$V; echo "$V -> $S"
```

Shell state does not survive between commands, so **each block below re-derives these itself.** Never
type a version literal: the filename is the handle on which build someone has, and a hand-typed one
that disagrees with what the app reports is worse than no version at all. Blocks that need to work on
the Desktop use a `( cd ~/Desktop && … )` subshell so the outer shell stays at the repo root.

## Why the excludes are what they are

The working tree is ~5.6 GB. The share is ~3 MB. Almost all of the difference is media
(`input/` 2.6 GB + `output/` 2.6 GB), not build directories.

| Left out | Size | Why |
|---|---|---|
| `.venv/` | 20 MB | **Ships broken.** `.venv/bin/activate` bakes in an absolute `VIRTUAL_ENV=` path; it fails the moment the folder moves. Recipient runs `python3 -m venv .venv` + `pip install -r requirements.txt`. |
| `frontend/node_modules/` | 71 MB | **Ships broken.** Contains `darwin-arm64` native binaries (`@rolldown/binding-darwin-arm64`, `lightningcss-darwin-arm64`, `@tailwindcss/oxide-darwin-arm64`) — wrong architecture on an Intel Mac. Recipient runs `npm ci` from the tracked `package-lock.json`. |
| `.preview_cache/` | 250 MB | Transcoded previews only; `ffmpeg_utils.py` recreates the directory on demand. |
| `frontend/dist/` | 780 KB | Build output. Nothing serves it — it exists purely as a compile check. |
| `input/*`, `output/*` | 5.2 GB | The user's media. The *directories* still travel (step 2) — only their contents are dropped. |
| `projects/` | 116 KB | Excluded deliberately: every `.nara` references media that isn't in the share, so opening one just reports missing files. Safe to omit — `list_projects` (`app.py:155-163`) calls `os.makedirs(..., exist_ok=True)` before listing and filters on `.nara`, so the directory self-heals on first request. Verified. |
| `.git/` | 5.9 MB | Keeps the handoff a clean standalone folder. Mention to the user that including it would hand over full history *and* a dirty working tree. |

`VERSION` itself always travels — it is what makes the copy able to state which build it is, and the
backend serves it at `GET /api/version`.

**Do not use `git archive`.** Work in this repo is routinely uncommitted, so it would ship stale
code. Copy the working tree. This is also why the version cannot come from a git tag: the share has
no `.git/`, so a tag would not survive the trip.

## Steps

1. **Preflight.** All checks must pass before copying anything:

   ```bash
   test -f app.py && test -f requirements.txt && test -f VERSION && echo "repo root OK"
   python3 bump_version.py --show
   python3 bump_version.py --sync
   git status --short
   grep -rIl "/Users/sarmieaj" . --exclude-dir=.git --exclude-dir=.venv \
     --exclude-dir=node_modules --exclude-dir=.preview_cache --exclude-dir=dist || echo "no personal paths"
   cat .export_settings.json
   grep -m1 "^## " CHANGELOG.md
   ```

   - `--sync` must print `already in step`. If it *updated* `frontend/package.json`, the version had
     drifted — the fix has now been made in the working tree, so mention it in the report rather than
     shipping past it silently.
   - The newest `CHANGELOG.md` heading must be the version you are about to ship. A share whose
     changelog stops one version short is the recipient reading about someone else's build.
   - Uncommitted files are expected and *do* travel — that is intended, but name them in the final
     report so the user knows exactly which state they shipped.
   - A hit on `/Users/sarmieaj` means a personal path regressed. The two that matter are already
     fixed and must stay fixed: `CLAUDE_BIN = shutil.which("claude") or ...` (`app.py:18`) and
     `_tool()` → `FFMPEG`/`FFPROBE` (`ffmpeg_utils.py:32-46`, which prefers `/opt/homebrew/bin` then
     falls back to PATH so an Intel Mac still renders). Fix the source file, not the copy.
   - `.export_settings.json` must not carry an absolute `output_dir`. `{"quality": "..."}` alone
     travels fine; `default_output_dir` is derived from the repo root at request time.
   - A stray `*.zip` in the repo root is a leftover from an earlier share. Step 2's `--exclude '*.zip'`
     keeps it out of the copy, but flag it — it is untracked and not gitignored.

2. **Copy.** This exact exclude set — each flag is load-bearing, see Traps below:

   ```bash
   V=$(cat VERSION)
   rsync -a --delete \
     --exclude '.venv' --exclude '.preview_cache' --exclude 'frontend/node_modules' \
     --exclude 'frontend/dist' --exclude '.git' --exclude '.DS_Store' \
     --exclude '__pycache__' --exclude 'input/*' --exclude 'output/*' \
     --exclude 'projects' --exclude '.gitkeep' --exclude '*.zip' \
     ./ ~/Desktop/nara-editor-$V/
   ```

3. **Recreate the runtime directories.** Non-negotiable, and easy to lose:

   ```bash
   S=~/Desktop/nara-editor-$(cat VERSION)
   touch $S/input/.gitkeep $S/output/.gitkeep
   ls -a $S/input $S/output
   ```

   `_list_dir` (`app.py:66-72`) calls `os.listdir(base)` unguarded, so a missing `input/` makes
   `GET /api/files` return **HTTP 500** — the app looks broken on first launch. Zipping silently
   discards empty directories, hence `.gitkeep`. It is invisible to the app: `_list_dir` filters on
   `fu.MEDIA_EXTENSIONS`.

4. **Verify the backend, against the copy.** Uses Flask's test client, so it binds no port and the
   user's running servers are untouched. The `assert` is the point — without it you can silently test
   the original tree instead of the copy:

   ```bash
   .venv/bin/python - <<PY
   import sys, os
   COPY = os.path.expanduser("~/Desktop/nara-editor-$(cat VERSION)")
   sys.path.insert(0, COPY)
   import app as a, ffmpeg_utils as fu
   assert fu.PROJECT_ROOT == COPY, f"loaded the WRONG tree: {fu.PROJECT_ROOT}"
   c = a.app.test_client()
   for route in ["/", "/api/files", "/api/outputs", "/api/projects", "/api/export_settings", "/api/version"]:
       r = c.get(route)
       d = r.get_json() if r.is_json else None
       n = f"  {len(d)} item(s)" if isinstance(d, list) else ""
       print(f"{route:22} -> {r.status_code}{n}")
       assert r.status_code == 200, r.get_data(as_text=True)[:300]
   v = c.get("/api/version").get_json()["version"]
   assert COPY.endswith(v), f"archive name says {COPY[-12:]!r} but the copy reports {v!r}"
   print("version:", v, "(matches the folder name)")
   print("NOISE_ASSET present:", os.path.exists(fu.NOISE_ASSET))
   print("ALL 200")
   PY
   ```

   Note the unquoted `<<PY` — the heredoc has to expand `$(cat VERSION)`. Expect `200` on all six,
   empty lists for files/outputs/projects, and `NOISE_ASSET present: True`. A **500** on `/api/files`
   or `/api/outputs` means step 3 did not take. The version assert is what proves the *copy* reports
   the number on its own filename, rather than the two happening to agree on this machine.

5. **Verify the frontend, in a throwaway copy of the share.** Build in `/tmp`, never in the share
   folder itself, or `node_modules/` and `dist/` end up in the zip:

   ```bash
   eval "$(/opt/homebrew/bin/brew shellenv)"
   V=$(cat VERSION)
   rm -rf /tmp/zz_share_fe && mkdir -p /tmp/zz_share_fe
   rsync -a ~/Desktop/nara-editor-$V/ /tmp/zz_share_fe/
   cd /tmp/zz_share_fe/frontend
   npm ci 2>&1 | tail -3
   npx vite build 2>&1 | tail -6
   out=$(npm run lint 2>&1)
   echo "warnings: $(printf '%s' "$out" | grep -c ': warning ')  errors: $(printf '%s' "$out" | grep -c ': error ')"
   grep -c "$V" dist/assets/index-*.js
   ```

   This proves `package-lock.json` and every `src/` import made it across — it is the recipient's
   `npm ci` rehearsed. Expect `✓ built in <1s`, a bundle near 430 kB, and the project's lint
   baseline: **7 warnings, 0 errors** (oxlint prints no summary footer, hence the `grep -c`).

   The `grep -c "$V"` must be non-zero: `vite.config.js` reads `VERSION` and feeds it to the client as
   `import.meta.env.VITE_APP_VERSION`, so a zero here means the copy's build produced a bundle that
   cannot tell anyone which version it is. That build would also have *failed* if `frontend/package.json` had drifted
   from `VERSION` — the config throws on mismatch — so a clean build is itself the drift check.

   While that scratch build exists, confirm the CONTACT colophon survives compilation — it is the
   recipient's only way to report a bug:

   ```bash
   for s in "CONTACT" "Julian Sarmiento" "mailto:sarmieaj@amazon.com" "LAX22-CO"; do
     grep -qF -- "$s" dist/assets/index-*.js && echo "  PRESENT  $s" || echo "  MISSING  $s"
   done
   cd /tmp && rm -rf /tmp/zz_share_fe
   ```

6. **Verify the copy against the working tree.** The strongest single check — it catches a partial
   rsync, a stale file `--delete` failed to remove, and anything edited in the copy by mistake:

   ```bash
   diff -rq --exclude=.git --exclude=.venv --exclude=.preview_cache --exclude=node_modules \
     --exclude=dist --exclude=__pycache__ --exclude=.DS_Store --exclude=.gitkeep \
     . ~/Desktop/nara-editor-$(cat VERSION) 2>/dev/null | grep -v "^Only in ./\(input\|output\|projects\)"
   ```

   Expect **no output**. Any `Files ... differ` line is a real defect. `Only in` lines for
   `input/`, `output/`, `projects/` are the deliberate exclusions.

7. **Inventory.** Presence of the files that are individually easy to lose and individually fatal:

   ```bash
   S=~/Desktop/nara-editor-$(cat VERSION)
   for f in README.txt agentic_installation.MD CLAUDE.md ARCHITECTURE.txt requirements.txt \
            VERSION CHANGELOG.md bump_version.py \
            app.py ffmpeg_utils.py .export_settings.json .gitignore \
            frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/index.html \
            frontend/assets/Audio_NOISE.wav frontend/public/icon_editor.png static/icon_editor.png \
            templates/index.html static/style.css static/app.js input/.gitkeep output/.gitkeep; do
     [ -f "$S/$f" ] && printf "  OK   %-42s %8s bytes\n" "$f" "$(stat -f%z "$S/$f")" || printf "  MISS %s\n" "$f"
   done
   grep -n "host:" $S/frontend/vite.config.js
   find $S \( -name .DS_Store -o -name __pycache__ -o -name node_modules -o -name .venv -o -name dist -o -name '*.zip' \)
   du -sh $S; find $S -type f | wc -l
   ```

   - `VERSION` and `CHANGELOG.md` are the recipient's answer to "what am I running and what changed";
     `bump_version.py` is how their own future edits stay numbered. All three are small and all three
     are easy to leave out of an exclude-driven copy without noticing.
   - `Audio_NOISE.wav` is the room-tone (noise) asset (588 KB) — without it the A1 Noise toggle fails at
     render time, not at startup, so nothing else catches it.
   - **Both** icon copies are required: Vite only serves `frontend/public/`, Flask only serves
     `static/`.
   - The `host:` pin in `vite.config.js` is load-bearing for the dev-server proxy.
   - `.DS_Store` hits here are expected and harmless — step 8 excludes them at zip time.
   - Anchor: **100 files, 4.0 MB** as of 2026-08-19, plus the three version files added in 0.25.0. A
     large jump means something leaked in.

8. **Zip.** `-x '*.DS_Store'` is required, not tidiness — see Traps:

   ```bash
   V=$(cat VERSION)
   ( cd ~/Desktop && rm -f nara-editor-$V.zip \
     && zip -rq nara-editor-$V.zip nara-editor-$V -x '*.DS_Store' \
     && echo "built: nara-editor-$V.zip  $(du -h nara-editor-$V.zip | cut -f1), $(unzip -l nara-editor-$V.zip | tail -1)" )
   ```

   The `rm -f` targets only the archive for *this* version — the one being rebuilt. Older
   `nara-editor-*.zip` files on the Desktop are previous releases someone may still be holding; list
   them in the report and let the user decide, never delete them here.

9. **Verify the archive itself**, reading files straight out of it rather than trusting the folder:

   ```bash
   V=$(cat VERSION); R=$(pwd)
   ( cd ~/Desktop
     Z=nara-editor-$V.zip; D=nara-editor-$V
     unzip -l $Z | grep -E "input/\.gitkeep|output/\.gitkeep"   # both must appear
     unzip -Z1 $Z | grep -cE "\.zip$|DS_Store"                  # must be 0
     echo "VERSION inside archive: [$(unzip -p $Z $D/VERSION | tr -d '\n')]  filename says [$V]"
     unzip -p $Z $D/ffmpeg_utils.py | grep -c "NOISE_GAIN_DB"
     diff <(unzip -p $Z $D/app.py) $R/app.py && echo "app.py in archive is current" )
   ```

   The `VERSION inside archive` line must match the filename exactly — that is the whole point of
   putting the number in the name. Spot-check whatever feature was most recently changed this way
   too; the archive is what ships, so it is the only artifact whose contents count.

10. **Optional: rehearse the recipient's first move.** Worth it for a first-time share or after any
    dependency change:

    ```bash
    eval "$(/opt/homebrew/bin/brew shellenv)"
    V=$(cat VERSION)
    rm -rf /tmp/zz_recipient && mkdir -p /tmp/zz_recipient
    unzip -q ~/Desktop/nara-editor-$V.zip -d /tmp/zz_recipient
    cd /tmp/zz_recipient/nara-editor-$V/frontend && npm ci 2>&1 | tail -1 && npx vite build 2>&1 | tail -4
    cd /tmp && rm -rf /tmp/zz_recipient
    ```

11. **Confirm the working tree is untouched**, then report:

    ```bash
    cd /Users/sarmieaj/Documents/Claude/ffmpeg && git status --short
    ```

    Same modified list as step 1, no deletions — with one legitimate exception: if step 1's
    `--sync` repaired a drifted `frontend/package.json`, that file will be modified. Say so.

## Traps (each one cost real time)

- **Zip-in-zip.** A `nara-editor-*.zip` left in the repo root gets rsynced into the copy and then
  zipped inside the new archive — 6.2 MB / 153 files instead of 3.1 MB / 152. `--exclude '*.zip'`
  fixes both directions; if a nested one is already in the copy, `rm -f` it once (the exclude then
  also protects it from `--delete` forever, so it never leaves on its own).
- **A hand-typed version in a filename.** Always `$(cat VERSION)`. An archive named for a version the
  app inside does not report is actively misleading — worse than an unversioned name, because it gets
  believed. Step 4 and step 9 both assert the two agree.
- **A bump between steps.** The blocks re-read `VERSION` independently, so bumping the version
  halfway through a share splits the work across two folders. Finish the share, then bump.
- **`.DS_Store` comes back.** Finder writes one the instant anyone opens the folder, so the rsync
  exclude alone is not enough — the folder legitimately contains several by the time you zip.
  Excluding at *zip* time (`-x '*.DS_Store'`) is what keeps the shipped archive clean.
- **`--exclude '.gitkeep'` is mandatory on any re-sync.** The `.gitkeep` files exist only in the
  copy, so `--delete` would remove them — silently reintroducing the `/api/files` 500 on a share that
  worked yesterday.
- **`input/*`, not `input`.** With the trailing `/*` the directory itself is still created and only
  its contents are skipped. Excluding `input` outright means no directory at all.
- **`projects` has no `/*`** — that one is excluded wholesale on purpose, because it self-heals.
- **Never `git archive`.** It ships committed state; this repo's useful state is usually uncommitted.
- **Build only in `/tmp`.** One `npm ci` inside the share folder adds 71 MB of wrong-architecture
  binaries to the zip.

## What the recipient does

Nothing but open `README.txt`. Its OPTION A hands the job to Claude via `agentic_installation.MD`,
which covers exactly what the share is missing: create the venv, `npm ci`, create `input/`/`output/`,
start both servers, and prove `127.0.0.1:5001` and `127.0.0.1:5173` respond. OPTION B is the manual
path for someone without Claude Code.

## Report to the user

State the zip's **name** (it carries the version), size and file count, the exact uncommitted files
that shipped, and these caveats:

- `input/` is empty, so the file list is empty on first launch — they must drag in footage before
  anything is renderable.
- `projects/` is absent; the Projects panel starts empty and fills as they save.
- No git history travelled, so no tags either — `VERSION`, the toolbar readout, and
  `GET /api/version` are how the recipient names their build in a bug report.
- Any older `nara-editor-*.zip` still sitting on the Desktop, so the user can tell them apart or
  clear them out themselves.
- `.claude/` (docs, skills, proposals) *does* travel — it is what makes the project work well with
  Claude Code on the recipient's machine, and `CLAUDE.md` references it.
