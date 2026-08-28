import functools
import json
import math
import os
import select
import shutil
import socket
import subprocess
import threading
import time

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

import ffmpeg_utils as fu

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024**3  # 2 GB

# ---- version ----
# The ONE place this app's version is written is the `VERSION` file at the repo
# root; everything else derives from it (see CLAUDE.md). Read here rather than
# hardcoded so a bump is a one-line edit to one file.
#
# Why a plain text file and not a git tag: `share-project` deliberately excludes
# `.git/`, and this repo's useful state is routinely uncommitted, so a shared or
# downloaded copy has no tags to read. A file travels with the code; a tag does
# not. Why not frontend/package.json: that is the version of one of two runtimes,
# and Python would have to parse JS-ecosystem JSON to learn the app's version.
#
# Read once at import, so this reports the version the RUNNING process booted
# with — which is the question anyone reading it off a bug report is asking. The
# reloader is told to watch the file (see __main__) so a bump restarts the server
# instead of silently serving the old number.
VERSION_FILE = os.path.join(fu.PROJECT_ROOT, "VERSION")


def _read_version():
    # Never fatal: a missing VERSION is a packaging mistake, not a reason the
    # editor can't render. It surfaces as the literal string "unknown", which no
    # one can mistake for a real version.
    try:
        with open(VERSION_FILE, encoding="utf-8") as f:
            return f.read().strip() or "unknown"
    except OSError:
        return "unknown"


APP_VERSION = _read_version()

# Resolved from PATH so the AGENT tab works on any machine. The fallback is the
# path this project was developed against; if neither exists the tab errors when
# used and nothing else in the editor is affected.
CLAUDE_BIN = shutil.which("claude") or os.path.expanduser("~/.toolbox/bin/claude")

CHAT_SCHEMA = json.dumps({
    "type": "object",
    "properties": {
        "ffmpeg_command": {"type": "string"},
        "explanation": {"type": "string"},
    },
    "required": ["ffmpeg_command", "explanation"],
})


# ---------- errors ----------

# The frontend reads EVERY response as JSON (`api.js`), so a reply that isn't
# JSON is a reply it cannot report at all: `r.json()` rejects, and a rejection
# with nothing catching it shows the user nothing — the spinner just stops.
# Flask's defaults hand back an HTML page for anything unplanned, which is
# exactly that case. Verified, each one returning `text/html`:
#
#   a render that hits its ffmpeg timeout  -> HTML 500. TimeoutExpired is a
#     SubprocessError, so every `except RuntimeError` in this file misses it.
#   any exception nobody predicted         -> HTML 500
#   a typo'd URL, or a wrong method        -> HTML 404 / 405
#   an upload over MAX_CONTENT_LENGTH      -> HTML 413
#
# These three handlers make the envelope unconditional: every error leaving this
# app is JSON carrying an `error` key, which is the shape every call site already
# reads. They deliberately do NOT replace the per-route `except RuntimeError`
# handling — those give specific, actionable messages and run first. This is the
# floor under them, for what they don't anticipate.

@app.errorhandler(subprocess.TimeoutExpired)
def _handle_timeout(e):
    # 504 rather than 500: the work may have been perfectly valid and merely too
    # long, and that distinction is what tells the user whether to retry with a
    # shorter timeline or to go fix something.
    tool = os.path.basename(e.cmd[0]) if isinstance(e.cmd, (list, tuple)) and e.cmd else "the command"
    app.logger.error("timed out after %ss: %s", e.timeout, e.cmd)
    return jsonify({"error": "the operation timed out",
                    "detail": f"{tool} was still running after {e.timeout}s and was stopped"}), 504


@app.errorhandler(HTTPException)
def _handle_http_exception(e):
    # Keeps Flask's own status and wording ("Not Found", "Request Entity Too
    # Large"); the only thing that changes is HTML -> JSON.
    return jsonify({"error": e.description or e.name, "status": e.code}), e.code or 500


@app.errorhandler(Exception)
def _handle_unexpected(e):
    # Registering this suppresses Flask's own traceback logging, so log it here.
    # Without this line a crash would go quiet in the terminal too, which is the
    # opposite of the point: the browser gets a readable error AND the developer
    # keeps the full traceback.
    app.logger.exception("unhandled exception on %s %s", request.method, request.path)
    return jsonify({"error": "internal server error",
                    "detail": f"{type(e).__name__}: {e}"}), 500


# ---------- request fields ----------

# Every POST body here is JSON the frontend built, so for a long time the fields
# were simply indexed and trusted: `data["input"]`, `float(c.get("headHoldSec")
# or 0)`. A missing key or a wrong type then left the route as a TypeError and
# came out of _handle_unexpected above as a 500 — a status that says "the server
# broke" for what is a bad request, with a Python type name where the offending
# FIELD should be. A `NaN` was worse than either: it survives float(), and every
# `if x < 0` / `if x > limit` comparison against it is False, so it passed
# validation and reached ffmpeg as the literal `nan` (finding #11).
#
# These four judge one value and name it. They raise ValueError, which is the
# shape the routes' existing `except ValueError -> 400` blocks already use
# (_a1_noise_gain_db, _a1_bed_lane), and they take the value rather than
# (data, key) so the same call works on a nested field with a full label:
# _str_field(c.get("input"), f"clip {i}: input").


def _str_field(value, field, required=True, default=""):
    """A string field. `required=False` accepts an absent/null value as `default`."""
    if value is None:
        if required:
            raise ValueError(f"{field} is required")
        return default
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    return value


def _num_field(value, field, required=True, default=None, lo=None, hi=None):
    """A finite number, optionally bounded by `lo`/`hi` (inclusive).

    Numeric strings are accepted because they always were — an <input
    type="number"> posts its value as one — but a bool is not: `true` as a
    duration is a client bug, not one second, and bool is an int subclass so
    nothing else here would catch it.
    """
    if value is None:
        if required:
            raise ValueError(f"{field} is required")
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{field} must be a number")
    try:
        num = float(value)
    except ValueError:
        raise ValueError(f"{field} must be a number")
    if not math.isfinite(num):
        raise ValueError(f"{field} must be a finite number (got {value!r})")
    if lo is not None and num < lo:
        raise ValueError(f"{field} must be at least {lo:g}")
    if hi is not None and num > hi:
        raise ValueError(f"{field} must be at most {hi:g}")
    return num


def _obj_field(value, field, required=True):
    """A JSON object. A string here is the trap this exists for: it indexes
    character-wise, so `{"clips": "a.mp4"}` used to read as a clip list."""
    if value is None:
        if required:
            raise ValueError(f"{field} is required")
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _list_field(value, field, required=True):
    """A JSON array — same character-wise trap as _obj_field."""
    if value is None:
        if required:
            raise ValueError(f"{field} is required")
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    return value


# ---------- version ----------

@app.route("/api/version")
def api_version():
    # The frontend bakes its own copy in at build time (vite.config.js reads the
    # same file), so it can compare the two and say so when a stale bundle is
    # being served against a restarted backend — the one failure mode a single
    # displayed number cannot show on its own.
    return jsonify({"version": APP_VERSION})


# ---------- static page / media serving ----------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/input/<path:name>")
def serve_input(name):
    return send_from_directory(fu.INPUT_DIR, name)


@app.route("/output/<path:name>")
def serve_output(name):
    return send_from_directory(get_output_dir(), name)


@app.route("/preview/<which>/<path:name>")
def serve_preview(which, name):
    base = resolve_media_dir(which)
    try:
        path = fu.safe_path(name, base)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(path):
        return jsonify({"error": "file not found"}), 404
    try:
        # The dirs are passed in because only app.py knows where the Export Bin
        # is (get_output_dir reads the settings file). They are used only when
        # this call MISSES and pays for a transcode, which is when sweeping the
        # cache is free by comparison — and is the only sweep a server that never
        # restarts would otherwise get (finding #13).
        preview_path, _info = fu.get_or_make_preview(
            path, prune_dirs=[fu.INPUT_DIR, get_output_dir()])
    except RuntimeError as e:
        return jsonify({"error": "could not build preview", "detail": str(e)}), 500
    directory, filename = os.path.split(preview_path)
    return send_from_directory(directory, filename)


# ---------- file listing / probing ----------

def _list_dir(base):
    # A clone that skipped the documented `mkdir -p` has no input/ or output/,
    # and os.listdir raises FileNotFoundError — so the first two calls the UI
    # makes both came back 500 (finding #12). These are the app's own folders and
    # creating one is a setup step it can simply perform; list_projects and
    # PREVIEW_CACHE_DIR already self-heal exactly this way.
    #
    # It cannot create a user-chosen export directory by accident: get_output_dir
    # returns a custom path only `if os.path.isdir(custom)`, so the only values
    # that ever reach here are INPUT_DIR, OUTPUT_DIR, or a directory that already
    # exists. That matters — inventing a folder where an unmounted volume belongs
    # would hide the real problem instead of reporting it.
    os.makedirs(base, exist_ok=True)
    files = []
    for name in sorted(os.listdir(base)):
        p = os.path.join(base, name)
        if os.path.isfile(p) and name.lower().endswith(fu.MEDIA_EXTENSIONS):
            files.append({"name": name, "size": os.path.getsize(p), "modified": os.path.getmtime(p)})
    return files


@app.route("/api/files")
def list_files():
    return jsonify(_list_dir(fu.INPUT_DIR))


@app.route("/api/outputs")
def list_outputs():
    return jsonify(_list_dir(get_output_dir()))


@app.route("/api/probe/<name>")
def probe_file(name):
    which = request.args.get("dir", "input")
    base = resolve_media_dir(which)
    try:
        path = fu.safe_path(name, base)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(path):
        return jsonify({"error": "file not found"}), 404
    try:
        info = fu.get_video_info(path)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(info)


# ---------- upload ----------

@app.route("/api/upload", methods=["POST"])
def upload():
    f = request.files.get("file")
    if not f or f.filename == "":
        return jsonify({"error": "no file"}), 400
    # Judge the extension on the name the BROWSER sent, not on the sanitized one.
    # secure_filename drops every non-ASCII character, so `видео.mp4` arrived
    # here as `mp4` and was refused as "unsupported file type: mp4" — naming as
    # the type an extension that is in fact supported, for a file the app is
    # perfectly able to read. Any name written in a non-Latin script was
    # unuploadable (finding #12).
    raw_ext = os.path.splitext(f.filename)[1]
    if raw_ext.lower() not in fu.MEDIA_EXTENSIONS:
        return jsonify({"error": f"unsupported file type: {raw_ext or f.filename}"}), 400
    # Sanitize the STEM and re-attach the extension just approved, rather than
    # sanitizing the whole name: `видео.mp4` sanitizes to `mp4`, a file with no
    # extension at all, which every listing route would then filter out of sight.
    # A stem that sanitizes away to nothing gets a placeholder — the file lands
    # and can be renamed in the bin, where losing it outright would be the worse
    # answer. The extension keeps its original case (`.MOV` stays `.MOV`); only
    # the check is case-folded.
    stem = secure_filename(os.path.splitext(f.filename)[0])
    name = (stem or "upload") + raw_ext
    # Same self-healing as _list_dir, for the same reason: uploading into a
    # missing input/ used to 500 (and left nothing behind to retry with).
    os.makedirs(fu.INPUT_DIR, exist_ok=True)
    dest = os.path.join(fu.INPUT_DIR, name)
    if os.path.exists(dest):
        base, ext = os.path.splitext(name)
        name = f"{base}_{int(time.time())}{ext}"
        dest = os.path.join(fu.INPUT_DIR, name)
    f.save(dest)
    return jsonify({"name": name})


@app.route("/api/clear_input", methods=["POST"])
def clear_input():
    # On a clone whose input/ was never created, os.listdir raised
    # FileNotFoundError and this came back as a 500 "internal server error"
    # (measured) where delete_input_file degrades to a clean 404 — so the
    # directory is created here as it is in _list_dir, and clearing an empty or
    # absent folder is a success that removed nothing (finding #14).
    os.makedirs(fu.INPUT_DIR, exist_ok=True)
    removed = []
    for name in os.listdir(fu.INPUT_DIR):
        p = os.path.join(fu.INPUT_DIR, name)
        if os.path.isfile(p) and name.lower().endswith(fu.MEDIA_EXTENSIONS):
            os.remove(p)
            removed.append(name)
    return jsonify({"removed": removed})


@app.route("/api/files/<path:name>", methods=["DELETE"])
def delete_input_file(name):
    # Single-file counterpart to clear_input: removes one source file from
    # input/. safe_path guards against path traversal; only allowed media
    # extensions are deletable (same filter clear_input uses) — MEDIA_
    # EXTENSIONS, so audio beds are deletable through the same UI as videos.
    try:
        path = fu.safe_path(name, fu.INPUT_DIR)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not name.lower().endswith(fu.MEDIA_EXTENSIONS):
        return jsonify({"error": "not a media file"}), 400
    if not os.path.isfile(path):
        return jsonify({"error": "file not found"}), 404
    os.remove(path)
    return jsonify({"ok": True, "removed": name})


# ---------- project library ----------

PROJECTS_DIR = os.path.join(fu.PROJECT_ROOT, "projects")


@app.route("/api/projects", methods=["GET"])
def list_projects():
    os.makedirs(PROJECTS_DIR, exist_ok=True)
    items = []
    for name in sorted(os.listdir(PROJECTS_DIR)):
        if name.endswith(".nara"):
            p = os.path.join(PROJECTS_DIR, name)
            items.append({"name": name, "modified": os.path.getmtime(p)})
    return jsonify(items)


