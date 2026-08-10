---
name: run-app
description: Start (or restart) the Nara editor locally — Flask backend + Vite frontend dev servers
---

The app needs two servers. The React UI 404s on every fetch if Flask isn't up.

## Steps

1. Load Homebrew paths (ffmpeg/node are NOT on PATH by default in this environment):

   ```bash
   eval "$(/opt/homebrew/bin/brew shellenv)"
   ```

2. Kill any stale backend, then start Flask (port 5001):

   ```bash
   cd /Users/sarmieaj/Documents/Claude/ffmpeg
   lsof -ti :5001 | xargs kill 2>/dev/null; sleep 1
   source .venv/bin/activate && nohup python3 app.py > /tmp/flask_dev.log 2>&1 &
   sleep 2 && curl -s http://127.0.0.1:5001/api/files
   ```

   The curl should return a JSON list (possibly empty). If Flask errors about a missing module: `pip install -r requirements.txt` inside the venv.

3. Check whether the Vite dev server is already running before starting a second one:

   ```bash
   lsof -ti :5173
   ```

   If nothing is listening:

   ```bash
   cd /Users/sarmieaj/Documents/Claude/ffmpeg/frontend
   npm install   # first time only
   nohup npm run dev > /tmp/vite_dev.log 2>&1 &
   ```

   Vite prints its actual port (5173, or the next free one) in /tmp/vite_dev.log.

4. The app is at http://127.0.0.1:5173/ (React UI). The legacy fallback UI is at http://127.0.0.1:5001/.

## Cleanup

When done testing, kill the Flask instance you started (`lsof -ti :5001 | xargs kill`) and delete any test renders you created in `output/`. Leave a Vite server alone if it was already running before you started (it's often the user's own session).
