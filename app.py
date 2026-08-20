import json
import os
import shutil
import subprocess
import time

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

import ffmpeg_utils as fu

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024**3  # 2 GB

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
    base = fu.INPUT_DIR if which == "input" else fu.OUTPUT_DIR
    try:
        path = fu.safe_path(name, base)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(path):
        return jsonify({"error": "file not found"}), 404
    try:
        preview_path, _info = fu.get_or_make_preview(path)
    except RuntimeError as e:
        return jsonify({"error": "could not build preview", "detail": str(e)}), 500
    directory, filename = os.path.split(preview_path)
    return send_from_directory(directory, filename)


# ---------- file listing / probing ----------

def _list_dir(base):
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
    base = fu.INPUT_DIR if which == "input" else fu.OUTPUT_DIR
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
    name = secure_filename(f.filename)
    if not name.lower().endswith(fu.MEDIA_EXTENSIONS):
        return jsonify({"error": f"unsupported file type: {name}"}), 400
    dest = os.path.join(fu.INPUT_DIR, name)
    if os.path.exists(dest):
        base, ext = os.path.splitext(name)
        name = f"{base}_{int(time.time())}{ext}"
        dest = os.path.join(fu.INPUT_DIR, name)
    f.save(dest)
    return jsonify({"name": name})


@app.route("/api/clear_input", methods=["POST"])
def clear_input():
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


@app.route("/api/projects", methods=["POST"])
def save_project():
    data = request.get_json(force=True)
    name = secure_filename(data.get("name") or "project.nara")
    if not name.endswith(".nara"):
        name += ".nara"
    project = data.get("project")
    if not isinstance(project, dict) or not isinstance(project.get("clips"), list):
        return jsonify({"error": "invalid project payload — expected {clips: [...]}"}), 400
    os.makedirs(PROJECTS_DIR, exist_ok=True)
    with open(os.path.join(PROJECTS_DIR, name), "w") as f:
        json.dump(project, f, indent=2)
    return jsonify({"ok": True, "name": name})


@app.route("/api/projects/<name>", methods=["GET"])
def load_project(name):
    try:
        path = fu.safe_path(name, PROJECTS_DIR)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(path):
        return jsonify({"error": "project not found"}), 404
    with open(path) as f:
        return jsonify(json.load(f))


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
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)


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
    need only the one except clause."""
    quality = get_export_quality()
    if quality == "custom":
        try:
            settings = get_custom_export_settings()
        except ValueError as e:
            raise RuntimeError(str(e))
        try:
            return fu.render_custom_two_pass(input_args, filter_args, source_info, out_path,
                                             duration_s, settings, timeout=timeout)
        except ValueError as e:
            raise RuntimeError(str(e))
    return fu.render_size_capped(input_args, filter_args, source_info, out_path, duration_s,
                                 timeout=timeout,
                                 codec="hevc" if quality == "under50mb_hevc" else "h264")


def resolve_media_dir(which):
    """Map a request's `dir` field onto one of the two media folders: "input"
    is the Media Bin's sources, anything else (the default) the Export Bin.
    Only the export side is user-relocatable, so it goes through
    get_output_dir()."""
    return fu.INPUT_DIR if which == "input" else get_output_dir()


@app.route("/api/browse_directory", methods=["POST"])
def browse_directory():
    """Open a native macOS folder-picker dialog and return the selected path."""
    data = request.get_json(force=True) if request.data else {}
    initial_dir = data.get("initial") or fu.OUTPUT_DIR

    try:
        import subprocess as _sp
        # Use osascript (AppleScript) for a native folder picker — it's
        # simpler and more reliable than tkinter on macOS, which requires
        # additional setup (Tcl/Tk framework) and often fails headless.
        script = (
            'tell application "System Events"\n'
            f'  set theFolder to choose folder with prompt "Select export directory" '
            f'default location POSIX file "{initial_dir}"\n'
            '  return POSIX path of theFolder\n'
            'end tell'
        )
        result = _sp.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            # User cancelled or error
            return jsonify({"cancelled": True, "path": ""})
        path = result.stdout.strip().rstrip("/")
        return jsonify({"cancelled": False, "path": path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/reveal_file", methods=["POST"])
def reveal_file():
    """Reveal a source (dir="input") or rendered file in the OS file browser
    (Finder on macOS)."""
    data = request.get_json(force=True)
    name = data.get("name") or ""
    try:
        path = fu.safe_path(name, resolve_media_dir(data.get("dir")))
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
    old = data.get("name") or ""
    new = secure_filename(data.get("newName") or "")
    if not new:
        return jsonify({"error": "new name required"}), 400
    out_dir = resolve_media_dir(data.get("dir"))
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
        output_dir = (data.get("output_dir") or "").strip()
        if output_dir:
            if not os.path.isabs(output_dir):
                return jsonify({"error": "output_dir must be an absolute path"}), 400
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
    UI's own placeholder text). Only used to size a size-capped mode's
    bitrate budget — trimming itself is still done by ffmpeg's own -ss/-to."""
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
def trim():
    data = request.get_json(force=True)
    try:
        in_path = fu.safe_path(data["input"], fu.INPUT_DIR)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(in_path):
        return jsonify({"error": "input file not found"}), 404

    start = data.get("start", "0")
    end = data.get("end")
    if not end:
        return jsonify({"error": "end time is required"}), 400

    try:
        info = fu.get_video_info(in_path)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    out_name = fu.unique_output_name(data.get("output") or _derive_name(data["input"], "trimmed"))
    out_path = os.path.join(fu.OUTPUT_DIR, out_name)

    input_args = ["-i", in_path, "-ss", str(start), "-to", str(end)]

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        try:
            trim_duration = _parse_time_to_sec(end) - _parse_time_to_sec(start)
        except ValueError:
            return jsonify({"error": "start/end must be numeric seconds or a HH:MM:SS.ms timecode"}), 400
        try:
            multipass_export_render(input_args, [], info, out_path, trim_duration)
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name})

    args = input_args + fu.encode_args(info, quality)
    args.append(out_path)
    result = fu.run_ffmpeg(args)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