def _project_filename(raw):
    """Turn a user-typed project name into a `.nara` filename, or raise PathError.

    Deliberately NOT secure_filename, which REWRITES the name instead of judging
    it and so silently merges distinct projects onto one file: it strips every
    non-ASCII character (`видео` and `日本語` both collapse to the empty string,
    leaving a hidden `.nara` dotfile) and turns spaces into underscores, which is
    what let "Save As → `Batch 1 V002`" land on an existing `Batch_1_V002.nara`
    and replace it. A `.nara` is the only record of a timeline, so a name
    collision is data loss.

    This validates instead: the name the user typed is the name on disk. Only
    what actually cannot be a filename here is refused — a path separator or NUL
    (which would escape PROJECTS_DIR), a leading dot (a hidden file the user
    could not find again), and a name that is empty once the extension is
    accounted for.
    """
    if raw is not None and not isinstance(raw, str):
        raise fu.PathError("project name must be a string")
    name = (raw or "").strip()
    if not name.endswith(".nara"):
        name += ".nara"
    if not name[:-len(".nara")]:
        raise fu.PathError("project name is required")
    if "/" in name or "\\" in name or os.sep in name or "\x00" in name:
        raise fu.PathError("project name cannot contain a path separator")
    if name.startswith("."):
        raise fu.PathError("project name cannot start with a dot")
    return name


@app.route("/api/projects", methods=["POST"])
def save_project():
    data = request.get_json(force=True)
    try:
        name = _project_filename(data.get("name"))
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    project = data.get("project")
    if not isinstance(project, dict) or not isinstance(project.get("clips"), list):
        return jsonify({"error": "invalid project payload — expected {clips: [...]}"}), 400
    os.makedirs(PROJECTS_DIR, exist_ok=True)
    path = os.path.join(PROJECTS_DIR, name)

    # Replacing a project is destructive and has no undo, so it takes an explicit
    # say-so. The client sends overwrite=true only after the user confirms, or
    # when saving the project it already has open (where replacing the file IS
    # the point). Note the app already warns before the far less destructive
    # Delete — this closes that asymmetry.
    if os.path.exists(path) and not data.get("overwrite"):
        return jsonify({"error": f"a project named \"{name}\" already exists",
                        "exists": name}), 409

    # Temp file + os.replace, because the previous truncate-in-place meant a
    # crash or a full disk mid-write destroyed the old project before the new one
    # was complete, leaving a corrupt .nara and no good copy. os.replace is
    # atomic within a directory, so the file a reader sees is always one whole
    # project or the other. The temp name deliberately keeps the .nara suffix
    # off the end, so a leftover can never show up in the library listing.
    tmp = path + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(project, f, indent=2)
        os.replace(tmp, path)
    except OSError as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return jsonify({"error": f"could not save project: {e}"}), 500
    return jsonify({"ok": True, "name": name})


@app.route("/api/projects/<name>", methods=["GET"])
def load_project(name):
    try:
        path = fu.safe_path(name, PROJECTS_DIR)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(path):
        return jsonify({"error": "project not found"}), 404
    # A damaged .nara used to raise here and return Flask's HTML 500 page, which
    # the client cannot parse as JSON — so clicking the project in the library
    # did nothing at all, with no message. Say what is wrong instead: a project
    # that silently does nothing is far harder to diagnose than one that reports
    # a corrupt file.
    try:
        with open(path) as f:
            return jsonify(json.load(f))
    except json.JSONDecodeError as e:
        return jsonify({"error": f"project file is corrupt: {e}"}), 400
    except OSError as e:
        return jsonify({"error": f"could not read project: {e}"}), 500


@app.route("/api/projects/<name>", methods=["DELETE"])
def delete_project(name):
    try:
        path = fu.safe_path(name, PROJECTS_DIR)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(path):
        return jsonify({"error": "project not found"}), 404
    os.remove(path)
    return jsonify({"ok": True})


# ---------- export settings ----------

SETTINGS_FILE = os.path.join(fu.PROJECT_ROOT, ".export_settings.json")


