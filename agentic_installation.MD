# agentic_installation — setup runbook for Claude

**Audience: Claude (or any coding agent), not the end user.** You are being asked to install
and configure GenAI Editor on this machine. Work through this file top to bottom.

**Definition of done.** The human does exactly two things afterwards — open these in a browser:

| URL | What it is |
| --- | --- |
| <http://127.0.0.1:5173/> | The React UI. **This is the app.** Use this one. |
| <http://127.0.0.1:5001/> | The Flask backend / legacy fallback UI. Must be up for 5173 to work at all. |

Nothing else. No terminal commands for them, no `npm install`, no directory creation, no config
editing. If any of that is still outstanding when you finish, you are not done.

Both servers are foreground dev servers with no auto-start. They stop when the machine reboots or
the shell dies, so re-running **Phase 5** is a normal recurring task — see
[Restarting later](#restarting-later).

---

## Phase 0 — Preflight

Run these first and **skip any install step whose tool is already present.** Reinstalling
Homebrew or ffmpeg on a working machine wastes several minutes and risks breaking a working setup.

```bash
# Homebrew is NOT on PATH by default in this environment. Every shell needs this line
# before ffmpeg/ffprobe/node/npm/npx resolve. Re-run it in each new shell.
eval "$(/opt/homebrew/bin/brew shellenv)"

cd /Users/sarmieaj/Documents/Claude/ffmpeg   # or wherever the repo was cloned

uname -m                     # expect: arm64
brew --version               # expect: a version, else install Homebrew (Phase 1)
ffmpeg -version | head -1    # expect: ffmpeg version 8.x
ffprobe -version | head -1   # expect: ffprobe version 8.x
node --version               # expect: v20.19+ / v22.12+ / newer (Vite 8 requires this)
npm --version
/usr/bin/python3 --version   # expect: 3.9.x — system python is fine, no brew python needed
```

Reference state, verified on this machine: macOS arm64, Homebrew prefix `/opt/homebrew`,
ffmpeg/ffprobe 8.1.2, node v26.5.0, npm 11.17.0, system python 3.9.6, Vite 8.1.5.

### Blocking architecture constraint — read before installing anything

`ffmpeg_utils.py:19-20` hardcodes absolute binary paths:

```python
FFMPEG  = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
```

`/opt/homebrew` is the **Apple Silicon** Homebrew prefix. On an Intel Mac, Homebrew installs to
`/usr/local` and **every render and probe in the app will fail** even though `ffmpeg -version`
works fine in the shell. If `brew --prefix` prints anything other than `/opt/homebrew`, edit those
two constants to match `$(brew --prefix)/bin/...` before continuing, and tell the user you did.

This app is macOS-only by design (see `CLAUDE.md`). Do not attempt a Linux or Windows setup.

---

## Phase 1 — System dependencies (one time per machine)

Skip anything Phase 0 already found.

```bash
# Homebrew, if missing:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"

brew install ffmpeg   # the render engine — ships ffprobe too; non-negotiable
brew install node     # runs Vite + the React build
```

`brew install ffmpeg` is the slow step (many dependencies). Let it finish; do not interrupt it.

Confirm before moving on — these exact paths must exist, because that is what the Python code
calls:

```bash
test -x /opt/homebrew/bin/ffmpeg  && echo "ffmpeg OK"
test -x /opt/homebrew/bin/ffprobe && echo "ffprobe OK"
```

---

## Phase 2 — Python backend

`requirements.txt` contains exactly one line (`Flask`); `app.py` imports only `json`, `os`,
`subprocess`, `time`, `flask` and `werkzeug` (the latter arrives with Flask). There is nothing
else to install. Use a venv — the system python has no Flask and should not be polluted.

```bash
cd /Users/sarmieaj/Documents/Claude/ffmpeg
python3 -m venv .venv                        # skip if .venv/ already exists
source .venv/bin/activate
pip install -r requirements.txt
```

Verified result: Flask 3.1.3 + Werkzeug 3.1.8 under Python 3.9.6. A fresh 3.9 venv ships pip
21.2.4 and prints an "upgrade pip" warning — **harmless, ignore it.** The install succeeds as-is;
upgrading pip is optional and not required by anything here.

`.venv/` is gitignored, so a fresh clone never has one. If you find a pre-existing `.venv`
containing `pyinstaller`, that is left over from packaging experiments — not a dependency, leave
it alone.

Check it:

```bash
python3 -c "import app; print('backend imports OK')"
```

---

## Phase 3 — Frontend dependencies

A lock file (`frontend/package-lock.json`) **is** tracked in git, so prefer `npm ci` for a
reproducible tree. `npm install` also works but may drift from the lock.

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
cd /Users/sarmieaj/Documents/Claude/ffmpeg/frontend
npm ci
```

Expect React 19, Vite 8, Tailwind 4 and oxlint. `npm warn allow-scripts ... fsevents@2.3.3` and
the `npm audit` notice are **expected and harmless** — do not run `npm audit fix`, and do not
approve scripts.

---

## Phase 4 — Runtime directories and assets

**This phase is mandatory, and it is the one that is easy to miss.** `input/` and `output/` are
gitignored, so they are absent from a fresh clone — and `_list_dir` in `app.py:62-68` calls
`os.listdir()` with no existence guard. Verified on a clean checkout: without these directories,
`GET /api/files` and `GET /api/outputs` both return **HTTP 500 (`FileNotFoundError`)** and the UI
loads to a broken shell. Creating them turns both into a clean `200 []`.

```bash
cd /Users/sarmieaj/Documents/Claude/ffmpeg
mkdir -p input output projects
```

| Path | Role | In a fresh clone |
| --- | --- | --- |
| `input/` | Source media. **Never modified or deleted by the app.** | Missing — you must create it |
| `output/` | Renders land here (overridable via the Exports gear) | Missing — you must create it |
| `projects/` | Saved `.nara` projects | Arrives with 16 tracked `.nara` files; `mkdir -p` is a no-op safeguard |
| `.preview_cache/` | Transcoded preview cache | Created automatically at runtime — leave it alone |
| `.export_settings.json` | Live export config, tracked in git | Present. **Do not overwrite it** |
| `frontend/assets/Audio_NOISE.wav` | Room-tone bed for the A1 Room Tone toggle | Present (~588 KB) — verify, do not regenerate |

Verify the two that matter:

```bash
test -d input && test -d output && echo "dirs OK"
test -f frontend/assets/Audio_NOISE.wav && echo "noise asset OK"
```

If `.export_settings.json` is missing entirely, the backend falls back to built-in defaults, so
the app still runs — do not invent one.

### Optional: the AGENT tab

`app.py:14` hardcodes a user-specific path:

```python
CLAUDE_BIN = "/Users/sarmieaj/.toolbox/bin/claude"
```

If that path does not exist on this machine, the AGENT tab errors when used and **everything else
in the editor works normally.** This is not a setup blocker. Either point `CLAUDE_BIN` at the
local `claude` binary (`which claude`) or leave it and tell the user that one tab is inert.

---

## Phase 5 — Start both servers

Two processes must run at once. If Flask is down, the UI at 5173 loads but every fetch 404s.

```bash
# --- backend on 127.0.0.1:5001 ---
cd /Users/sarmieaj/Documents/Claude/ffmpeg
lsof -ti :5001 | xargs kill 2>/dev/null; sleep 1
source .venv/bin/activate && nohup python3 app.py > /tmp/flask_dev.log 2>&1 &

# --- frontend on 127.0.0.1:5173 ---
eval "$(/opt/homebrew/bin/brew shellenv)"
cd /Users/sarmieaj/Documents/Claude/ffmpeg/frontend
lsof -ti :5173 | xargs kill 2>/dev/null; sleep 1
nohup npm run dev > /tmp/vite_dev.log 2>&1 &
sleep 6
```

Notes that matter:

- `app.py:1640` pins `host="127.0.0.1", port=5001, debug=True`. Ports are **not** configurable
  from the CLI; do not pass flags.
- `debug=True` means Flask's reloader runs **two** Python processes on 5001. That is normal.
  `lsof -ti :5001 | xargs kill` handles both.
- Kill the old Vite before starting a new one. Vite's port is not strict — if 5173 is occupied it
  silently moves to **5174**, which breaks the promised URL. Always check the log for the port it
  actually took.
- If a Vite server was already running and healthy before you started, leave it alone; it may be
  the user's own session.

---

## Phase 6 — Acceptance gate

Do not report success until all five lines below pass. This is the whole deliverable.

```bash
cd /Users/sarmieaj/Documents/Claude/ffmpeg
for u in http://127.0.0.1:5001/ http://127.0.0.1:5001/api/files \
         http://127.0.0.1:5173/ http://127.0.0.1:5173/api/files \
         http://127.0.0.1:5173/api/outputs; do
  printf "%-40s -> %s\n" "$u" "$(curl -s -o /dev/null -m 6 -w '%{http_code}' "$u")"
done
```

**Every line must print `200`.** Interpretation:

| Symptom | Meaning |
| --- | --- |
| `000` on a `5173` line | Nothing listening / wrong bind — see the IPv4 note below |
| `500` on `/api/files` or `/api/outputs` | `input/` or `output/` is missing — redo Phase 4 |
| `200` on 5173 root but `404`/`502` on `/api/*` | Flask is down or on the wrong port — redo Phase 5 backend |

The last two lines are the important ones: they prove Vite's proxy reaches Flask. `vite.config.js`
forwards `/api`, `/input`, `/output` and `/preview` to `http://127.0.0.1:5001`, so the frontend
never talks to port 5001 directly from the browser.

### Why `127.0.0.1:5173` specifically — do not remove this

Vite's default `host` is the string `"localhost"`, which Node on this machine resolves to IPv6
`::1`. A default-configured dev server therefore listens on `[::1]:5173` only: `localhost:5173`
answers, and **`http://127.0.0.1:5173/` is refused (`curl` returns `000`)** — exactly the URL the
user is told to open.

`frontend/vite.config.js` pins `host: '127.0.0.1'` to fix this. That serves *both* spellings and
stays loopback-only. Confirm the bind is IPv4 if anything looks off:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN   # want: TCP 127.0.0.1:5173, NOT [::1]:5173
```

If you ever see `[::1]:5173`, someone removed that `host` line or started Vite bypassing the
config (bare `npx vite`). Restore it rather than telling the user to type `localhost`. Avoid
`host: true` — it publishes the dev server to the local network for no benefit.

Finally, confirm the UI actually mounts rather than white-screening:

```bash
curl -s http://127.0.0.1:5173/ | grep -q 'id="root"' && echo "UI shell OK"
tail -5 /tmp/vite_dev.log     # want "VITE v8.x ready", no stack traces
tail -5 /tmp/flask_dev.log    # want "Running on http://127.0.0.1:5001"
```

---

## Restarting later

Phases 0–4 are one-time. Every later session is just **Phase 5 + Phase 6**. Nothing survives a
reboot; there is no launchd job or service by design.

This repo already ships a `run-app` skill (`.claude/skills/run-app/SKILL.md`) that does exactly
the Phase 5 restart. Prefer invoking it for routine restarts and use this document for first-time
installs and when something is broken.

Stopping:

```bash
lsof -ti :5001 | xargs kill 2>/dev/null
lsof -ti :5173 | xargs kill 2>/dev/null
```

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Address already in use` on start | Old server still bound. `lsof -ti :5001 \| xargs kill` (or `:5173`), then restart. |
| Vite says it is on **5174** | Port 5173 was taken. Kill the old Vite and restart so the promised URL is the live one. |
| `ModuleNotFoundError: No module named 'flask'` | The venv was not activated, or Phase 2 was skipped. `source .venv/bin/activate && pip install -r requirements.txt`. |
| `command not found: ffmpeg` / `node` / `npx` | Homebrew's shellenv was not loaded in this shell. Re-run `eval "$(/opt/homebrew/bin/brew shellenv)"`. |
| App reports it cannot find ffmpeg, but the shell can | Wrong Homebrew prefix vs. the hardcoded paths in `ffmpeg_utils.py:19-20`. See the Phase 0 architecture constraint. |
| Renders fail with no obvious error | Check `/tmp/flask_dev.log` for the ffmpeg stderr the backend captured. |
| `500` from `/api/files` | Missing `input/`. Phase 4. |
| Media Bin empty | Correct on a fresh install — `input/` starts empty. Drop files onto the Media Bin or the V1 track to add sources. |
| AGENT tab errors | Expected unless `CLAUDE_BIN` (`app.py:14`) points at a real `claude` binary. Not a blocker. |

---

## After you change code

Setup and verification are separate concerns, but if this install involved editing anything, run
the project's standard checks before declaring done:

```bash
# Frontend compile check — MUST run from frontend/; from the repo root it fails with
# [UNRESOLVED_ENTRY] Cannot resolve entry module index.html
cd /Users/sarmieaj/Documents/Claude/ffmpeg/frontend && npx vite build

# Lint (oxlint, not eslint). Baseline is exactly 7 warnings / 0 errors — do not "fix" those 7.
npm run lint

# Backend syntax check — MUST run from the repo root
cd /Users/sarmieaj/Documents/Claude/ffmpeg && python3 -m py_compile app.py ffmpeg_utils.py
```

For anything touching the render pipeline, follow the `verify-render` skill instead of eyeballing
output. See `CLAUDE.md` for the full doc and skill map.