# ---------- splice ----------

@app.route("/api/splice", methods=["POST"])
def splice():
    data = request.get_json(force=True)
    names = data.get("inputs") or []
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

    out_name = fu.unique_output_name(data.get("output") or "spliced.mp4")
    out_path = os.path.join(fu.OUTPUT_DIR, out_name)

    filt = fu.build_concat_filter(len(in_paths), target_w, target_h, target_fps, has_audio_flags)

    input_args = []
    for p in in_paths:
        input_args += ["-i", p]
    filter_args = ["-filter_complex", filt, "-map", "[outv]", "-map", "[outa]"]

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        total_sec = sum(i["duration"] for i in infos)
        try:
            multipass_export_render(input_args, filter_args, combined_info, out_path, total_sec)
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name})

    args = input_args + filter_args
    args += fu.encode_args(combined_info, quality)
    args.append(out_path)

    result = fu.run_ffmpeg(args)
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


@app.route("/api/render_timeline", methods=["POST"])
def render_timeline():
    data = request.get_json(force=True)
    clips = data.get("clips") or []
    if not clips:
        return jsonify({"error": "need at least 1 clip"}), 400

    try:
        in_paths = [
            fu.safe_path(c["input"], get_output_dir() if c.get("dir") == "output" else fu.INPUT_DIR)
            for c in clips
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
        try:
            ov_path = fu.safe_path(
                raw_ov["input"],
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
    for n, raw_bed in enumerate(_a1_request_beds(data)):
        try:
            bed_name = raw_bed["input"]
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
        try:
            in_sec = float(c["inSec"])
            out_sec = float(c["outSec"])
        except (KeyError, ValueError, TypeError):
            return jsonify({"error": f"clip {i}: inSec/outSec must be numeric"}), 400
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
        lead_hold = float(c.get("headHoldSec") or 0) if is_first else 0.0
        # Freezing an already-frozen frame is a pixel no-op, so a trailing
        # tail-hold and round-hold (Raise) on the same last clip just add.
        trail_hold = (float(c.get("tailHoldSec") or 0) + float(c.get("roundHoldSec") or 0)) if is_last else 0.0

        # Slow-down: pure PTS stretch, so the only quality constraint is
        # the effective frame rate — refuse anything that would fall below
        # 12 fps (frames held so long the motion visibly stutters).
        try:
            # `or` would coerce a literal 0 to the default and skip the
            # range check below — only substitute the default for absent/null.
            raw_speed = c.get("speed")
            speed = 1.0 if raw_speed is None else float(raw_speed)
        except (ValueError, TypeError):
            return jsonify({"error": f"clip {i}: speed must be numeric"}), 400
        clip_fps = info["fps"] or 30.0
        if not (0 < speed <= 1.0):
            return jsonify({"error": f"clip {i}: speed must be in (0, 1] — only slow-down is supported"}), 400
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
    out_name = data.get("output") or "render.mp4"
    # Ensure unique within the export directory
    base, ext = os.path.splitext(out_name)
    candidate = out_name
    n = 1
    while os.path.exists(os.path.join(export_dir, candidate)):
        candidate = f"{base}_{n}{ext}"
        n += 1
    out_name = candidate
    out_path = os.path.join(export_dir, out_name)

    # How far the A1 lane's SOUND reaches, which is what keeps room tone off it
    # (see fu.noise_fill_plan). Summed from each file's audio-stream duration, not
    # its container duration: a file whose video runs past its audio would
    # otherwise be credited with sound it does not have.
    bed_reach_sec = sum(i.get("audio_duration") or 0.0 for i in bed_infos)

    filt = fu.build_timeline_filter(
        clip_specs, target_w, target_h, target_fps, no_audio=no_audio, audio_beds=bed_indexes,
        fill_noise=noise_index, bed_reach_sec=bed_reach_sec
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
            clip_specs, bed_reach_sec=bed_reach_sec, has_bed=bool(bed_indexes)
        )
        noise_report = {"noise_fill_sec": round(tone_sec, 3),
                        "sequence_sec": round(seq_sec, 3)}

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        total_sec = sum(_clip_total_sec(spec) for spec in clip_specs)
        try:
            multipass_export_render(input_args, filter_args, combined_info, out_path, total_sec)
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name, **noise_report})

    args = input_args + filter_args
    args += fu.encode_args(combined_info, quality)
    args.append(out_path)

    # A single-pass whole-timeline render at -qp 0 can run long; the
    # default 600s timeout was sized for single short operations.
    result = fu.run_ffmpeg(args, timeout=1800)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name, **noise_report})