def _load_export_settings():
    try:
        with open(SETTINGS_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_export_settings(settings):
    """Write the settings file atomically: temp file in the same directory, then
    os.replace.

    `open(SETTINGS_FILE, "w")` TRUNCATES before it writes, so for the length of
    the write the file on disk is empty or half a JSON document — and
    _load_export_settings turns a JSONDecodeError into `{}`, which is not a
    partial loss but a total one: the export directory, the quality mode and
    every saved FFmpeg preset all revert to defaults at once. os.replace is
    atomic, so a reader sees either the old file or the new one (finding #14).

    This does not make concurrent SAVES safe — two requests that each read, edit
    and write still lose one of the two edits — but it does mean the loser is a
    valid previous state rather than nothing at all. Flask serves threaded and
    two dialogs post here, so that race is reachable; a lock is not added because
    the partial-write half is what destroys data, and the settings file has one
    writer per user gesture.
    """
    tmp = f"{SETTINGS_FILE}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(settings, f, indent=2)
        os.replace(tmp, SETTINGS_FILE)
    except Exception:
        # Any failure, not just OSError: json.dump raises TypeError on a value it
        # cannot serialize, and that must not leave the half-written temp file
        # behind either. A killed process still can, which is why the temp name
        # is one nothing reads (.gitignore covers it too).
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def get_output_dir():
    """Return the current export directory (from settings or default)."""
    settings = _load_export_settings()
    custom = settings.get("output_dir")
    if custom and os.path.isdir(custom):
        return custom
    return fu.OUTPUT_DIR


def get_export_quality():
    """Return the current export quality mode (from settings or default)."""
    quality = _load_export_settings().get("quality")
    return quality if quality in fu.EXPORT_QUALITIES else "lossless"


# A .nara project carries its presets with it, so this cap is really a limit on
# how much export config one project file is allowed to accumulate.
MAX_EXPORT_PRESETS = 200

# Speed above 1x compresses a clip: setpts drops frames instead of holding them.
# It exists for ONE reason — V2 Reconstruct emits the reciprocal of a V1
# slow-down so a shot that was stretched from 24 frames to 48 comes back at 24
# again — and it is exact, not an approximation: every slow-down preset was
# rendered out and back and came home frame-for-frame byte-identical (a stretch
# only duplicates frames, so the compression drops only duplicates).
#
# The ceiling is derived, not picked. A slow-down is already bounded by the
# 12 fps effective-rate floor below, so the slowest a clip can legally be is
# 12/clip_fps, and the fastest un-stretch anyone can need is its reciprocal,
# clip_fps/12 — which is 10x for a 120 fps source and less for everything
# slower. Beyond that is nothing this app can produce, so it is refused rather
# than silently rendered.
MAX_SPEED = 10.0


def get_custom_export_settings(strict=True):
    """The "custom" quality mode's flags — the ones the FFmpeg Custom Settings
    window edits — normalized and complete.

    strict=True (renders) raises ValueError if the stored block is invalid, so a
    hand-edited .export_settings.json surfaces as an error the user can read
    rather than as a silent render at defaults they didn't choose. strict=False
    (the GET route) falls back to defaults so the window can still open and be
    used to repair the file."""
    settings, error = fu.normalize_export_settings(_load_export_settings().get("custom") or {})
    if error:
        if strict:
            raise ValueError(f"stored custom export settings are invalid: {error}")
        return dict(fu.DEFAULT_EXPORT_SETTINGS)
    return settings


def _normalize_export_presets(raw):
    """Validate the named-preset list. Returns (presets, error).

    Each entry is {"name": str, "settings": <a normalize_export_settings dict>}.
    Names are compared case-insensitively for uniqueness, matching macOS's own
    default filesystem behavior (case-preserving but case-insensitive) so
    "YouTube" and "youtube" can't become two indistinguishable rows in the
    dropdown. The whole list is validated as a unit: a POST either replaces it
    entirely or is rejected, which keeps the client's copy and the file's copy
    from diverging halfway through a save."""
    if not isinstance(raw, list):
        return None, "presets must be a list"
    if len(raw) > MAX_EXPORT_PRESETS:
        return None, f"at most {MAX_EXPORT_PRESETS} presets"
    presets = []
    seen = set()
    for entry in raw:
        if not isinstance(entry, dict):
            return None, "each preset must be an object"
        name = (entry.get("name") or "").strip()
        if not name:
            return None, "every preset needs a name"
        if len(name) > 80:
            return None, "preset names must be 80 characters or fewer"
        if name.lower() in seen:
            return None, f"duplicate preset name: {name}"
        seen.add(name.lower())
        settings, error = fu.normalize_export_settings(entry.get("settings") or {})
        if error:
            return None, f"preset {name!r}: {error}"
        presets.append({"name": name, "settings": settings})
    return presets, None


def get_export_presets():
    """The saved named presets, or [] if the stored list is absent/invalid."""
    presets, error = _normalize_export_presets(_load_export_settings().get("presets") or [])
    return [] if error else presets


def multipass_export_render(input_args, filter_args, source_info, out_path, duration_s,
                            timeout=1800):
    """Run whichever MULTI-pass render the current export mode calls for.

    The three fu.MULTIPASS_QUALITIES modes can't be expressed as one args list
    (each needs two ffmpeg passes plus a measure-and-retry loop), so every
    editing route branches on `quality in fu.MULTIPASS_QUALITIES` and calls this
    instead of fu.encode_args() + fu.run_ffmpeg(). Funnelling all six of those
    routes (trim, splice, render_timeline, reformat, hold_frame, reverse)
    through this one function is what makes a newly added mode work everywhere
    at once rather than in whichever routes got updated.

    Raises RuntimeError carrying ffmpeg's stderr, exactly like
    fu.render_size_capped — every caller already maps that onto a 500. An
    invalid stored settings block is re-raised as a RuntimeError too, so callers
    need only the one except clause.

    Returns the name the render landed under, which is what the caller should
    report: the render is staged and only moved to `out_path` once it is complete
    (fu.stage_output / fu.commit_output, AUDIT #9), and the name can differ from
    os.path.basename(out_path) if another render took it meanwhile. Staging here
    covers all six multipass routes at once, and puts the two-pass stats files in
    the staging directory instead of the export directory."""
    quality = get_export_quality()
    staged = fu.stage_output(out_path)
    try:
        if quality == "custom":
            try:
                settings = get_custom_export_settings()
            except ValueError as e:
                raise RuntimeError(str(e))
            try:
                fu.render_custom_two_pass(input_args, filter_args, source_info, staged,
                                          duration_s, settings, timeout=timeout)
            except ValueError as e:
                raise RuntimeError(str(e))
        else:
            fu.render_size_capped(input_args, filter_args, source_info, staged, duration_s,
                                  timeout=timeout,
                                  codec="hevc" if quality == "under50mb_hevc" else "h264")
        return fu.commit_output(staged, out_path)
    finally:
        fu.discard_output(staged)


# ---------- cancel a render whose client has gone away ----------

# AUDIT #8's second half. Closing the tab, reloading the page or navigating away
# mid-render used to leave ffmpeg encoding at ~800% CPU with nowhere to deliver
# the result: measured on 0.44.0, a 26s trim disconnected after 1s ran the full
# 26s and committed a 293 MB file into the Export Bin that nobody had asked to
# keep. Nothing in HTTP tells a server "the client left", so the connection has
# to be watched.
#
# One watcher thread per render request polls the client socket while the route
# runs. It is a thread rather than a check inside the render loop because there
# is no loop to check in: the request thread is blocked in
# Popen.communicate() for the whole encode.
CLIENT_POLL_SECONDS = 1.0


def _peer_gone(sock):
    """True when the client has closed its end of `sock`.

    select() first, so a connection with nothing to say costs one syscall and
    reads nothing; a socket that is readable is then peeked at WITHOUT consuming
    (MSG_PEEK), because the bytes belong to werkzeug. Zero bytes on a readable
    socket is TCP's end-of-stream — the peer sent FIN. Real data means the
    opposite (a pipelined next request on a keep-alive connection), and is
    deliberately not treated as a disconnect.

    A client that half-closed its write side while still waiting for the
    response would read as gone here. Nothing that talks to this app does that:
    the only clients are its own frontend through the Vite proxy (measured — an
    aborted browser fetch closes the upstream socket too) and curl.
    """
    try:
        readable, _, _ = select.select([sock], [], [], 0)
    except (OSError, ValueError):
        # Closed or otherwise unusable: there is certainly nobody to answer.
        return True
    if not readable:
        return False
    try:
        return sock.recv(1, socket.MSG_PEEK) == b""
    except BlockingIOError:
        return False
    except OSError:
        # ECONNRESET and friends — the client is gone, less politely.
        return True


def _watch_client(sock, scope, stop):
    """Cancel `scope` as soon as the client behind `sock` disconnects.

    One-shot: once it has cancelled there is nothing left to watch. `stop` is
    what the request thread sets when the route is done, and it doubles as the
    poll delay, so the watcher exits promptly on a render that finishes normally.
    """
    while not stop.wait(CLIENT_POLL_SECONDS):
        if _peer_gone(sock):
            killed = fu.cancel_scope(scope)
            print(f"client disconnected mid-request — stopped {killed} running "
                  f"ffmpeg process{'' if killed == 1 else 'es'}", flush=True)
            return


def cancel_on_disconnect(fn):
    """Route decorator: stop this request's ffmpeg children if its client leaves.

    Applied to the routes that spawn an encoder for a render the user asked for.
    Deliberately NOT applied to /preview or /input|/output: a <video> element
    abandons those requests constantly (seeking, switching source, a paused tab),
    and the preview conversion it would kill is work the next request needs.
    """
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        sock = request.environ.get("werkzeug.socket")
        scope = fu.begin_cancel_scope()
        stop = threading.Event()
        if sock is not None:
            # No socket under a WSGI server that doesn't expose one (or a test
            # client): the render then behaves exactly as it did before.
            threading.Thread(target=_watch_client, args=(sock, scope, stop),
                             name="disconnect-watcher", daemon=True).start()
        try:
            response = fn(*args, **kwargs)
            if scope.cancelled:
                # The cancellation landed somewhere that swallowed it — between
                # two passes, or in a route that reports an ffmpeg failure as a
                # 500 rather than re-raising. Either way this request's answer is
                # a cancellation, not whatever it managed to assemble.
                return _cancelled_response()
            return response
        except fu.RenderCancelled:
            return _cancelled_response()
        finally:
            stop.set()
            fu.end_cancel_scope()
    return wrapper


def _cancelled_response():
    """499, the status nginx made up for exactly this ("client closed request").
    Nothing reads it — the socket is closed — but it keeps a cancellation out of
    the server log's 500s, where it would look like a bug."""
    return jsonify({"error": "render cancelled: the client disconnected"}), 499


def resolve_media_dir(which):
    """Map a request's `dir` field onto one of the two media folders: "input"
    is the Media Bin's sources, anything else (the default) the Export Bin.
    Only the export side is user-relocatable, so it goes through
    get_output_dir()."""
    return fu.INPUT_DIR if which == "input" else get_output_dir()


# The Export Settings dialog displays `error` and nothing else, so this sentence
# has to carry the whole answer: what failed, where to fix it, and what to do
# instead in the meantime (the path field is editable by hand).
_PICKER_ERROR = ("macOS would not open the folder picker — allow this app to control "
                 "System Events under System Settings ▸ Privacy & Security ▸ Automation, "
                 "or type the folder path into the field instead")


@app.route("/api/browse_directory", methods=["POST"])
def browse_directory():
    """Open a native macOS folder-picker dialog and return the selected path."""
    data = request.get_json(force=True) if request.data else {}
    # Interpolated into the AppleScript below as a POSIX path, so it has to be a
    # real path string: a non-string used to be formatted into the script as one
    # anyway, open the dialog regardless, and then surface as a 500 when the
    # picker was still open at the 120s timeout (finding #11).
    try:
        initial_dir = _str_field(data.get("initial"), "initial", required=False) or fu.OUTPUT_DIR
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        import subprocess as _sp
        # Use osascript (AppleScript) for a native folder picker — it's
        # simpler and more reliable than tkinter on macOS, which requires
        # additional setup (Tcl/Tk framework) and often fails headless.
        # The path is passed as an ARGUMENT, not pasted into the script text.
        # Interpolating it made the value part of the program: measured with real
        # osascript, an `initial` of a single `"` came back as a compile error
        # ("Expected end of line but found “"”", -2741) before any dialog could
        # open, and `/tmp" & (17 * 3 as text) & "` compiled and ran — so a quote
        # in the value ended the string and everything after it was executed as
        # AppleScript. The reachable face of that is mundane and the reason it is
        # fixed rather than filed: a legal macOS folder name may contain a double
        # quote, and the picker refused to open for it (finding #14).
        #
        # `item 1 of argv` is how osascript hands a `--` argument to a plain
        # script; `run` names the handler that receives them.
        script = (
            'on run argv\n'
            '  tell application "System Events"\n'
            '    set theFolder to choose folder with prompt "Select export directory" '
            'default location POSIX file (item 1 of argv)\n'
            '    return POSIX path of theFolder\n'
            '  end tell\n'
            'end run'
        )
        result = _sp.run(
            ["osascript", "-e", script, initial_dir],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            err = (result.stderr or "").strip()
            # osascript exits 1 both for a dialog the user dismissed and for a
            # dialog it was never allowed to show, so the exit status alone
            # cannot tell them apart — and reporting both as "cancelled" is what
            # made a denied Automation permission a SILENT no-op: the user
            # pressed Browse, nothing opened, and nothing was said (finding #12).
            # A cancel is identified by AppleScript's own error number, which is
            # locale-independent; the text is checked too, in case a future macOS
            # words it without the code.
            if "-128" in err or "user canceled" in err.lower():
                return jsonify({"cancelled": True, "path": ""})
            return jsonify({"error": _PICKER_ERROR, "detail": err
                            or f"osascript exited {result.returncode}"}), 500
        path = result.stdout.strip().rstrip("/")
        return jsonify({"cancelled": False, "path": path})
    except _sp.TimeoutExpired:
        # The other face of the same failure: where the permission is denied
        # outright osascript exits, but where System Events simply never answers
        # (measured in this project's own environment) it hangs until an
        # AppleEvent timeout — and the raw TimeoutExpired text is the whole
        # AppleScript source, pasted into the dialog's error line.
        return jsonify({"error": _PICKER_ERROR,
                        "detail": "the folder picker did not respond within 120 seconds"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/reveal_file", methods=["POST"])
def reveal_file():
    """Reveal a source (dir="input") or rendered file in the OS file browser
    (Finder on macOS)."""
    data = request.get_json(force=True)
    try:
        name = _str_field(data.get("name"), "name", required=False)
        which = _str_field(data.get("dir"), "dir", required=False)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    try:
        path = fu.safe_path(name, resolve_media_dir(which))
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(path):
        return jsonify({"error": "file not found"}), 404

    try:
        # `open -R` asks Finder to reveal the file (selects it in its
        # containing folder) rather than opening/playing it.
        result = subprocess.run(["open", "-R", path], capture_output=True, text=True, timeout=15)
        if result.returncode != 0:
            return jsonify({"error": result.stderr.strip() or "could not open Finder"}), 500
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/rename_file", methods=["POST"])
def rename_file():
    """Rename a file in place in the Export Bin (output/) or, with
    dir="input", in the Media Bin (input/) — preserving its extension.
    safe_path guards both names against traversal; the new name must be a
    plain media filename and must not collide with an existing one. This is
    the one write the app makes to input/: it renames, never rewrites, so a
    source file's bytes are still untouched."""
    data = request.get_json(force=True)
    try:
        old = _str_field(data.get("name"), "name", required=False)
        raw_new = _str_field(data.get("newName"), "newName", required=False)
        which = _str_field(data.get("dir"), "dir", required=False)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if not raw_new.strip():
        return jsonify({"error": "new name required"}), 400
    # secure_filename NFKD-normalizes and then drops every non-ASCII character,
    # so a name written in a non-Latin script keeps nothing of ITSELF while its
    # extension survives: `видео.mp4` sanitized to `mp4`, the original extension
    # was re-appended, and the file was renamed to **mp4.mp4** — a silent
    # substitution the user never asked for and cannot recognise. (`видео` with
    # no extension sanitized to nothing at all and was reported as "new name
    # required", for a name that had been supplied.) Both measured. This app can
    # only store ASCII filenames, so the honest answer is to say so rather than
    # to invent one (finding #14).
    #
    # Judged on the STEM, because that is the part the user is naming. An
    # accented Latin name is deliberately still accepted — `café.mp4` becomes
    # `cafe.mp4`, which is recognisably what was typed, and the route reports the
    # stored name back — while `видео.mp4`, `ビデオ.mp4` and `.mp4` are refused,
    # because for those there is nothing recognisable left to store.
    #
    # The stem is taken by removing a known media extension, NOT with
    # os.path.splitext, which reads ".mp4" as an extension-less dotfile named
    # ".mp4" and so let that case through as `mp4.mp4` — the same splitext trap
    # #12 hit on upload.
    typed_stem = raw_new
    for ext in fu.MEDIA_EXTENSIONS:
        if typed_stem.lower().endswith(ext):
            typed_stem = typed_stem[:-len(ext)]
            break
    if not secure_filename(typed_stem):
        return jsonify({"error": f"{raw_new!r} cannot be used as a filename here — a "
                                 "name needs at least one Latin letter, digit, dash "
                                 "or underscore before its extension"}), 400
    new = secure_filename(raw_new)
    if not new:
        return jsonify({"error": "new name required"}), 400
    out_dir = resolve_media_dir(which)
    try:
        old_path = fu.safe_path(old, out_dir)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.isfile(old_path):
        return jsonify({"error": "file not found"}), 404
    # Preserve the original extension if the user didn't supply one.
    old_ext = os.path.splitext(old)[1]
    if not os.path.splitext(new)[1] and old_ext:
        new += old_ext
    if not new.lower().endswith(fu.MEDIA_EXTENSIONS):
        return jsonify({"error": "new name must be a media file"}), 400
    try:
        new_path = fu.safe_path(new, out_dir)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if os.path.exists(new_path):
        return jsonify({"error": f"a file named {new} already exists"}), 409
    os.rename(old_path, new_path)
    return jsonify({"ok": True, "name": new})


@app.route("/api/export_settings", methods=["GET"])
def get_export_settings():
    settings = _load_export_settings()
    return jsonify({
        "output_dir": settings.get("output_dir") or "",
        "default_output_dir": fu.OUTPUT_DIR,
        "quality": get_export_quality(),
        # The "custom" mode's live flags, its saved named presets, and the
        # vocabulary the window builds its dropdowns from — sent together so the
        # dialog never hardcodes a codec/preset/profile list that could drift
        # out of step with what normalize_export_settings will accept.
        "custom": get_custom_export_settings(strict=False),
        "presets": get_export_presets(),
        "custom_defaults": fu.DEFAULT_EXPORT_SETTINGS,
        "custom_options": {
            "codecs": list(fu.EXPORT_CODECS),
            # "encoder_presets", not "presets": in this feature "preset" means
            # two different things (ffmpeg's -preset speed knob and a saved
            # named settings bundle), and the wire format keeps them apart.
            "encoder_presets": list(fu.EXPORT_PRESETS),
            "profiles": {k: list(v) for k, v in fu.EXPORT_PROFILES.items()},
            "pix_fmts": list(fu.EXPORT_PIX_FMTS),
            "ten_bit_pix_fmts": list(fu.TEN_BIT_PIX_FMTS),
            "ten_bit_profiles": list(fu.TEN_BIT_PROFILES),
        },
    })


@app.route("/api/export_settings", methods=["POST"])
def set_export_settings():
    """Partial update: only the keys actually present in the request body are
    touched. That matters now that two different dialogs post here — the FFmpeg
    Custom Settings window sends {custom, presets, quality} and must not clear
    the export directory the other one owns."""
    data = request.get_json(force=True)
    settings = _load_export_settings()
    if "output_dir" in data:
        try:
            output_dir = _str_field(data.get("output_dir"), "output_dir", required=False).strip()
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        if output_dir:
            if not os.path.isabs(output_dir):
                return jsonify({"error": "output_dir must be an absolute path"}), 400
            # The source folder is the one directory an export must never land
            # in. Nothing overwrites a source if it does — O_EXCL plus the
            # uniqueness loop turn a collision into `a_1.mp4`, verified by md5 —
            # but the renders then appear in the Media Bin's input list, where
            # they read as footage and where Clear Media deletes them along with
            # the real sources (finding #14).
            if os.path.realpath(output_dir) == os.path.realpath(fu.INPUT_DIR):
                return jsonify({"error": "the export directory cannot be the "
                                         "source folder (input/) — renders would "
                                         "appear in the Media Bin as footage"}), 400
            if not os.path.isdir(output_dir):
                try:
                    os.makedirs(output_dir, exist_ok=True)
                except OSError as e:
                    return jsonify({"error": f"cannot create directory: {e}"}), 400
            settings["output_dir"] = output_dir
        else:
            settings.pop("output_dir", None)
    if "quality" in data:
        quality = data.get("quality") or "lossless"
        if quality not in fu.EXPORT_QUALITIES:
            return jsonify({"error": f"quality must be one of {', '.join(fu.EXPORT_QUALITIES)}"}), 400
        settings["quality"] = quality
    if "custom" in data:
        custom, error = fu.normalize_export_settings(data.get("custom") or {})
        if error:
            return jsonify({"error": error}), 400
        settings["custom"] = custom
    if "presets" in data:
        presets, error = _normalize_export_presets(data.get("presets") or [])
        if error:
            return jsonify({"error": error}), 400
        settings["presets"] = presets
    _save_export_settings(settings)
    return jsonify({
        "ok": True,
        "output_dir": settings.get("output_dir", ""),
        "quality": get_export_quality(),
        "custom": get_custom_export_settings(strict=False),
        "presets": get_export_presets(),
    })


@app.route("/api/outputs/<path:name>", methods=["DELETE"])
def delete_output_file(name):
    # Single-file counterpart to clear_output: removes one render from the
    # export dir. Mirrors delete_input_file exactly — safe_path traversal
    # guard, MEDIA_EXTENSIONS filter (the same set clear_output sweeps) — but
    # resolves against get_output_dir(), so it deletes from wherever exports
    # are actually being written, not just the default output/.
    try:
        path = fu.safe_path(name, get_output_dir())
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not name.lower().endswith(fu.MEDIA_EXTENSIONS):
        return jsonify({"error": "not a media file"}), 400
    if not os.path.isfile(path):
        return jsonify({"error": "file not found"}), 404
    os.remove(path)
    return jsonify({"ok": True, "removed": name})


@app.route("/api/clear_output", methods=["POST"])
def clear_output():
    export_dir = get_output_dir()
    removed = []
    for name in os.listdir(export_dir):
        p = os.path.join(export_dir, name)
        if os.path.isfile(p) and name.lower().endswith(fu.MEDIA_EXTENSIONS):
            os.remove(p)
            removed.append(name)
    return jsonify({"removed": removed})


def _parse_time_to_sec(value):
    """Parse a ffmpeg -ss/-to style time value: either a plain number of
    seconds ("12.5") or a "[HH:]MM:SS[.ms]" timecode ("00:00:05.000"), the
    two forms /api/trim's start/end fields actually accept (see the legacy
    UI's own placeholder text). Sizes a size-capped mode's bitrate budget, and
    judges the two fields on every path — trimming itself is still done by
    ffmpeg's own -ss/-to, which is why the values are passed on unchanged."""
    s = str(value).strip()
    if ":" not in s:
        return float(s)
    parts = s.split(":")
    parts = [float(p) for p in parts]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    hh, mm, ss = parts[-3], parts[-2], parts[-1]
    return hh * 3600 + mm * 60 + ss


# ---------- trim ----------

@app.route("/api/trim", methods=["POST"])
@cancel_on_disconnect
def trim():
    data = request.get_json(force=True)
    try:
        in_name = _str_field(data.get("input"), "input")
        out_request = _str_field(data.get("output"), "output", required=False)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    try:
        in_path = fu.safe_path(in_name, fu.INPUT_DIR)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(in_path):
        return jsonify({"error": "input file not found"}), 404

    start = data.get("start", "0")
    end = data.get("end")
    if not end:
        return jsonify({"error": "end time is required"}), 400

    # Judged on EVERY path, not just the size-capped one that needs the number:
    # -ss/-to are handed to ffmpeg verbatim, so an unparseable or reversed pair
    # used to start a real encode and come back as a 500 "ffmpeg failed" for what
    # is plainly a bad request (finding #11). What ffmpeg receives is unchanged —
    # still the caller's own strings, so a timecode stays a timecode.
    try:
        start_sec = _parse_time_to_sec(start)
        end_sec = _parse_time_to_sec(end)
    except (TypeError, ValueError):
        return jsonify({"error": "start/end must be numeric seconds or a HH:MM:SS.ms timecode"}), 400
    if not (math.isfinite(start_sec) and math.isfinite(end_sec)):
        return jsonify({"error": "start/end must be finite times"}), 400
    if start_sec < 0:
        return jsonify({"error": "start must not be negative"}), 400
    if end_sec <= start_sec:
        return jsonify({"error": f"end ({end}) must be later than start ({start})"}), 400

    try:
        info = fu.get_video_info(in_path)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    # A start at or past the end of the file is not a trim, and ffmpeg does not
    # treat it as an error: measured, `start=900` on a 3-second source exited 0
    # and wrote a 262-byte file with no frames in it, which the route reported as
    # a successful render (finding #14). Only checked when the duration was
    # actually READ — get_video_info reports 0.0 for a container that carries no
    # duration, and trim is one of the routes that works fine on such a file, so
    # `duration_known` is the gate here as it is everywhere else (#11).
    if info["duration_known"] and start_sec >= info["duration"]:
        return jsonify({"error": f"start ({start}) is at or past the end of "
                                 f"{in_name}, which is {info['duration']:.3f}s long"}), 400

    export_dir = get_output_dir()
    try:
        out_name = fu.unique_output_name(out_request or _derive_name(in_name, "trimmed"),
                                         export_dir)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    out_path = os.path.join(export_dir, out_name)

    input_args = ["-i", in_path, "-ss", str(start), "-to", str(end)]

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        trim_duration = end_sec - start_sec
        try:
            out_name = multipass_export_render(input_args, [], info, out_path, trim_duration)
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name})

    args = input_args + fu.encode_args(info, quality)
    result, out_name = fu.run_ffmpeg_staged(args, out_path)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


# ---------- splice ----------

@app.route("/api/splice", methods=["POST"])
@cancel_on_disconnect
def splice():
    data = request.get_json(force=True)
    # A bare string here is the case worth naming: it has a len() and it iterates,
    # so `"a.mp4"` used to be read as five separate one-character filenames and
    # reported as `input file not found: .../a` (finding #11).
    try:
        names = [
            _str_field(n, f"inputs[{i}]")
            for i, n in enumerate(_list_field(data.get("inputs"), "inputs", required=False))
        ]
        out_request = _str_field(data.get("output"), "output", required=False)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if len(names) < 2:
        return jsonify({"error": "need at least 2 inputs to splice"}), 400

    try:
        in_paths = [fu.safe_path(n, fu.INPUT_DIR) for n in names]
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    for p in in_paths:
        if not os.path.exists(p):
            return jsonify({"error": f"input file not found: {p}"}), 404

    infos = []
    for p in in_paths:
        try:
            infos.append(fu.get_video_info(p))
        except RuntimeError as e:
            return jsonify({"error": f"probe failed for {p}", "detail": str(e)}), 500

    target_w = max(i["width"] for i in infos)
    target_h = max(i["height"] for i in infos)
    target_fps = max(i["fps"] or 30 for i in infos)
    has_audio_flags = [i["has_audio"] for i in infos]

    # build_concat_filter always maps an [outa] audio track (anullsrc fills
    # in silence for inputs with no audio), so the output always has audio;
    # its quality should never be worse than the best-quality input.
    audio_infos = [i for i in infos if i["has_audio"]]
    combined_info = {
        "has_audio": True,
        "audio_bit_rate": max((i["audio_bit_rate"] or 0 for i in audio_infos), default=0),
        "audio_sample_rate": max((i["audio_sample_rate"] or 0 for i in audio_infos), default=0),
        "audio_channels": max((i["audio_channels"] or 0 for i in audio_infos), default=0),
        # For "match source" quality: the best-quality input sets the target.
        "video_bit_rate": max((i["video_bit_rate"] or 0 for i in infos), default=0),
        "bit_rate": max((i["bit_rate"] or 0 for i in infos), default=0),
    }

    export_dir = get_output_dir()
    try:
        out_name = fu.unique_output_name(out_request or "spliced.mp4", export_dir)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    out_path = os.path.join(export_dir, out_name)

    filt = fu.build_concat_filter(len(in_paths), target_w, target_h, target_fps, has_audio_flags)

    input_args = []
    for p in in_paths:
        input_args += ["-i", p]
    filter_args = ["-filter_complex", filt, "-map", "[outv]", "-map", "[outa]"]

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        total_sec = sum(i["duration"] for i in infos)
        try:
            out_name = multipass_export_render(input_args, filter_args, combined_info,
                                               out_path, total_sec)
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name})

    args = input_args + filter_args
    args += fu.encode_args(combined_info, quality)

    result, out_name = fu.run_ffmpeg_staged(args, out_path)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


