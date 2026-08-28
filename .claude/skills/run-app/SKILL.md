---
name: run-app
description: Start (or restart) the GenAI Editor locally — Flask backend + Vite frontend dev servers
---

The app needs two servers. The React UI 404s on every fetch if Flask isn't up.

Every command below runs from the repo root — the folder containing `app.py` — unless it says
otherwise. The working directory resets between some invocations, so `cd` explicitly rather than
assuming it carried over.

## Steps

1. Load Homebrew paths (ffmpeg/node are NOT on PATH by default in this environment):

   ```bash
   eval "$(/opt/homebrew/bin/brew shellenv)"
   ```

2. Kill any stale backend, then start Flask (port 5001):

   ```bash
   for p in $(lsof -ti :5001); do ps -Eww -p $p | grep -q WERKZEUG_RUN_MAIN=true && kill $p; done; sleep 1
   source .venv/bin/activate && nohup python3 app.py < /dev/null > /tmp/flask_dev.log 2>&1 &
   sleep 2 && curl -s http://127.0.0.1:5001/api/files
   ```

   The curl should return a JSON list (possibly empty). If Flask errors about a missing module: `pip install -r requirements.txt` inside the venv.

   **Signal the worker, not both processes.** `debug=True` runs two Python processes on 5001 — the
   reloader monitor and the worker that serves requests — so the older `lsof -ti :5001 | xargs kill`
   hit both. The monitor sits inside `subprocess.call`, which **SIGKILLs** the worker on its way out,
   so the worker's shutdown handler never runs: a render in flight is orphaned at full CPU and its
   staged file is left in `output/.partials/` (measured: encoder ran 8.5s more, file never committed).
   The loop above kills only the worker — `WERKZEUG_RUN_MAIN=true` is in its environment and not the
   monitor's — and the monitor then exits on its own, so the port still comes free. If something is
   still holding 5001 afterwards it is not a reloader worker (a foreign process, or a Flask started
   without the reloader) and `lsof -ti :5001 | xargs kill` is the right tool for it.

   **Keep the `< /dev/null`.** `nohup` redirects stdout and stderr but not stdin, so without it a
   backgrounded Flask still holds the terminal on fd 0 and the reloader's echo-restoring `tcsetattr`
   raises SIGTTOU, stopping the server at boot — no port 5001, and a log with only the banner in it.
   Harmless from an agent shell (no controlling terminal) and fatal from a real Terminal window, so
   it is easy to "clean up" and never notice. Vite doesn't need it; only this line does.

3. Check whether the Vite dev server is already running before starting a second one:

   ```bash
   lsof -ti :5173
   ```

   If nothing is listening:

   ```bash
   cd frontend
   npm install   # first time only
   nohup npm run dev > /tmp/vite_dev.log 2>&1 &
   ```

   Vite prints its actual port (5173, or the next free one) in /tmp/vite_dev.log.

4. The app is at http://127.0.0.1:5173/ (React UI). The legacy fallback UI is at http://127.0.0.1:5001/.

## Cleanup

When done testing, kill the Flask instance you started (the same worker-only loop as step 2:
`for p in $(lsof -ti :5001); do ps -Eww -p $p | grep -q WERKZEUG_RUN_MAIN=true && kill $p; done`)
and delete any test renders you created in `output/`. Leave a Vite server alone if it was already running before you started (it's often the user's own session).