@app.route("/api/render_a1", methods=["POST"])
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
    if not raw_beds and not fill_noise_on:
        return jsonify({"error": "nothing on A1 to render: load an audio track or turn on A1 Room Tone"}), 400

    in_paths = []
    try:
        for c in clips:
            in_paths.append(fu.safe_path(
                c["input"], get_output_dir() if c.get("dir") == "output" else fu.INPUT_DIR
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
        try:
            in_sec = float(c["inSec"])
            out_sec = float(c["outSec"])
        except (KeyError, ValueError, TypeError):
            return jsonify({"error": f"clip {i}: inSec/outSec must be numeric"}), 400
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
        if not (0 < speed <= 1.0):
            return jsonify({"error": f"clip {i}: speed must be in (0, 1] — only slow-down is supported"}), 400
        is_first = i == 0
        is_last = i == len(clips) - 1
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
            "lead_hold_sec": float(c.get("headHoldSec") or 0) if is_first else 0.0,
            "trail_hold_sec": (float(c.get("tailHoldSec") or 0) + float(c.get("roundHoldSec") or 0)) if is_last else 0.0,
        })

    # The A1 lane is the only real input (plus the noise asset) — resolved and
    # probed exactly as render_timeline does, in lane order, including the
    # has-audio check that would otherwise become an unbindable [N:a] pad and an
    # opaque exit 234.
    input_paths = []
    bed_indexes = []
    bed_infos = []
    for n, raw_bed in enumerate(raw_beds):
        try:
            bed_name = raw_bed["input"]
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

    # Same measured lane reach render_timeline computes, from the same key, so the
    # stem's room tone lands in exactly the same stretches as the render's.
    bed_reach_sec = sum(i.get("audio_duration") or 0.0 for i in bed_infos)

    try:
        filt = fu.build_a1_filter(clip_specs, audio_beds=bed_indexes,
                                  fill_noise=noise_index, bed_reach_sec=bed_reach_sec)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Always a .wav, whatever name the client asked for.
    export_dir = get_output_dir()
    base = os.path.splitext(data.get("output") or "render_A1")[0]
    candidate = f"{base}.wav"
    n = 1
    while os.path.exists(os.path.join(export_dir, candidate)):
        candidate = f"{base}_{n}.wav"
        n += 1
    out_path = os.path.join(export_dir, candidate)

    args = []
    for p in input_paths:
        args += ["-i", p]
    args += ["-filter_complex", filt, "-map", "[outa]", "-c:a", "pcm_s16le", out_path]
    result = fu.run_ffmpeg(args)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    noise_report = {}
    if noise_index is not None:
        tone_sec, seq_sec = fu.noise_fill_summary(
            clip_specs, bed_reach_sec=bed_reach_sec, has_bed=bool(bed_indexes)
        )
        noise_report = {"noise_fill_sec": round(tone_sec, 3),
                        "sequence_sec": round(seq_sec, 3)}
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
        in_path = fu.safe_path(
            data.get("input"), get_output_dir() if data.get("dir") == "output" else fu.INPUT_DIR
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
    out_name = data.get("output") or _derive_name(data.get("input", "reformat.mp4"), "reformat")
    base, ext = os.path.splitext(out_name)
    candidate = out_name
    n = 1
    while os.path.exists(os.path.join(export_dir, candidate)):
        candidate = f"{base}_{n}{ext}"
        n += 1
    out_name = candidate
    out_path = os.path.join(export_dir, out_name)

    input_args = ["-i", in_path]
    filter_args = ["-vf", f"scale={out_w}:{out_h}"]

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        try:
            multipass_export_render(input_args, filter_args, info, out_path, info["duration"])
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name})

    args = input_args + filter_args + fu.encode_args(info, quality)
    args.append(out_path)
    result = fu.run_ffmpeg(args)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