# ---------- render timeline ----------

def _a1_request_beds(data):
    """The A1 lane out of a render request, as an ordered list of
    {"input": name, "dir": ...} dicts — the order is the lane order, which is
    the order the clips play in.

    Accepts the older single-object "audioBed" key as well, so a client (or a
    saved .nara loaded by one) from when A1 held exactly one file still renders
    the same thing. A list of one is not a special case anywhere downstream.
    """
    beds = data.get("audioBeds")
    if beds is None:
        single = data.get("audioBed")
        beds = [single] if single else []
    elif not isinstance(beds, list):
        beds = [beds]
    return [b for b in beds if b]


def _a1_bed_lane(raw_beds, bed_infos):
    """The A1 lane for ffmpeg_utils: `(placements, trims)`.

    placements is one `(start_sec, reach_sec)` per bed — where it sits in lane
    seconds and how many seconds of audio it carries. trims is one
    `(in_sec, end_sec)` in FILE seconds per bed, or None for a bed that plays its
    whole file.

    Both render routes build the lane through this, for the same reason they share
    _a1_request_beds and _a1_noise_gain_db: a lane that differs between the two
    puts a removed bed's hole — or a split clip's cut — in a different place in the
    stem than in the render, which is exactly the kind of drift an A1 stem exists
    to rule out. The two come back TOGETHER from one function because they are two
    views of the same numbers: reach is `end - in`, so a route that computed one
    without the other could render a half-clip's worth of audio while telling room
    tone the whole file was covered.

    The parts come from deliberately different sources. `startSec`, `inSec` and
    `outSec` are client EDIT DECISIONS — where the user left that clip on the lane
    and which part of the file they cut — so they are validated and otherwise
    trusted. The file's LENGTH is a MEDIA FACT, so the reach is bounded by the
    server's probed audio-stream duration and never by the client's `durationSec`
    (a container duration used only for drawing). Coverage stays measured.

    A bed with no `startSec` — an older client, or a .nara saved before beds
    carried one — yields None, which fu.normalize_bed_placements falls back to
    "starts where the previous bed's audio ends": the contiguous lane A1 has always
    been, rendering the graph it always did. A bed with no `inSec`/`outSec` — every
    bed until Split came to A1 — yields a None trim and the untrimmed chain, so
    that graph is byte-identical too.

    Raises ValueError for the caller to turn into a 400.
    """
    placements = []
    trims = []
    for n, (raw_bed, info) in enumerate(zip(raw_beds, bed_infos)):
        raw_bed = raw_bed if isinstance(raw_bed, dict) else {}
        raw = raw_bed.get("startSec")
        if raw is None:
            start = None
        else:
            try:
                start = float(raw)
            except (ValueError, TypeError):
                raise ValueError(f"A1 clip {n + 1}: startSec must be numeric")
            # `not (a <= x <= b)` so NaN is rejected rather than reaching the
            # filtergraph as an anullsrc duration. The ceiling is a day, which no
            # real lane approaches — it is here to catch a corrupt value, not to
            # express a limit.
            if not (0.0 <= start <= 86400.0):
                raise ValueError(
                    f"A1 clip {n + 1}: startSec must be between 0 and 86400 seconds"
                )

        # The cut, in the file's own seconds. Absent inSec means "from the first
        # sample"; absent outSec means "to the end of the audio stream", which is
        # the only thing the server can measure and therefore the only sensible
        # default — a client that trims the tail says so explicitly.
        audio_dur = info.get("audio_duration") or 0.0
        in_sec = raw_bed.get("inSec")
        out_sec = raw_bed.get("outSec")
        try:
            in_sec = 0.0 if in_sec is None else float(in_sec)
            out_sec = None if out_sec is None else float(out_sec)
        except (ValueError, TypeError):
            raise ValueError(f"A1 clip {n + 1}: inSec/outSec must be numeric")
        if not (0.0 <= in_sec <= 86400.0):
            raise ValueError(
                f"A1 clip {n + 1}: inSec must be between 0 and 86400 seconds"
            )
        if out_sec is not None and not (in_sec < out_sec <= 86400.0):
            raise ValueError(
                f"A1 clip {n + 1}: outSec must be greater than inSec and at most 86400 seconds"
            )
        end_sec = audio_dur if out_sec is None else min(out_sec, audio_dur)
        reach = max(end_sec - in_sec, 0.0)
        # Only reachable from a file replaced in input/ by a shorter one, or a
        # hand-edited project: the app never cuts outside a clip's own played
        # length. A 400 naming the measured duration beats rendering a lane with a
        # silently empty clip in it, which would look like the render dropped audio.
        if reach <= 0.0 and (in_sec > 0 or out_sec is not None):
            raise ValueError(
                f"A1 clip {n + 1} ({raw_bed.get('input')}): the cut "
                f"{in_sec:.3f}s–{end_sec:.3f}s has no audio in it — "
                f"this file's audio is {audio_dur:.3f}s long"
            )
        # The same judgement for an UNTRIMMED bed, which the guard above cannot
        # reach: with in_sec 0 and no out_sec the reach is the whole measured
        # audio duration, so a file whose duration could not be read at all came
        # out as a zero-length bed and was placed on the lane in silence — the
        # render succeeded, A1 was empty, and nothing said why (finding #14, the
        # same root cause as #11's duration_known gate, which was applied to the
        # three video routes only). Measured with a 44-byte WAV carrying a
        # zero-length data chunk: /api/render_a1 and /api/render_timeline both
        # returned 200, while the same bed WITH a trim was correctly refused.
        if reach <= 0.0:
            raise ValueError(
                f"A1 clip {n + 1} ({raw_bed.get('input')}): no audio duration "
                "could be read from this file, so there is nothing to place on "
                "A1 — the file may be empty, truncated, or missing its header"
            )
        placements.append((start, reach))
        trims.append(None if (in_sec <= 0 and out_sec is None) else (in_sec, end_sec))
    return placements, trims


def _a1_noise_gain_db(data):
    """The room-tone level out of a render request, in dB, validated.

    Both render routes call this, for the same reason they both call
    _a1_request_beds: the level has to reach ffmpeg_utils identically down
    either path or /api/render_a1's stem stops matching the joined render.
    That equivalence used to hold by construction (the gain was a module
    constant applied in one place); now that it arrives per request, this
    function is the single place it is read and bounded.

    A request that omits the key gets fu.NOISE_GAIN_DB — the exact graph an
    older client always got. Deliberately NOT `data.get(...) or DEFAULT`:
    0 dB (raw asset level) is a legal value, and `or` would silently turn it
    into 12, the same bug class as `speed or 1.0`.
    """
    raw = data.get("noiseGainDb")
    if raw is None:
        return fu.NOISE_GAIN_DB
    try:
        gain = float(raw)
    except (ValueError, TypeError):
        raise ValueError("noiseGainDb must be numeric")
    # `not (a <= x <= b)` rather than `x < a or x > b` so NaN is rejected too.
    if not (fu.NOISE_GAIN_DB_MIN <= gain <= fu.NOISE_GAIN_DB_MAX):
        raise ValueError(
            f"noiseGainDb must be between {fu.NOISE_GAIN_DB_MIN} and "
            f"{fu.NOISE_GAIN_DB_MAX} dB"
        )
    # Round to the frontend's step precision so the filtergraph string for a
    # given user-visible level is deterministic (framemd5 checks depend on it).
    return round(gain, 1)


