NARA LOSSLESS EDITOR
====================

A local, EDL-style video editor. Every edit -- trim, splice, reverse,
slow down, hold, round-up -- is staged as a non-destructive decision and
only applied to your media when you click Render. Your original files
are never changed.

This guide assumes no prior experience. Follow the steps in order.

Once the app is running, click "NARA LOSSLESS EDITOR" in the top bar for
a full explanation of its features from inside the app.


STEP 0: OPEN THE TERMINAL APP
------------------------------

All the commands below are typed into the "Terminal" app on your Mac.

To open it: press Cmd+Space, type "Terminal", press Enter.

A window with a text prompt will appear. Type each command exactly as
shown below, then press Enter to run it.


STEP 1: INSTALL THE REQUIRED TOOLS (ONE-TIME SETUP)
-----------------------------------------------------

You need three things installed: Homebrew, ffmpeg, and Node.js.
Skip any step below if you already have that tool.

1a. Install Homebrew (a package installer for Mac). Paste this into
    Terminal and press Enter, then follow any on-screen prompts:

    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

1b. Install ffmpeg (the video-processing engine this app relies on):

    brew install ffmpeg

1c. Install Node.js (needed to run the app's interface):

    brew install node

To check that everything installed correctly, run:

    ffmpeg -version
    node -version

Each command should print a version number, not an error.


STEP 2: OPEN TWO TERMINAL WINDOWS
------------------------------------

The app has two parts that must run at the same time, each in its own
Terminal window. Keep both windows open the whole time you're using the
app.

Open a second Terminal window now: press Cmd+N while Terminal is open
(or Cmd+T for a new tab). You should have two Terminal windows/tabs
side by side.


STEP 3: START THE APP (BACKEND)
----------------------------------

In your FIRST Terminal window, type these three commands one at a time,
pressing Enter after each:

    cd ~/Documents/Claude/ffmpeg
    source .venv/bin/activate
    python3 app.py

Or

 cd ~/Documents/Claude/ffmpeg && source .venv/bin/activate && python3 app.py


If this is the very first time running the app and you see an error
mentioning "Flask", run this once and then try "python3 app.py" again:

    pip install -r requirements.txt

When it's working, you'll see a message that looks like:

    * Running on http://127.0.0.1:5001

Leave this window open and running. This is the app's engine.


STEP 4: START THE APP (INTERFACE)
------------------------------------

In your SECOND Terminal window, type these commands one at a time:

    cd ~/Documents/Claude/ffmpeg/frontend
    npm install
    npm run dev

Or

 cd ~/Documents/Claude/ffmpeg/frontend && npm run dev


"npm install" only needs to run the first time (it downloads some files)
-- it may take a minute or two. After that, "npm run dev" will print
something like:

    Local:   http://127.0.0.1:5173/

Leave this window open and running too. This is the app's interface.


STEP 5: OPEN THE APP
-----------------------

Open your web browser (Safari, Chrome, etc.) and go to the address
printed in Step 4 -- usually:

    http://127.0.0.1:5173/

The Nara Lossless Editor should now load in your browser.


STEP 6: STOPPING THE APP
----------------------------

When you're done, click into each Terminal window and press Ctrl+C to
stop it. It's safe to close both windows after that.


THE NEXT TIME YOU WANT TO USE THE APP
----------------------------------------

You don't need to repeat Step 1. Just do Steps 2 through 5 again:
two Terminal windows, run the Step 3 commands in one (you can skip the
"pip install" line after the first time), run the Step 4 commands in
the other (you can skip "npm install" after the first time), then open
the browser address from Step 5.


WHERE YOUR FILES GO
-----------------------

input/     Your original video files, uploaded through the app.
           These are never modified or deleted automatically.
output/    Finished, rendered videos land here by default.
           You can change this location in the app: click the gear
           icon in the Exports panel.
projects/  Saved project files, so you can close the app and pick up
           an edit later. Use the Library/Save buttons in the app.


TROUBLESHOOTING
-------------------

"Address already in use" when starting the app
    Something is already using that spot on your computer. Try:
        lsof -ti :5001 | xargs kill
    Then try Step 3 again. (Use :5173 instead of :5001 if the frontend
    is the one showing this error.)

The app says it can't find ffmpeg
    Re-run Step 1b (brew install ffmpeg), then restart Step 3.

The chat/assistant panel shows an error
    That one feature needs an extra tool (the "claude" command-line
    app) that most people won't have installed. Everything else in the
    editor works fine without it.