# ---------- hold frame ----------

@app.route("/api/hold_frame", methods=["POST"])
def hold_frame():
    data = request.get_json(force=True)
    try:
        in_path = fu.safe_path(data["input"], fu.INPUT_DIR)
    except fu.PathError as e:
        return jsonify({"error": str(e)}), 400
    if not os.path.exists(in_path):
        return jsonify({"error": "input file not found"}), 404

    try:
        t = float(data["time"])
        dur = float(data["duration"])
    except (KeyError, ValueError):
        return jsonify({"error": "time and duration must be numeric seconds"}), 400
    if dur <= 0:
        return jsonify({"error": "duration must be positive"}), 400

    try:
        info = fu.get_video_info(in_path)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    fps = info["fps"] or 30.0
    # Bound by the video stream's duration, not the container's — the
    # container can outlast the last video frame (e.g. audio runs longer),
    # and freezing "past the end" would select no frame at all.
    video_dur = info.get("video_duration") or info["duration"]
    if t < 0 or t >= video_dur:
        return jsonify({"error": f"time must be within [0, {video_dur})"}), 400

    out_name = fu.unique_output_name(data.get("output") or _derive_name(data["input"], "held"))
    out_path = os.path.join(fu.OUTPUT_DIR, out_name)

    filt = fu.build_holdframe_filter(t, dur, fps)
    # build_holdframe_filter always maps an [outa] track (original audio
    # plus anullsrc silence during the hold), so audio is present regardless
    # of the source's has_audio flag.
    hold_info = {**info, "has_audio": True}
    input_args = ["-i", in_path]
    filter_args = ["-filter_complex", filt, "-map", "[outv]", "-map", "[outa]"]

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        # A hold ADDS duration (freezes on top of the existing timeline,
        # doesn't replace any of it), so the output is the original
        # duration plus the hold, not just the original alone.
        total_sec = info["duration"] + dur
        try:
            multipass_export_render(input_args, filter_args, hold_info, out_path, total_sec)
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name})

    args = input_args + filter_args
    args += fu.encode_args(hold_info, quality)
    args.append(out_path)

    result = fu.run_ffmpeg(args)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


# ---------- reverse ----------

@app.route("/api/reverse", methods=["POST"])
def reverse():
    data = request.get_json(force=True)
    try:
        in_path = fu.safe_path(data["input"], fu.INPUT_DIR)
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

    out_name = fu.unique_output_name(data.get("output") or _derive_name(data["input"], "reversed"))
    out_path = os.path.join(fu.OUTPUT_DIR, out_name)

    input_args = ["-i", in_path]
    filter_args = ["-vf", "reverse", "-af", "areverse"]

    quality = get_export_quality()
    if quality in fu.MULTIPASS_QUALITIES:
        try:
            multipass_export_render(input_args, filter_args, info, out_path, info["duration"])
        except RuntimeError as e:
            return jsonify({"error": "ffmpeg failed", "detail": str(e)[-4000:]}), 500
        return jsonify({"output": out_name})

    args = input_args + filter_args
    args += fu.encode_args(info, quality)
    args.append(out_path)
    result = fu.run_ffmpeg(args)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


def _derive_name(input_name, suffix):
    base, ext = os.path.splitext(input_name)
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
    instruction = (data.get("message") or "").strip()
    session_id = data.get("session_id") or None
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
def execute():
    data = request.get_json(force=True)
    cmd = data.get("command", "")
    ok, reason, argv = fu.validate_ffmpeg_command(cmd)
    if not ok:
        return jsonify({"error": reason}), 400

    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        return jsonify({"error": "ffmpeg timed out after 600s"}), 504

    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500

    return jsonify({"ok": True, "stderr_tail": result.stderr[-1000:], "output": _output_arg_info(argv)})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)