@app.route("/api/render_timeline", methods=["POST"])
@cancel_on_disconnect
def render_timeline():
    data = request.get_json(force=True)
    clips = data.get("clips") or []
    if not clips:
        return jsonify({"error": "need at least 1 clip"}), 400

    # Judged before anything indexes a clip: `{"clips": "a.mp4"}` is a string that
    # iterates into one-character "clips", and a clip whose `input` is not a string
    # reached os.path.join as one. Both were 500s, and the KeyError case answered
    # with the bare key name `'input'` (finding #11).
    try:
        in_names = []
        for i, c in enumerate(clips):
            _obj_field(c, f"clip {i}")
            in_names.append(_str_field(c.get("input"), f"clip {i}: input"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        in_paths = [
            fu.safe_path(name, get_output_dir() if c.get("dir") == "output" else fu.INPUT_DIR)
            for c, name in zip(clips, in_names)
        ]
    except (fu.PathError, KeyError) as e:
        return jsonify({"error": str(e)}), 400
    for p in in_paths:
        if not os.path.exists(p):
            return jsonify({"error": f"input file not found: {p}"}), 404

    # Per-clip overlay sources (the V2 animated-overlay feature) become
    # ADDITIONAL ffmpeg inputs appended after every clip's own input, so a
    # clip's index i still maps to its own "-i" — build_timeline_filter's
    # existing [{i}:v] contract is untouched, and the overlay references its
    # own separate index. Resolved/probed with the same rules as clip inputs.
    overlay_paths = []
    overlay_specs_raw = []
    for i, c in enumerate(clips):
        raw_ov = c.get("overlay")
        if not raw_ov:
            overlay_specs_raw.append(None)
            continue
        # Own try/return rather than the one below, whose message prefixes the
        # clip itself — these already carry the full label (finding #11).
        try:
            _obj_field(raw_ov, f"clip {i} overlay")
            ov_name = _str_field(raw_ov.get("input"), f"clip {i} overlay: input")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        try:
            ov_path = fu.safe_path(
                ov_name,
                get_output_dir() if raw_ov.get("dir") == "output" else fu.INPUT_DIR,
            )
        except (fu.PathError, KeyError) as e:
            return jsonify({"error": f"clip {i} overlay: {e}"}), 400
        if not os.path.exists(ov_path):
            return jsonify({"error": f"clip {i} overlay: input file not found: {ov_path}"}), 404
        # Each overlay gets its OWN "-i" even if two clips reference the same
        # file: a filter graph cannot consume one input pad twice (it would
        # need an explicit split), and the same file overlaid onto two clips
        # needs two independently time-shifted chains. Clip inputs already
        # work exactly this way — a duplicated clip appears twice in in_paths.
        overlay_specs_raw.append({
            "raw": raw_ov,
            "path": ov_path,
            "index": len(clips) + len(overlay_paths),
        })
        overlay_paths.append(ov_path)

    infos = []
    for p in in_paths:
        try:
            infos.append(fu.get_video_info(p))
        except RuntimeError as e:
            return jsonify({"error": f"probe failed for {p}", "detail": str(e)}), 500

    # Probe every overlay source too — its real dimensions are what the
    # exact-size-match check below is enforced against, never the client's
    # claim (same "server never trusts client-supplied resolution" rule the
    # clip inputs follow).
    overlay_infos = {}
    for entry in overlay_specs_raw:
        if not entry or entry["path"] in overlay_infos:
            continue
        try:
            overlay_infos[entry["path"]] = fu.get_video_info(entry["path"])
        except RuntimeError as e:
            return jsonify({"error": f"probe failed for overlay {entry['path']}", "detail": str(e)}), 500

    # The A1 audio lane: one more "-i" per clip on it, appended after every clip
    # input AND every overlay input, joined end to end and mixed under the whole
    # sequence. The indices are only stable once the overlay loop above has
    # finished (that loop grows overlay_paths as it goes), which is why this
    # block sits here.
    bed_paths = []
    bed_indexes = []
    bed_infos = []
    raw_beds = _a1_request_beds(data)
    for n, raw_bed in enumerate(raw_beds):
        # Typed first so the reply names the field: a non-object bed used to be
        # indexed anyway and answered in Python's own words — "A1 clip 1: string
        # indices must be integers" (finding #11).
        try:
            _obj_field(raw_bed, f"A1 clip {n + 1}")
            bed_name = _str_field(raw_bed.get("input"), f"A1 clip {n + 1}: input")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        try:
            bed_path = fu.safe_path(
                bed_name,
                get_output_dir() if raw_bed.get("dir") == "output" else fu.INPUT_DIR,
            )
        except (fu.PathError, KeyError, TypeError) as e:
            return jsonify({"error": f"A1 clip {n + 1}: {e}"}), 400
        if not bed_name.lower().endswith(fu.MEDIA_EXTENSIONS):
            return jsonify({"error": f"A1 clip {n + 1}: unsupported file type: {bed_name}"}), 400
        if not os.path.exists(bed_path):
            return jsonify({"error": f"A1 clip {n + 1}: file not found: {bed_path}"}), 404
        try:
            bed_info = fu.get_video_info(bed_path)
        except RuntimeError as e:
            return jsonify({"error": f"probe failed for A1 clip {bed_path}", "detail": str(e)}), 500
        # An A1 clip with no audio stream would make the graph reference a [N:a]
        # pad that doesn't exist — ffmpeg exits 234 with a filtergraph
        # binding error, which is a 500 the user can do nothing with.
        if not bed_info["has_audio"]:
            return jsonify({"error": f"A1 clip {n + 1}: {bed_name} has no audio stream"}), 400
        bed_indexes.append(len(in_paths) + len(overlay_paths) + len(bed_paths))
        bed_paths.append(bed_path)
        bed_infos.append(bed_info)

    # Room tone: one more "-i", after every clip, overlay, and the bed, so its
    # index is stable only once those are all counted. The client sends a plain
    # boolean — the PATH is fixed server-side (fu.NOISE_ASSET), never a
    # client-supplied name, so this adds no new file-reference surface.
    noise_paths = []
    noise_index = None
    # Parsed unconditionally, even with the toggle off: an out-of-range level is
    # a bad request either way, and reporting it only once room tone happens to
    # be on would surface the client bug at a random later moment.
    try:
        noise_gain_db = _a1_noise_gain_db(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if data.get("fillNoise"):
        if not os.path.isfile(fu.NOISE_ASSET):
            return jsonify({
                "error": f"room tone: asset missing at {fu.NOISE_ASSET}"
            }), 400
        noise_index = len(in_paths) + len(overlay_paths) + len(bed_paths)
        noise_paths.append(fu.NOISE_ASSET)

    # Server always derives fps/has_audio/resolution itself — never trusts
    # client-supplied values — same principle /api/hold_frame already
    # follows. Only inSec/outSec/hold durations come from the request.
    clip_specs = []
    for i, (c, info) in enumerate(zip(clips, infos)):
        # A source whose container carries no duration measures as 0s, and every
        # window is then "invalid ... for source duration 0.0" — true, but it
        # never says the duration is what could not be read (finding #11).
        if not info["duration_known"]:
            return jsonify({"error": f"clip {i}: cannot read the duration of {in_names[i]} — "
                                     "its container reports none, so no trim window can be "
                                     "checked against it"}), 400
        try:
            in_sec = float(c["inSec"])
            out_sec = float(c["outSec"])
        except (KeyError, ValueError, TypeError):
            return jsonify({"error": f"clip {i}: inSec/outSec must be numeric"}), 400
        # NaN passes every comparison below (`nan < 0` and `nan > duration` are
        # both False), so without this it validated clean and reached the filter
        # graph as the literal `nan`.
        if not (math.isfinite(in_sec) and math.isfinite(out_sec)):
            return jsonify({"error": f"clip {i}: inSec/outSec must be finite numbers"}), 400
        if out_sec <= in_sec or in_sec < 0 or out_sec > info["duration"] + 0.001:
            return jsonify({"error": f"clip {i}: invalid inSec/outSec for source duration {info['duration']}"}), 400
        # Clamp the trim window to the video stream's own end. The container
        # duration (the frontend's historical default outSec) can outlast the
        # last video frame when audio runs longer; trimming video and audio
        # to different effective lengths would desync every following clip.
        video_dur = info.get("video_duration") or info["duration"]
        out_sec = min(out_sec, video_dur)
        if out_sec <= in_sec:
            return jsonify({"error": f"clip {i}: trim window lies past the video stream end ({video_dur}s)"}), 400

        is_first = i == 0
        is_last = i == len(clips) - 1
        # Bounded below at 0: a hold EXTENDS a clip, so a negative one is a client
        # bug that used to render silently, and a non-numeric or NaN one used to
        # be a 500 or reach tpad as `nan` (finding #11). The frontend's own Hold
        # form already refuses both (HoldFrameForm.jsx), so nothing it can send
        # is rejected here.
        try:
            lead_hold = _num_field(c.get("headHoldSec"), f"clip {i}: headHoldSec",
                                   required=False, default=0.0, lo=0) if is_first else 0.0
            # Freezing an already-frozen frame is a pixel no-op, so a trailing
            # tail-hold and round-hold (Raise) on the same last clip just add.
            trail_hold = (
                _num_field(c.get("tailHoldSec"), f"clip {i}: tailHoldSec",
                           required=False, default=0.0, lo=0)
                + _num_field(c.get("roundHoldSec"), f"clip {i}: roundHoldSec",
                             required=False, default=0.0, lo=0)
            ) if is_last else 0.0
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        # Speed is a pure PTS change either way — a stretch holds frames, a
        # compression drops them — so the only quality constraint is the
        # effective frame rate, and it only bites on the SLOW side: refuse a
        # slow-down that would fall below 12 fps (frames held so long the motion
        # visibly stutters). A speed-up raises the effective rate, so the floor
        # cannot apply to it; its ceiling is MAX_SPEED (see there for why
        # speed > 1 exists at all).
        try:
            # `or` would coerce a literal 0 to the default and skip the
            # range check below — only substitute the default for absent/null.
            raw_speed = c.get("speed")
            speed = 1.0 if raw_speed is None else float(raw_speed)
        except (ValueError, TypeError):
            return jsonify({"error": f"clip {i}: speed must be numeric"}), 400
        clip_fps = info["fps"] or 30.0
        if not (0 < speed <= MAX_SPEED):
            return jsonify({"error": f"clip {i}: speed must be in (0, {MAX_SPEED:g}] — "
                                     f"below 1 slows down, above 1 speeds up (which exists to "
                                     f"un-stretch a slow-down; see MAX_SPEED)"}), 400
        if speed < 1.0 and clip_fps * speed < 12 - 1e-9:
            return jsonify({
                "error": f"clip {i}: speed {speed} would drop the effective rate to "
                         f"{clip_fps * speed:.1f} fps — below the 12 fps minimum for this {clip_fps:.0f} fps source"
            }), 400

        # Crop is a spatial pre-filter, in source-pixel coordinates picked
        # by the user on the frontend — bounds are checked against the
        # server's own probe of this file, never trusted blindly.
        crop = None
        raw_crop = c.get("crop")
        if raw_crop:
            try:
                crop_w = int(raw_crop["w"])
                crop_h = int(raw_crop["h"])
                crop_x = int(raw_crop["x"])
                crop_y = int(raw_crop["y"])
            except (KeyError, ValueError, TypeError):
                return jsonify({"error": f"clip {i}: crop w/h/x/y must be integers"}), 400
            if crop_w <= 0 or crop_h <= 0 or crop_x < 0 or crop_y < 0:
                return jsonify({"error": f"clip {i}: crop dimensions/offset must be non-negative, w/h positive"}), 400
            if crop_x + crop_w > info["width"] or crop_y + crop_h > info["height"]:
                return jsonify({
                    "error": f"clip {i}: crop {crop_w}x{crop_h}+{crop_x}+{crop_y} "
                             f"exceeds source resolution {info['width']}x{info['height']}"
                }), 400
            crop = {"w": crop_w, "h": crop_h, "x": crop_x, "y": crop_y}

        # Optional per-clip crop keyframes: only meaningful when a crop is
        # already set (they animate the crop box's position over time; the
        # box's own w/h stays fixed and comes from `crop`). t is seconds
        # relative to the clip's main body (0 → outSec-inSec, in SOURCE
        # units — the crop filter runs before any trim/setpts, so its `t`
        # variable is the source frame's own timestamp).
        crop_keyframes = None
        raw_kfs = c.get("cropKeyframes")
        if raw_kfs and crop:
            if not isinstance(raw_kfs, list):
                return jsonify({"error": f"clip {i}: cropKeyframes must be a list"}), 400
            max_t = out_sec - in_sec
            parsed = []
            for j, kf in enumerate(raw_kfs):
                try:
                    kt = float(kf["t"])
                    kx = int(kf["x"])
                    ky = int(kf["y"])
                except (KeyError, ValueError, TypeError):
                    return jsonify({"error": f"clip {i} keyframe {j}: t/x/y must be numeric (t float, x/y int)"}), 400
                if kt < -1e-6 or kt > max_t + 1e-6:
                    return jsonify({"error": f"clip {i} keyframe {j}: t={kt} lies outside the clip's main body [0, {max_t:.3f}]"}), 400
                if kx < 0 or ky < 0 or kx + crop["w"] > info["width"] or ky + crop["h"] > info["height"]:
                    return jsonify({"error": f"clip {i} keyframe {j}: crop origin ({kx},{ky}) with size {crop['w']}x{crop['h']} lies outside source {info['width']}x{info['height']}"}), 400
                parsed.append({"t": max(0.0, min(max_t, kt)), "x": kx, "y": ky})
            crop_keyframes = parsed

        # V2 animated overlay: a region cropped out of THIS clip, processed
        # externally, composited back at the same (optionally animated)
        # position. Its placement rect and keyframes come from the V1 clip's
        # own crop box, so the same bounds rules apply — but note this is the
        # OPPOSITE geometry from a crop: the overlay is drawn ONTO the full
        # frame, so the rect must fit inside the source, and the overlay
        # file's own size must equal the rect exactly.
        overlay = None
        entry = overlay_specs_raw[i]
        if entry:
            raw_ov = entry["raw"]
            ov_info = overlay_infos[entry["path"]]
            try:
                ov_x = int(raw_ov["x"])
                ov_y = int(raw_ov["y"])
            except (KeyError, ValueError, TypeError):
                return jsonify({"error": f"clip {i} overlay: x/y must be integers"}), 400
            ov_w = ov_info["width"]
            ov_h = ov_info["height"]
            if not ov_w or not ov_h:
                return jsonify({"error": f"clip {i} overlay: could not determine overlay resolution"}), 400
            # Exact-size match is required, never a resample: a mismatched
            # overlay would have to be scaled to fit, baking a soft,
            # misaligned region into an otherwise lossless render.
            exp_w = raw_ov.get("w")
            exp_h = raw_ov.get("h")
            if exp_w is not None and exp_h is not None:
                try:
                    exp_w = int(exp_w)
                    exp_h = int(exp_h)
                except (ValueError, TypeError):
                    return jsonify({"error": f"clip {i} overlay: w/h must be integers"}), 400
                if exp_w != ov_w or exp_h != ov_h:
                    return jsonify({
                        "error": f"clip {i} overlay: file is {ov_w}x{ov_h} but the crop box it must fill "
                                 f"is {exp_w}x{exp_h} — an overlay must match the box exactly"
                    }), 400
            # unlike `crop` (which silently clamps an out-of-range offset),
            # `overlay` silently CLIPS the pasted picture — verified: x beyond
            # the right edge loses the overflow with exit 0 and no warning at
            # any loglevel. So the rect has to be bounds-checked here or part
            # of the processed region just vanishes with no diagnostic.
            if ov_x < 0 or ov_y < 0 or ov_x + ov_w > info["width"] or ov_y + ov_h > info["height"]:
                return jsonify({
                    "error": f"clip {i} overlay: placement {ov_w}x{ov_h}+{ov_x}+{ov_y} "
                             f"lies outside source resolution {info['width']}x{info['height']}"
                }), 400

            ov_max_t = out_sec - in_sec
            ov_kfs = None
            raw_ov_kfs = raw_ov.get("keyframes")
            if raw_ov_kfs:
                if not isinstance(raw_ov_kfs, list):
                    return jsonify({"error": f"clip {i} overlay: keyframes must be a list"}), 400
                parsed_ov = []
                for j, kf in enumerate(raw_ov_kfs):
                    try:
                        kt = float(kf["t"])
                        kx = int(kf["x"])
                        ky = int(kf["y"])
                    except (KeyError, ValueError, TypeError):
                        return jsonify({"error": f"clip {i} overlay keyframe {j}: t/x/y must be numeric (t float, x/y int)"}), 400
                    if kt < -1e-6 or kt > ov_max_t + 1e-6:
                        return jsonify({"error": f"clip {i} overlay keyframe {j}: t={kt} lies outside the clip's main body [0, {ov_max_t:.3f}]"}), 400
                    if kx < 0 or ky < 0 or kx + ov_w > info["width"] or ky + ov_h > info["height"]:
                        return jsonify({"error": f"clip {i} overlay keyframe {j}: placement ({kx},{ky}) with size {ov_w}x{ov_h} lies outside source {info['width']}x{info['height']}"}), 400
                    parsed_ov.append({"t": max(0.0, min(ov_max_t, kt)), "x": kx, "y": ky})
                ov_kfs = parsed_ov

            # The overlay clip's own trim window, clamped to its video stream
            # (same reason clip trims are: a container can outlast its video).
            ov_video_dur = ov_info.get("video_duration") or ov_info["duration"]
            try:
                ov_in_sec = float(raw_ov.get("inSec") or 0)
                ov_out_sec = float(raw_ov["outSec"]) if raw_ov.get("outSec") is not None else ov_video_dur
            except (ValueError, TypeError):
                return jsonify({"error": f"clip {i} overlay: inSec/outSec must be numeric"}), 400
            ov_out_sec = min(ov_out_sec, ov_video_dur)
            if ov_out_sec <= ov_in_sec:
                return jsonify({"error": f"clip {i} overlay: invalid trim window for duration {ov_video_dur}s"}), 400

            overlay = {
                # Assigned when the input was collected above — appended after
                # every clip input, one per overlay (never deduplicated).
                "input_index": entry["index"],
                "w": ov_w,
                "h": ov_h,
                "x": ov_x,
                "y": ov_y,
                "keyframes": ov_kfs,
                "in_sec": ov_in_sec,
                "out_sec": ov_out_sec,
            }

        clip_specs.append({
            "inSec": in_sec,
            "outSec": out_sec,
            "fps": info["fps"] or 30.0,
            "has_audio": info["has_audio"],
            "lead_hold_sec": lead_hold,
            "trail_hold_sec": trail_hold,
            "reversed": bool(c.get("reversed")),
            "speed": speed,
            "video_duration": info.get("video_duration") or info["duration"],
            "crop": crop,
            "crop_keyframes": crop_keyframes,
            "overlay": overlay,
        })

    # A cropped clip's own frame size is the crop box, not the source's —
    # the common target resolution (every clip gets scaled/padded to this)
    # must be derived from post-crop dimensions. Overlay sources are
    # deliberately NOT considered here: an overlay is composited INTO an
    # existing frame, so it never changes that frame's size (and being
    # smaller than V1 is the whole premise of the feature).
    def effective_wh(info, spec):
        if spec.get("crop"):
            return spec["crop"]["w"], spec["crop"]["h"]
        return info["width"], info["height"]

    # An audio-only file has width/height None, and max() over a None would
    # raise an uncaught TypeError — a bare 500 that says nothing. Audio
    # belongs on A1, not V1; say so by name.
    for c, info in zip(clips, infos):
        if not info.get("width") or not info.get("height"):
            return jsonify({
                "error": f"{c.get('input')} has no video stream — "
                         "audio files belong on the A1 track, not V1"
            }), 400

    effective_dims = [effective_wh(info, spec) for info, spec in zip(infos, clip_specs)]
    target_w = max(w for w, h in effective_dims)
    target_h = max(h for w, h in effective_dims)
    target_fps = max(i["fps"] or 30 for i in infos)

    # Explicit opt-out: strip audio from the render entirely regardless of
    # what any input clip has. build_timeline_filter normally always emits
    # [outa] (filling silence via anullsrc for silent/stretched segments),
    # so has_audio below is hardcoded True in the normal case — but when
    # no_audio is requested build_timeline_filter never builds an audio
    # graph or an [outa] label at all (see its own docstring for why a
    # plain -an can't be bolted on afterward instead), so has_audio must
    # flip to False here too, or audio_args()/either two-pass render would
    # try to attach -c:a aac to a stream that was never mapped.
    no_audio = bool(data.get("noAudio"))
    if no_audio and bed_indexes:
        return jsonify({"error": "cannot mix an audio bed into a render with audio disabled"}), 400
    if no_audio and noise_index is not None:
        return jsonify({"error": "cannot lay room tone under a render with audio disabled"}), 400
    # A1 counts as an audio source for the encoder's own settings: with a bed
    # under an entirely silent V1, it is the ONLY real audio in the render, and
    # leaving it out here would degenerate audio_sample_rate to 0.
    audio_infos = [i for i in infos + bed_infos if i["has_audio"]]
    combined_info = {
        "has_audio": not no_audio,
        "audio_bit_rate": max((i["audio_bit_rate"] or 0 for i in audio_infos), default=0),
        "audio_sample_rate": max((i["audio_sample_rate"] or 0 for i in audio_infos), default=0),
        "audio_channels": max((i["audio_channels"] or 0 for i in audio_infos), default=0),
        # For "match source" quality: the best-quality input sets the target.
        "video_bit_rate": max((i["video_bit_rate"] or 0 for i in infos), default=0),
        "bit_rate": max((i["bit_rate"] or 0 for i in infos), default=0),
    }

    export_dir = get_output_dir()
    try:
        out_name = _str_field(data.get("output"), "output", required=False) or "render.mp4"
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    # Judged and made unique within the export directory. This route had its own
    # copy of the uniqueness loop, as did render_a1 and reformat — four
    # implementations of one rule, and the three inline ones never checked the
    # name itself (finding #14).
    try:
        out_name = fu.unique_output_name(out_name, export_dir)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    out_path = os.path.join(export_dir, out_name)

    # Where each bed sits on the A1 lane and how far its SOUND reaches — what
    # keeps room tone off the lane, and what makes a removed bed leave a hole
    # instead of pulling the rest of the lane earlier (see fu.bed_spans and
    # fu.a1_bed_source).
    try:
        bed_placements, bed_trims = _a1_bed_lane(raw_beds, bed_infos)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    filt = fu.build_timeline_filter(
        clip_specs, target_w, target_h, target_fps, no_audio=no_audio, audio_beds=bed_indexes,
        fill_noise=noise_index, bed_placements=bed_placements, bed_trims=bed_trims,
        noise_gain_db=noise_gain_db
    )

    # Overlay sources come after every clip input, matching the input_index
    # each overlay spec was assigned above; then the A1 lane in lane order
    # (bed_indexes), then the room-tone asset (noise_index) — this order is
    # what every one of those indices was computed from, so it must not be
    # rearranged.
    input_args = []
    for p in in_paths + overlay_paths + bed_paths + noise_paths:
        input_args += ["-i", p]
    filter_args = ["-filter_complex", filt, "-map", "[outv]"]
    if not no_audio:
        filter_args += ["-map", "[outa]"]

    # Reported back so the toggle is never a black box: room tone fills only what
    # is actually silent, so on a fully covered timeline it correctly does
    # nothing, and without this the only symptom is "I turned it on and heard no
    # difference" — the original bug's symptom exactly.
    noise_report = {}
    if noise_index is not None:
        tone_sec, seq_sec = fu.noise_fill_summary(
            clip_specs, target_fps, bed_placements=bed_placements
        )
        noise_report = {"noise_fill_sec": round(tone_sec, 3),
                        "sequence_sec": round(seq_sec, 3),
                        "noise_gain_db": noise_gain_db}

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        total_sec = sum(_clip_total_sec(spec) for spec in clip_specs)
        try:
            out_name = multipass_export_render(input_args, filter_args, combined_info,
                                               out_path, total_sec)
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name, **noise_report})

    args = input_args + filter_args
    args += fu.encode_args(combined_info, quality)

    # A single-pass whole-timeline render at -qp 0 can run long; the
    # default 600s timeout was sized for single short operations.
    result, out_name = fu.run_ffmpeg_staged(args, out_path, timeout=1800)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name, **noise_report})


