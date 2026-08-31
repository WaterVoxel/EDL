GENAI EDITOR
============

A local, EDL-style video editor. Every edit -- trim, splice, reverse,
slow down, hold, round-up -- is staged as a non-destructive decision and
only applied to your media when you click Render. Your original files
are never changed.

This guide assumes no prior experience.

Once the app is running, click the document icon at the far right of the
top bar for a full explanation of its features from inside the app. The
lightbulb next to it starts a guided tour.


════════════════════════════════════════════════════════
   TO LAUNCH THE APP: DOUBLE-CLICK "start.command"
════════════════════════════════════════════════════════

In this same folder there is a file called "start.command". Double-click
it and the app starts -- it opens the two Terminal windows the app needs,
starts both halves, waits until they are ready, and opens the editor in
your browser. Nothing to type.

That is all most people ever need, and the section below is just the
detail. The one exception: if the app has never been set up on this Mac
at all, do THE ONE-TIME INSTALL further down first, then come back here.


LAUNCHING THE APP
--------------------

A window appears listing what it checks, then two more Terminal windows
open -- one titled "backend", one titled "frontend". Those two are the
app itself; leave them open while you work. When both are ready your
browser opens to:

    http://127.0.0.1:5173/

TO STOP THE APP: click into each of the two Terminal windows and press
Ctrl+C. It is then safe to close them.

Four things to know:

  - THE FIRST DOUBLE-CLICK MAY BE BLOCKED. If this project arrived as a
    download or a zip, macOS refuses to run the file and shows a warning
    about an unidentified developer. Right-click "start.command", choose
    Open, then click Open in the dialog that appears. You only do this
    once -- after that, double-click works normally.

  - IF THE APP IS ALREADY RUNNING, it leaves it alone and just opens the
    browser. It will not restart anything out from under you, so a render
    in progress is safe.

  - IT FIXES ITS OWN SETUP. If the Python environment, the interface
    packages, or the input/ output/ projects/ folders are missing, it
    creates them before starting. On a brand-new copy of this folder that
    first launch takes a couple of minutes; every launch after that is a
    few seconds.

  - IT CANNOT INSTALL HOMEBREW. If it stops and tells you ffmpeg or
    Node.js is missing, do STEP 1 below once, then double-click again.

Prefer typing commands yourself? The by-hand version is STEP 2 through
STEP 5 below, and it still works exactly as before.


THE ONE-TIME INSTALL
-----------------------

Only needed once per Mac. Two ways -- pick one:

    OPTION A -- let Claude do it for you (below). Fastest, and it
                checks its own work.
    OPTION B -- do it by hand, STEP 0 onward. No extra tools needed.

Either way, once it is done you launch the app by double-clicking
"start.command" from then on.


OPTION A: INSTALL WITH CLAUDE (THE EASY WAY)
---------------------------------------------

If you have Claude Code installed, you can skip STEP 0 through STEP 4
completely. This project ships a setup runbook written specifically for
it: the file "agentic_installation.MD" in this same folder. Claude reads
that file and performs the entire installation itself.

A1. Open the Terminal app: press Cmd+Space, type "Terminal", press
    Enter.

A2. Type these two commands, pressing Enter after each:

    cd [PROJECT FOLDER]
    claude

    [PROJECT FOLDER] means this project's folder -- the one containing
    this README file -- wherever it lives on your Mac. You don't have to
    type its name: type "cd" and a space, then drag the folder from
    Finder onto the Terminal window and let go. Press Enter.

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
    or close the Terminal. You do not need Claude to start them again:
    from now on, just double-click "start.command" (see LAUNCHING THE
    APP above). Asking Claude still works if you'd rather:

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


ONE THING TO KNOW FIRST: "cd [PROJECT FOLDER]"

Several commands below start with "cd", which means "go to this folder".
[PROJECT FOLDER] means this project's folder -- the one containing
README.txt and app.py -- wherever you put it on your Mac.

You do not have to type its name. Instead:

  1. Type  cd  followed by one space (do not press Enter yet).
  2. Drag the project folder from a Finder window onto the Terminal
     window and let go. Terminal fills in the full path for you.
  3. Press Enter.

So if you keep the project in Documents, "cd [PROJECT FOLDER]" ends up
looking something like:

    cd ~/Documents/Claude/ffmpeg

Where a command says "cd [PROJECT FOLDER]/frontend", do the same thing
but drag the "frontend" folder from inside the project instead.


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

    cd [PROJECT FOLDER]
    mkdir -p input output projects
    python3 -m venv .venv

(The input/ and output/ folders must exist before the app starts, or it
will report an error instead of listing your files.)

Then, every time you want to start the app, type these three commands
one at a time, pressing Enter after each:

    cd [PROJECT FOLDER]
    source .venv/bin/activate
    python3 app.py

Or, as a single line:

 cd [PROJECT FOLDER] && source .venv/bin/activate && python3 app.py


If this is the very first time running the app and you see an error
mentioning "Flask", run this once and then try "python3 app.py" again:

    pip install -r requirements.txt

When it's working, you'll see a message that looks like:

    * Running on http://127.0.0.1:5001

Leave this window open and running. This is the app's engine.


STEP 4: START THE APP (INTERFACE)
------------------------------------

In your SECOND Terminal window, type these commands one at a time:

    cd [PROJECT FOLDER]/frontend
    npm install
    npm run dev

Or, as a single line:

 cd [PROJECT FOLDER]/frontend && npm run dev


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

Double-click "start.command". That's it -- see LAUNCHING THE APP near the
top of this file.

The install steps never need repeating: not STEP 1, and not the "FIRST
TIME ONLY" commands in STEP 3.

If you would rather keep doing it by hand, repeat STEP 2 through STEP 5 --
two Terminal windows, the STEP 3 commands in one (skip the "pip install"
line after the first time), the STEP 4 commands in the other (skip
"npm install" after the first time), then open the address from STEP 5.

And if you have Claude Code, you can always just ask:

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

Double-clicking "start.command" does nothing, or macOS warns about an
unidentified developer
    macOS blocks scripts that came from a download. Right-click the file,
    choose Open, then click Open in the dialog. Once only.

Double-clicking "start.command" opens it in a text editor instead of
running it
    The file lost its permission to run (this happens when a project is
    copied around). Fix it once, in Terminal:
        chmod +x [PROJECT FOLDER]/start.command
    Then double-click again.

"start.command" says ffmpeg or Node.js is missing
    It can install the app's own pieces but not the system tools. Do
    STEP 1 once, then double-click it again.

"start.command" says a server never answered
    Look at the Terminal window it opened for that half -- backend or
    frontend -- and read the error there. That window is left open on
    purpose so the message is not lost.

"Address already in use" when starting the app
    Something is already using that spot on your computer. If the old
    copy of the app is still rendering, close its browser tab first and
    give it a second — that stops the render. Then:
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


