#!/bin/bash
#
# GenAI Editor launcher — double-click this file in Finder.
#
# macOS has no .bat; a .command file with the execute bit set is the
# double-clickable equivalent, and Finder hands it to Terminal.
#
# What it does, in order:
#   1. checks/repairs setup (ffmpeg, node, .venv, node_modules, runtime dirs)
#   2. opens one Terminal window for the Flask backend  (127.0.0.1:5001)
#   3. opens one Terminal window for the Vite frontend  (127.0.0.1:5173)
#   4. waits for both to answer, then opens the app in your browser
#
# Anything already listening on 5001 or 5173 is REUSED, never killed —
# killing Flask mid-render orphans the encode and leaves a staged file in
# output/.partials/, and an existing Vite is usually someone's own session.
#
# The same file is also the per-server entry point: `start.command --backend`
# and `--frontend` run one server in the foreground. That is how the two
# Terminal windows are told what to run, and it keeps this a single file
# instead of three that can drift apart.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_URL="http://127.0.0.1:5001"
FRONTEND_URL="http://127.0.0.1:5173"

# Homebrew is not on PATH for a Finder-launched process — no login shell runs,
# so ffmpeg and node are invisible until this line. Guarded because an Intel
# Mac (or no Homebrew at all) must fall through to the check below, not abort.
[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
[ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"

say()  { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n  \033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

port_pids() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null; }
port_busy() { [ -n "$(port_pids "$1")" ]; }

# ---------------------------------------------------------------- per-server
# These two branches run INSIDE the Terminal windows the launcher opens, in
# the foreground, so their logs are live and Ctrl+C stops that server.

if [ "${1:-}" = "--backend" ]; then
  printf '\033]0;GenAI Editor — backend :5001\007'
  cd "$REPO_ROOT" || exit 1
  # shellcheck disable=SC1091
  source .venv/bin/activate || exit 1
  echo "--- Flask on $BACKEND_URL — Ctrl+C to stop ---"
  exec python3 app.py
fi

if [ "${1:-}" = "--frontend" ]; then
  printf '\033]0;GenAI Editor — frontend :5173\007'
  cd "$REPO_ROOT/frontend" || exit 1
  echo "--- Vite on $FRONTEND_URL — Ctrl+C to stop ---"
  exec npm run dev
fi

# -------------------------------------------------------------------- launch

cd "$REPO_ROOT" || die "cannot enter $REPO_ROOT"

printf '\033]0;GenAI Editor — launcher\007'
printf '\n  GenAI Editor %s\n  %s\n\n' "$(cat VERSION 2>/dev/null || echo '?')" "$REPO_ROOT"

# --- setup checks ---------------------------------------------------------

command -v ffmpeg >/dev/null 2>&1 \
  || die "ffmpeg not found. Install it with:  brew install ffmpeg
    (no Homebrew yet? see STEP 1 of README.txt)"
ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"

command -v npm >/dev/null 2>&1 \
  || die "node/npm not found. Install it with:  brew install node"
ok "node $(node --version 2>/dev/null)"

mkdir -p input output projects

if [ ! -x .venv/bin/python3 ]; then
  say "creating .venv (first run — this takes a minute)"
  python3 -m venv .venv || die "could not create .venv"
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements.txt || die "pip install failed"
  ok "python venv created"
elif ! .venv/bin/python3 -c 'import flask' >/dev/null 2>&1; then
  say "installing Python dependencies into .venv"
  .venv/bin/pip install --quiet -r requirements.txt || die "pip install failed"
  ok "python venv repaired"
else
  ok "python venv"
fi

if [ ! -d frontend/node_modules ]; then
  say "installing frontend packages (first run — this takes a minute)"
  ( cd frontend && { npm ci --silent || npm install --silent; } ) \
    || die "npm install failed"
  ok "frontend packages installed"
else
  ok "frontend packages"
fi

# vite.config.js aborts the dev server if frontend/package.json's version has
# drifted from root VERSION. Catch it here — a hard fail in the frontend
# window looks like a broken app rather than a one-command fix.
if ! python3 - <<'PY'
import json, pathlib, sys
root = pathlib.Path.cwd()
v = (root / 'VERSION').read_text().strip()
p = json.loads((root / 'frontend' / 'package.json').read_text()).get('version')
sys.exit(0 if v == p else 1)
PY
then
  warn "VERSION and frontend/package.json disagree — syncing"
  python3 bump_version.py --sync || die "version sync failed; run: python3 bump_version.py --sync"
fi

# --- start the servers ----------------------------------------------------

# Opens a NEW Terminal window running this same file in --backend/--frontend
# mode.
#
# Done with `open -a Terminal <script>` and a throwaway wrapper, NOT with
# osascript `do script`: AppleScript into Terminal is an AppleEvent, which
# needs Automation permission, and without it the call dies with
# `AppleEvent timed out (-1712)` — measured, and it fails silently enough that
# the app just looks broken. `open` goes through LaunchServices and needs no
# permission. The wrapper exists only because `open -a` cannot pass arguments.
LAUNCH_DIR="${TMPDIR:-/tmp}/genai-editor-launch"

open_window() { # mode ("--backend" / "--frontend"), window label
  mkdir -p "$LAUNCH_DIR"
  local wrapper="$LAUNCH_DIR/GenAI Editor $2.command"
  # The Terminal window's title comes from the wrapper's filename, so the two
  # windows are tellable apart at a glance.
  {
    printf '#!/bin/bash\n'
    printf 'exec %q %s\n' "$REPO_ROOT/start.command" "$1"
  } > "$wrapper"
  chmod +x "$wrapper"
  open -a Terminal "$wrapper"
}

if port_busy 5001; then
  ok "backend already running on :5001 — reusing it"
else
  say "starting backend…"
  open_window --backend backend
fi

if port_busy 5173; then
  ok "frontend already running on :5173 — reusing it"
else
  say "starting frontend…"
  open_window --frontend frontend
fi

# --- wait for both, then open the browser ---------------------------------

wait_for() { # url, label, seconds
  local i=0
  until [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' "$1" 2>/dev/null)" = "200" ]; do
    i=$((i + 1))
    [ "$i" -ge "$3" ] && return 1
    sleep 1
  done
  ok "$2 responding"
}

say "waiting for the servers…"
wait_for "$BACKEND_URL/api/files" "backend" 30 \
  || die "backend never answered on :5001 — read the error in its Terminal window"
# Vite's port is not pinned (strictPort is unset), so it slides to 5174 if
# something else holds 5173. Checked explicitly: a wrong-port launch otherwise
# just looks like the app failing to load.
if ! wait_for "$FRONTEND_URL/" "frontend" 40; then
  if [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:5174/ 2>/dev/null)" = "200" ]; then
    warn "5173 was taken — Vite moved to 5174"
    FRONTEND_URL="http://127.0.0.1:5174"
  else
    die "frontend never answered on :5173 — read the error in its Terminal window"
  fi
fi

printf '\n  opening %s\n\n' "$FRONTEND_URL"
open "$FRONTEND_URL"

say "Both servers keep running in their own Terminal windows."
say "To stop the app, press Ctrl+C in each of them (or close the windows)."
printf '\n  This launcher window can be closed.\n\n'