@app.route("/api/render_a1", methods=["POST"])
@cancel_on_disconnect
def render_a1():
    """Render the A1 track ALONE to a .wav, timed to the V1 sequence.

    Same request shape as /api/render_timeline (clips, audioBeds, fillNoise) so
    the client can hand over the payload it already built, but only the timing
    keys of each clip are read — see build_a1_filter. The V1 clips are still
    PROBED (never trusted from the client, the same rule render_timeline
    follows), because fps and the video stream's duration are what quantize the
    length; they are just never opened as ffmpeg inputs, so this render decodes
    no video and returns in about a second.

    Output is pcm_s16le at the graph's own 44.1 kHz stereo, i.e. lossless and
    independent of the export-quality setting: this is a stem meant to be mixed
    somewhere else, so lossy AAC would be the wrong default even in "under 50
    MB" mode.
    """
    data = request.get_json(force=True)
    clips = data.get("clips") or []
    if not clips:
        return jsonify({"error": "need at least 1 clip"}), 400

    # The A1 track has content only if a bed, room-tone fill, or both are on.
    raw_beds = _a1_request_beds(data)
    fill_noise_on = bool(data.get("fillNoise"))
    # Same unconditional parse as render_timeline, via the same function, so this
    # stem's tone level can never drift from the joined render's.
    try:
        noise_gain_db = _a1_noise_gain_db(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if not raw_beds and not fill_noise_on:
        return jsonify({"error": "nothing on A1 to render: load an audio track or turn on A1 Room Tone"}), 400

    # Same typing as render_timeline's clip list, for the same reason and in the
    # same words: this route takes the payload that one takes (finding #11).
    try:
        in_names = []
        for i, c in enumerate(clips):
            _obj_field(c, f"clip {i}")
            in_names.append(_str_field(c.get("input"), f"clip {i}: input"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    in_paths = []
    try:
        for c, name in zip(clips, in_names):
            in_paths.append(fu.safe_path(
                name, get_output_dir() if c.get("dir") == "output" else fu.INPUT_DIR
            ))
    except (fu.PathError, KeyError) as e:
        return jsonify({"error": str(e)}), 400
    for p in in_paths:
        if not os.path.exists(p):
            return jsonify({"error": f"input file not found: {p}"}), 404

    infos = []
    for p in in_paths:
        try:
            infos.append(fu.get_video_info(p))
        except RuntimeError as e:
            return jsonify({"error": f"probe failed for {p}", "detail": str(e)}), 500

    # Timing-only clip specs. The validation here is the subset that can move a
    # LENGTH — in/out numerics, the video-stream clamp, the holds-on-the-edges
    # contract, and the speed range. Crop/overlay/reverse are deliberately not
    # validated or passed: they cannot change how long the sequence runs, and
    # rejecting them here would only make an A1 render fail on timelines that
    # render fine on V1.
    clip_specs = []
    for i, (c, info) in enumerate(zip(clips, infos)):
        # A source whose container carries no duration measures as 0s, and every
        # window is then "invalid ... for source duration 0.0" — true, but it
        # never says the duration is what could not be read (finding #11).
        if not info["duration_known"]:
            return jsonify({"error": f"clip {i}: cannot read the duration of {in_names[i]} — "
                                     "its container reports none, so no trim window can be "
                                     "checked against it"}), 400
        try:
            in_sec = float(c["inSec"])
            out_sec = float(c["outSec"])
        except (KeyError, ValueError, TypeError):
            return jsonify({"error": f"clip {i}: inSec/outSec must be numeric"}), 400
        # NaN passes every comparison below (`nan < 0` and `nan > duration` are
        # both False), so without this it validated clean and reached the filter
        # graph as the literal `nan`.
        if not (math.isfinite(in_sec) and math.isfinite(out_sec)):
            return jsonify({"error": f"clip {i}: inSec/outSec must be finite numbers"}), 400
        if out_sec <= in_sec or in_sec < 0 or out_sec > info["duration"] + 0.001:
            return jsonify({"error": f"clip {i}: invalid inSec/outSec for source duration {info['duration']}"}), 400
        video_dur = info.get("video_duration") or info["duration"]
        out_sec = min(out_sec, video_dur)
        if out_sec <= in_sec:
            return jsonify({"error": f"clip {i}: trim window lies past the video stream end ({video_dur}s)"}), 400
        try:
            raw_speed = c.get("speed")
            speed = 1.0 if raw_speed is None else float(raw_speed)
        except (ValueError, TypeError):
            return jsonify({"error": f"clip {i}: speed must be numeric"}), 400
        # Same range as /api/render_timeline, or an A1 stem would reject a lane
        # the video render accepts. No 12 fps floor here: this route renders no
        # video, and the floor is a picture-quality rule.
        if not (0 < speed <= MAX_SPEED):
            return jsonify({"error": f"clip {i}: speed must be in (0, {MAX_SPEED:g}]"}), 400
        is_first = i == 0
        is_last = i == len(clips) - 1
        try:
            lead_hold = _num_field(c.get("headHoldSec"), f"clip {i}: headHoldSec",
                                   required=False, default=0.0, lo=0) if is_first else 0.0
            trail_hold = (
                _num_field(c.get("tailHoldSec"), f"clip {i}: tailHoldSec",
                           required=False, default=0.0, lo=0)
                + _num_field(c.get("roundHoldSec"), f"clip {i}: roundHoldSec",
                             required=False, default=0.0, lo=0)
            ) if is_last else 0.0
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        clip_specs.append({
            "inSec": in_sec,
            "outSec": out_sec,
            "fps": info["fps"] or 30.0,
            "video_duration": video_dur,
            "speed": speed,
            # Load-bearing even though this render contains no clip audio: it is
            # what tells build_a1_filter where the V1 render's own sound would be,
            # and therefore where room tone must stay out. Getting it wrong here
            # would desync the stem from the render it is meant to match.
            "has_audio": info["has_audio"],
            # Same bounds as render_timeline's, and for the same reason — a stem
            # that accepted a hold the render rejects would not match it.
            "lead_hold_sec": lead_hold,
            "trail_hold_sec": trail_hold,
        })

    # The A1 lane is the only real input (plus the noise asset) — resolved and
    # probed exactly as render_timeline does, in lane order, including the
    # has-audio check that would otherwise become an unbindable [N:a] pad and an
    # opaque exit 234.
    input_paths = []
    bed_indexes = []
    bed_infos = []
    for n, raw_bed in enumerate(raw_beds):
        # Typed first so the reply names the field: a non-object bed used to be
        # indexed anyway and answered in Python's own words — "A1 clip 1: string
        # indices must be integers" (finding #11).
        try:
            _obj_field(raw_bed, f"A1 clip {n + 1}")
            bed_name = _str_field(raw_bed.get("input"), f"A1 clip {n + 1}: input")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        try:
            bed_path = fu.safe_path(
                bed_name,
                get_output_dir() if raw_bed.get("dir") == "output" else fu.INPUT_DIR,
            )
        except (fu.PathError, KeyError, TypeError) as e:
            return jsonify({"error": f"A1 clip {n + 1}: {e}"}), 400
        if not bed_name.lower().endswith(fu.MEDIA_EXTENSIONS):
            return jsonify({"error": f"A1 clip {n + 1}: unsupported file type: {bed_name}"}), 400
        if not os.path.exists(bed_path):
            return jsonify({"error": f"A1 clip {n + 1}: file not found: {bed_path}"}), 404
        try:
            bed_info = fu.get_video_info(bed_path)
        except RuntimeError as e:
            return jsonify({"error": f"probe failed for A1 clip {bed_path}", "detail": str(e)}), 500
        if not bed_info["has_audio"]:
            return jsonify({"error": f"A1 clip {n + 1}: {bed_name} has no audio stream"}), 400
        bed_indexes.append(len(input_paths))
        bed_infos.append(bed_info)
        input_paths.append(bed_path)

    noise_index = None
    if fill_noise_on:
        if not os.path.isfile(fu.NOISE_ASSET):
            return jsonify({"error": f"room tone: asset missing at {fu.NOISE_ASSET}"}), 400
        noise_index = len(input_paths)
        input_paths.append(fu.NOISE_ASSET)

    # The same lane render_timeline builds, through the same function, so the
    # stem's room tone lands in exactly the same stretches as the render's and a
    # removed bed leaves its hole in the same place.
    try:
        bed_placements, bed_trims = _a1_bed_lane(raw_beds, bed_infos)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # The grid both lengths are snapped to. Derived from the V1 clips exactly as
    # /api/render_timeline derives it, because a stem quantized on a different
    # rate than the render it accompanies is the drift build_a1_filter exists to
    # avoid — the number has to come from the same clips by the same rule.
    target_fps = max(i["fps"] or 30 for i in infos)

    try:
        filt = fu.build_a1_filter(clip_specs, target_fps, audio_beds=bed_indexes,
                                  fill_noise=noise_index, bed_placements=bed_placements,
                                  bed_trims=bed_trims, noise_gain_db=noise_gain_db)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Always a .wav, whatever name the client asked for.
    export_dir = get_output_dir()
    try:
        out_request = _str_field(data.get("output"), "output", required=False)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    # The extension is this route's to choose, not the caller's — a stem comes in
    # ("render_A1", or whatever the client typed) and a .wav always comes out, so
    # the shared check is given .wav as the one allowed suffix AFTER the stem has
    # been re-extended. Everything else it judges — no directory components, no
    # empty name — applies here exactly as it does to a video render.
    base = os.path.splitext(out_request or "render_A1")[0]
    try:
        candidate = fu.unique_output_name(f"{base}.wav", export_dir, allowed=(".wav",))
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    out_path = os.path.join(export_dir, candidate)

    args = []
    for p in input_paths:
        args += ["-i", p]
    args += ["-filter_complex", filt, "-map", "[outa]", "-c:a", "pcm_s16le"]
    result, candidate = fu.run_ffmpeg_staged(args, out_path)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    noise_report = {}
    if noise_index is not None:
        tone_sec, seq_sec = fu.noise_fill_summary(
            clip_specs, target_fps, bed_placements=bed_placements
        )
        noise_report = {"noise_fill_sec": round(tone_sec, 3),
                        "sequence_sec": round(seq_sec, 3),
                        "noise_gain_db": noise_gain_db}
    return jsonify({"output": candidate, **noise_report})


def _clip_total_sec(spec):
    """Timeline-domain duration of one build_timeline_filter clip_spec:
    lead/trail holds (absolute seconds) plus the main trimmed body stretched
    by any slow-down speed. Mirrors the same components build_timeline_filter
    itself sums into its per-clip `expected_sec` (frame-snapped there; this
    is the same math without the frame-grid rounding, which is precise
    enough for sizing a bitrate budget but not for building a filter graph).
    """
    lead = spec.get("lead_hold_sec") or 0
    trail = spec.get("trail_hold_sec") or 0
    speed = spec.get("speed") or 1.0
    main = (spec["outSec"] - spec["inSec"]) / speed
    return lead + trail + main


# ---------- reformat ----------

@app.route("/api/reformat", methods=["POST"])
@cancel_on_disconnect
def reformat():
    """Scale a single clip DOWN to fit inside a (resolution tier, aspect
    ratio) bounding box (fu.REFORMAT_PRESETS), preserving its own aspect
    ratio exactly (contain-fit, never upscaled, no letterboxing — output
    dimensions are whatever the proportional scale-down produces).
    ratio="adaptive" is special: it keeps the SOURCE's own aspect ratio
    (not one of the 6 fixed ratios) sized to roughly that resolution
    tier's pixel budget — see fu.reformat_adaptive_dims. Reads the source
    from input/ or output/ (never modifies it) and always writes to the
    export directory (get_output_dir()), like render_timeline — never the
    media bin.
    """
    data = request.get_json(force=True)
    resolution = data.get("resolution")
    ratio = data.get("ratio")
    if resolution not in fu.REFORMAT_PRESETS:
        return jsonify({"error": f"resolution must be one of {list(fu.REFORMAT_RESOLUTIONS)}"}), 400
    if ratio != "adaptive" and ratio not in fu.REFORMAT_RATIOS:
        return jsonify({"error": f"ratio must be 'adaptive' or one of {list(fu.REFORMAT_RATIOS)}"}), 400

    try:
        in_name = _str_field(data.get("input"), "input")
        out_request = _str_field(data.get("output"), "output", required=False)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    try:
        in_path = fu.safe_path(
            in_name, get_output_dir() if data.get("dir") == "output" else fu.INPUT_DIR
        )
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(in_path):
        return jsonify({"error": "input file not found"}), 404

    try:
        info = fu.get_video_info(in_path)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    if not info["width"] or not info["height"]:
        return jsonify({"error": "could not determine source resolution"}), 500

    if ratio == "adaptive":
        out_w, out_h = fu.reformat_adaptive_dims(info["width"], info["height"], resolution)
    else:
        target_w, target_h = fu.REFORMAT_PRESETS[resolution][ratio]
        out_w, out_h = fu.reformat_scale_dims(info["width"], info["height"], target_w, target_h)

    export_dir = get_output_dir()
    try:
        out_name = fu.unique_output_name(out_request or _derive_name(in_name, "reformat"),
                                         export_dir)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    out_path = os.path.join(export_dir, out_name)

    input_args = ["-i", in_path]
    filter_args = ["-vf", f"scale={out_w}:{out_h}"]

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        try:
            out_name = multipass_export_render(input_args, filter_args, info, out_path,
                                               info["duration"])
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name})

    args = input_args + filter_args + fu.encode_args(info, quality)
    result, out_name = fu.run_ffmpeg_staged(args, out_path)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


# ---------- hold frame ----------

@app.route("/api/hold_frame", methods=["POST"])
@cancel_on_disconnect
def hold_frame():
    data = request.get_json(force=True)
    # One field per message: "time and duration must be numeric seconds" left the
    # caller to work out which of the two it was, a list reached float() as a
    # TypeError the handler above did not catch, and a NaN passed the range check
    # below (every comparison against it is False) to reach ffmpeg (finding #11).
    try:
        in_name = _str_field(data.get("input"), "input")
        out_request = _str_field(data.get("output"), "output", required=False)
        t = _num_field(data.get("time"), "time")
        dur = _num_field(data.get("duration"), "duration")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    try:
        in_path = fu.safe_path(in_name, fu.INPUT_DIR)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(in_path):
        return jsonify({"error": "input file not found"}), 404

    if dur <= 0:
        return jsonify({"error": "duration must be positive"}), 400

    try:
        info = fu.get_video_info(in_path)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    if not info["duration_known"]:
        return jsonify({"error": f"cannot read the duration of {in_name} — its container "
                                 "reports none, so the frame to hold cannot be located"}), 400
    fps = info["fps"] or 30.0
    # Bound by the video stream's duration, not the container's — the
    # container can outlast the last video frame (e.g. audio runs longer),
    # and freezing "past the end" would select no frame at all.
    video_dur = info.get("video_duration") or info["duration"]
    if t < 0 or t >= video_dur:
        return jsonify({"error": f"time must be within [0, {video_dur})"}), 400

    export_dir = get_output_dir()
    try:
        out_name = fu.unique_output_name(out_request or _derive_name(in_name, "held"),
                                         export_dir)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    out_path = os.path.join(export_dir, out_name)

    filt = fu.build_holdframe_filter(t, dur, fps, info["has_audio"])
    # A silent source stays silent. build_holdframe_filter emits an [outa]
    # track (the original audio, with anullsrc silence spliced in during the
    # hold) only when the source has audio to trim, so the -map list and the
    # info passed to the encoder have to agree with it: mapping a label the
    # graph never defined, or asking encode_args for an audio stream that
    # nothing feeds, both fail the render.
    input_args = ["-i", in_path]
    filter_args = ["-filter_complex", filt, "-map", "[outv]"]
    if info["has_audio"]:
        filter_args += ["-map", "[outa]"]

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        # A hold ADDS duration (freezes on top of the existing timeline,
        # doesn't replace any of it), so the output is the original
        # duration plus the hold, not just the original alone.
        total_sec = info["duration"] + dur
        try:
            out_name = multipass_export_render(input_args, filter_args, info,
                                               out_path, total_sec)
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name})

    args = input_args + filter_args
    args += fu.encode_args(info, quality)

    result, out_name = fu.run_ffmpeg_staged(args, out_path)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


