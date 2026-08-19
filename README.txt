GENAI EDITOR
============

A local, EDL-style video editor. Every edit -- trim, splice, reverse,
slow down, hold, round-up -- is staged as a non-destructive decision and
only applied to your media when you click Render. Your original files
are never changed.

This guide assumes no prior experience. Follow the steps in order.

Once the app is running, click the document icon at the far right of the
top bar for a full explanation of its features from inside the app. The
lightbulb next to it starts a guided tour.

There are two ways to install. Pick one:

    OPTION A -- let Claude do it for you (below). Fastest, and it
                checks its own work.
    OPTION B -- do it by hand, STEP 0 onward. No extra tools needed.


OPTION A: INSTALL WITH CLAUDE (THE EASY WAY)
---------------------------------------------

If you have Claude Code installed, you can skip STEP 0 through STEP 4
completely. This project ships a setup runbook written specifically for
it: the file "agentic_installation.MD" in this same folder. Claude reads
that file and performs the entire installation itself.

A1. Open the Terminal app: press Cmd+Space, type "Terminal", press
    Enter.

A2. Type these two commands, pressing Enter after each:

    cd ~/Documents/Claude/ffmpeg
    claude

    If you see "command not found: claude", you do not have Claude Code
    installed. Either install it (docs.claude.com/en/docs/claude-code)
    or use OPTION B below.

A3. Paste this request in, then press Enter:

    Read agentic_installation.MD and perform the full install and setup
    for this project. Then start both servers and confirm that
    http://127.0.0.1:5001/ and http://127.0.0.1:5173/ both respond.

A4. Approve the commands it asks permission to run. It will install
    Homebrew, ffmpeg and Node.js if they are missing, create the Python
    environment, install the interface packages, create the input/ and
    output/ folders, start both servers, and then test both addresses to
    prove the setup worked.

A5. When it reports that both addresses respond, open this one in your
    browser:

    http://127.0.0.1:5173/

That is the whole installation. Nothing else to type.

Two things worth knowing:

  - The servers are not permanent. They stop when you restart the Mac
    or close the Terminal. To start them again later, either run the
    STEP 3 and STEP 4 commands below, or ask Claude:

        Start the GenAI Editor servers -- see agentic_installation.MD
        Phase 5.

  - agentic_installation.MD is written for Claude, not for you. It is
    fine to read, but it assumes you are the one running the commands.
    STEP 0 onward is the version written for people.


OPTION B, STEP 0: OPEN THE TERMINAL APP
----------------------------------------

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

FIRST TIME ONLY -- run these three commands once, in your FIRST Terminal
window, to create the app's folders and its Python environment:

    cd ~/Documents/Claude/ffmpeg
    mkdir -p input output projects
    python3 -m venv .venv

(The input/ and output/ folders must exist before the app starts, or it
will report an error instead of listing your files.)

Then, every time you want to start the app, type these three commands
one at a time, pressing Enter after each:

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

The GenAI Editor should now load in your browser.


STEP 6: STOPPING THE APP
----------------------------

When you're done, click into each Terminal window and press Ctrl+C to
stop it. It's safe to close both windows after that.


THE NEXT TIME YOU WANT TO USE THE APP
----------------------------------------

You don't need to repeat Step 1, or the "FIRST TIME ONLY" commands in
Step 3. Just do Steps 2 through 5 again: two Terminal windows, run the
Step 3 commands in one (you can skip the "pip install" line after the
first time), run the Step 4 commands in the other (you can skip
"npm install" after the first time), then open the browser address from
Step 5.

If you installed with Claude (OPTION A), you can also just ask it:

    Start the GenAI Editor servers -- see agentic_installation.MD
    Phase 5.


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

The Media Bin is empty, or the app shows an error instead of your files
    The input/ and output/ folders are missing. Run the "FIRST TIME
    ONLY" commands in Step 3, then restart Step 3.

Something else is wrong and you have Claude Code
    Ask it to diagnose using the runbook:
        Something is wrong with my GenAI Editor setup -- check it
        against agentic_installation.MD and fix it.

The chat/assistant panel shows an error
    That one feature needs an extra tool (the "claude" command-line
    app) that most people won't have installed. Everything else in the
    editor works fine without it.





════════════════════════════════════════════════════════
                CONTACT / CREATOR
════════════════════════════════════════════════════════

GenAI Editor
(a local, macOS-only lossless video editor)

Created and maintained by:

 Julian Sarmiento 
  
   Get in touch:

     Name .......... Julian Sarmiento 
     Email .......... <sarmieaj@amazon.com>
     Departament ......... VFX GenAI Specialist, PV Studio AI (7931)
     Location ......... LAX22-CO (Culver City,CA,US) 

Questions, bug reports, and feature requests are welcome
through any of the channels above.

─────────────────────────────────────────────────────────
                     <08/2026> 
════════════════════════════════════════════════════════