# ---------- reverse ----------

@app.route("/api/reverse", methods=["POST"])
@cancel_on_disconnect
def reverse():
    data = request.get_json(force=True)
    try:
        in_name = _str_field(data.get("input"), "input")
        out_request = _str_field(data.get("output"), "output", required=False)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    try:
        in_path = fu.safe_path(in_name, fu.INPUT_DIR)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(in_path):
        return jsonify({"error": "input file not found"}), 404

    try:
        info = fu.get_video_info(in_path)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    est_bytes = fu.estimate_reverse_memory_bytes(
        info["width"], info["height"], info["duration"], info["fps"] or 30.0
    )
    if est_bytes > fu.REVERSE_WARN_THRESHOLD_BYTES and not data.get("confirm"):
        return jsonify({
            "warning": (
                "This clip is long/high-res; reverse buffers the whole video "
                "in memory and may use several GB of RAM or fail. Resend with "
                "confirm: true to proceed anyway."
            ),
            "estimated_bytes": est_bytes,
        }), 200

    export_dir = get_output_dir()
    try:
        out_name = fu.unique_output_name(out_request or _derive_name(in_name, "reversed"),
                                         export_dir)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    out_path = os.path.join(export_dir, out_name)

    input_args = ["-i", in_path]
    filter_args = ["-vf", "reverse", "-af", "areverse"]

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        try:
            out_name = multipass_export_render(input_args, filter_args, info, out_path,
                                               info["duration"])
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name})

    args = input_args + filter_args
    args += fu.encode_args(info, quality)
    result, out_name = fu.run_ffmpeg_staged(args, out_path)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


def _derive_name(input_name, suffix):
    base, ext = os.path.splitext(input_name)
    # The source's own container, unless the app cannot WRITE that container: a
    # .webm source derived a .webm output, which every render path fails on
    # (fu.RENDERABLE_EXTENSIONS explains why). It now derives .mp4 instead, so a
    # name the user never typed is never reported back to them as a bad output
    # name — and a .webm source becomes renderable by default rather than a
    # guaranteed 500 (finding #14).
    if ext.lower() not in fu.RENDERABLE_EXTENSIONS:
        ext = ".mp4"
    return f"{base}_{suffix}{ext}"


# ---------- chatbot ----------

def build_file_context(selected_clip=None):
    inputs = [f["name"] for f in _list_dir(fu.INPUT_DIR)]
    outputs = [f["name"] for f in _list_dir(fu.OUTPUT_DIR)]
    context = (
        f"Files currently in input/: {', '.join(inputs) if inputs else '(none)'}.\n"
        f"Files currently in output/: {', '.join(outputs) if outputs else '(none)'}."
    )
    if selected_clip:
        # The clip selected on the timeline when the user sent this message —
        # lets "make it slower"/"crop this" resolve without the user having
        # to name the file, and tells the model which file to write back to
        # so the frontend can offer to load the result onto that same clip.
        context += f"\nThe user currently has {selected_clip!r} selected on the timeline — assume that's the target file unless they name a different one."
    return context


def ask_claude(instruction, context, session_id=None):
    if session_id:
        # Resuming: the model already has the file list and prior turns in
        # context, so just send the new instruction plus a light reminder of
        # the response contract (schema alone doesn't repeat the rules).
        prompt = (
            f"User instruction: {instruction}\n\n"
            "Respond with a single ffmpeg command (paths relative to the "
            "project, e.g. input/<file> and output/<file>) plus a one-sentence "
            "explanation. Must start with 'ffmpeg' — never ffprobe or a shell "
            "loop. If still ambiguous or not an edit, set ffmpeg_command to "
            "an empty string and ask/explain in the explanation field. If the "
            "command re-encodes video, always use '-c:v libx264 -qp 0' "
            "(lossless) rather than default/lossy quality settings; if it "
            "re-encodes audio, set '-b:a'/'-ar'/'-ac' to match or exceed the "
            "source file's own audio bitrate/sample rate/channel count "
            "rather than leaving '-c:a aac' at ffmpeg's low default bitrate."
        )
    else:
        prompt = (
            f"{context}\n\n"
            f"User instruction: {instruction}\n\n"
            "Respond with a single ffmpeg command (using paths relative to the "
            "project, e.g. input/<file> and output/<file>) that performs this "
            "edit, plus a one-sentence explanation. The command must start with "
            "the literal word 'ffmpeg' — never ffprobe, a shell loop, or any "
            "other tool, even for informational requests. If the instruction "
            "cannot be expressed as a single ffmpeg command (e.g. it just asks "
            "a question, or is unrelated to editing a file in input/, or is "
            "ambiguous about which file to use), set ffmpeg_command to an "
            "empty string and ask a clarifying question or explain why in the "
            "explanation field instead. If the command re-encodes video, "
            "always use '-c:v libx264 -qp 0' (lossless) rather than "
            "default/lossy quality settings; if it re-encodes audio, set "
            "'-b:a'/'-ar'/'-ac' to match or exceed the source file's own "
            "audio bitrate/sample rate/channel count rather than leaving "
            "'-c:a aac' at ffmpeg's low default bitrate."
        )
    cmd = [CLAUDE_BIN, "-p", "--tools", "", "--output-format", "json",
           "--json-schema", CHAT_SCHEMA]
    if session_id:
        cmd += ["-r", session_id]
    cmd.append(prompt)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60)


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(force=True)
    try:
        instruction = _str_field(data.get("message"), "message", required=False).strip()
        session_id = _str_field(data.get("session_id"), "session_id", required=False) or None
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if not instruction:
        return jsonify({"error": "empty message"}), 400

    context = build_file_context(data.get("selected_clip"))

    try:
        proc = ask_claude(instruction, context, session_id)
    except subprocess.TimeoutExpired:
        return jsonify({"error": "claude CLI timed out after 60s"}), 504
    except FileNotFoundError:
        return jsonify({"error": "claude CLI not found at expected path"}), 500

    if proc.returncode != 0:
        return jsonify({
            "error": "claude CLI failed",
            "detail": proc.stderr.strip()[:2000],
        }), 502

    try:
        top = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return jsonify({
            "error": "claude CLI returned non-JSON output",
            "detail": proc.stdout[:2000],
        }), 502

    if top.get("is_error"):
        return jsonify({
            "error": "claude reported an error",
            "detail": str(top.get("result"))[:2000],
        }), 502

    new_session_id = top.get("session_id") or session_id

    structured = top.get("structured_output")
    if not structured:
        try:
            structured = json.loads(top.get("result", ""))
        except (json.JSONDecodeError, TypeError):
            return jsonify({
                "error": "no structured output in claude response",
                "session_id": new_session_id,
            }), 502

    cmd = structured.get("ffmpeg_command", "")
    explanation = structured.get("explanation", "")

    ok, reason, _argv = fu.validate_ffmpeg_command(cmd)
    return jsonify({
        "session_id": new_session_id,
        "needs_clarification": not cmd and not ok,
        "ffmpeg_command": cmd,
        "explanation": explanation,
        "valid": ok,
        "validation_error": None if ok else reason,
    })


def _output_arg_info(argv):
    """The chatbot's ffmpeg command names its own output path (unlike
    render_timeline, which derives it itself) — recover which file was
    actually written, and whether it landed in input/ or output/, so the
    caller can offer to load it back onto the timeline in place of the clip
    that was being edited. Mirrors validate_ffmpeg_command's own path-arg
    detection (last positional argument not starting with '-')."""
    if len(argv) <= 1 or argv[-1].startswith("-"):
        return None
    out_path = argv[-1]
    abs_p = out_path if os.path.isabs(out_path) else os.path.join(fu.PROJECT_ROOT, out_path)
    resolved = os.path.realpath(abs_p)
    if resolved.startswith(os.path.realpath(fu.OUTPUT_DIR) + os.sep):
        return {"name": os.path.basename(resolved), "dir": "output"}
    if resolved.startswith(os.path.realpath(fu.INPUT_DIR) + os.sep):
        return {"name": os.path.basename(resolved), "dir": "input"}
    return None


@app.route("/api/execute", methods=["POST"])
@cancel_on_disconnect
def execute():
    data = request.get_json(force=True)
    cmd = data.get("command", "")
    ok, reason, argv = fu.validate_ffmpeg_command(cmd)
    if not ok:
        return jsonify({"error": reason}), 400

    # -nostdin for the reason run_ffmpeg passes it (see its docstring): without
    # it, a server launched into a background process group has this ffmpeg —
    # and itself — stopped by SIGTTOU the moment the encoder touches the tty.
    argv = argv[:1] + ["-nostdin"] + argv[1:]

    try:
        # fu.run_tracked, not subprocess.run: same call, but the child is in the
        # registry the shutdown handlers kill from, so a chat-issued encode is no
        # more able to outlive the server than a Render is (finding #8).
        result = fu.run_tracked(argv, timeout=600)
    except subprocess.TimeoutExpired:
        return jsonify({"error": "ffmpeg timed out after 600s"}), 504

    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500

    # ffmpeg exits **0** when it refuses to overwrite an existing output, so the
    # returncode alone would report a write that never happened and the chat
    # panel would repoint the clip at a stale file. This route has no -y of its
    # own (validate_ffmpeg_command doesn't add one), so the refusal is ordinary,
    # not exotic: any command naming a target that already exists hits it. It
    # used to be invisible because the prompt blocked on the tty and surfaced as
    # the 600s timeout above; -nostdin makes ffmpeg decline immediately instead.
    # Keyed on ffmpeg's own message rather than on stat'ing the output, because
    # the output arg is not always a literal path that appears on disk — image2
    # and `-f segment` write printf patterns (`frame%03d.png`), and stat'ing
    # those reported a successful export as a failure. Verified on ffmpeg 8.1.2:
    # "already exists" appears for the refusal (single- AND multi-output forms)
    # and for no successful run, including both pattern muxers with -y and
    # without.
    if "already exists" in result.stderr:
        return jsonify({"error": "ffmpeg refused to overwrite an existing file, "
                                 "so nothing was written",
                        "detail": result.stderr[-4000:]}), 500

    return jsonify({"ok": True, "stderr_tail": result.stderr[-1000:], "output": _output_arg_info(argv)})


if __name__ == "__main__":
    # Say once, up front, that the render engine is not installed. Every render,
    # probe and preview fails without it, and until now each one failed on its
    # own terms with nothing tying the failures together — while README.txt has
    # carried a troubleshooting entry called "The app says it can't find ffmpeg"
    # for a message the app never actually printed (finding #12). Printed rather
    # than raised: the server is still worth having up (the UI loads, files list,
    # projects open), and refusing to start would take away the one screen that
    # could explain itself.
    for _name, _path in fu.missing_tools():
        print(f"  !!  {fu.missing_tool_message(_path)}", flush=True)
    # Sweep the preview cache once, before serving. Nothing ever evicted it, so
    # it grew to 602 MB here with 83% of that unreachable (finding #13). Doing it
    # at startup rather than only on a cache miss means a user who has stopped
    # previewing new files still gets the space back, and it is the one moment
    # with no request in flight to race.
    _gone, _bytes = fu.prune_preview_cache([fu.INPUT_DIR, get_output_dir()])
    if _gone:
        print(f"  ..  preview cache: removed {_gone} file(s), "
              f"reclaimed {_bytes / 1e6:.0f} MB", flush=True)
    # A render outlives the request that started it only in the sense that
    # ffmpeg is a separate process: nothing here used to be able to stop one, so
    # every reloader restart (including the one the line below arms for VERSION)
    # left the encoder running, orphaned onto PID 1, with the result going
    # nowhere. Handlers installed before app.run so they are in place for the
    # first request, not just for renders that start after some later event
    # (finding #8).
    fu.install_shutdown_handlers()
    # `extra_files` puts VERSION under the reloader's watch alongside the .py
    # files it already follows. APP_VERSION is read once at import, so without
    # this a bump would leave the running server reporting the old number until
    # someone happened to restart it — exactly the drift this setup exists to
    # prevent, and the hardest kind to notice.
    app.run(host="127.0.0.1", port=5001, debug=True, extra_files=[VERSION_FILE])
