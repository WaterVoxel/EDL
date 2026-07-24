import json
import os
import subprocess
import time

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

import ffmpeg_utils as fu

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024**3  # 2 GB

CLAUDE_BIN = "/Users/sarmieaj/.toolbox/bin/claude"

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
    return send_from_directory(fu.OUTPUT_DIR, name)


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
        if os.path.isfile(p) and name.lower().endswith(fu.ALLOWED_EXTENSIONS):
            files.append({"name": name, "size": os.path.getsize(p), "modified": os.path.getmtime(p)})
    return files


@app.route("/api/files")
def list_files():
    return jsonify(_list_dir(fu.INPUT_DIR))


@app.route("/api/outputs")
def list_outputs():
    return jsonify(_list_dir(fu.OUTPUT_DIR))


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
    if not name.lower().endswith(fu.ALLOWED_EXTENSIONS):
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
        if os.path.isfile(p) and name.lower().endswith(fu.ALLOWED_EXTENSIONS):
            os.remove(p)
            removed.append(name)
    return jsonify({"removed": removed})


@app.route("/api/clear_output", methods=["POST"])
def clear_output():
    removed = []
    for name in os.listdir(fu.OUTPUT_DIR):
        p = os.path.join(fu.OUTPUT_DIR, name)
        if os.path.isfile(p) and name.lower().endswith(fu.ALLOWED_EXTENSIONS):
            os.remove(p)
            removed.append(name)
    return jsonify({"removed": removed})


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

    args = ["-i", in_path, "-ss", str(start), "-to", str(end)]
    args += fu.lossless_encode_args(info)
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
    }

    out_name = fu.unique_output_name(data.get("output") or "spliced.mp4")
    out_path = os.path.join(fu.OUTPUT_DIR, out_name)

    filt = fu.build_concat_filter(len(in_paths), target_w, target_h, target_fps, has_audio_flags)

    args = []
    for p in in_paths:
        args += ["-i", p]
    args += ["-filter_complex", filt, "-map", "[outv]", "-map", "[outa]"]
    args += fu.lossless_encode_args(combined_info)
    args.append(out_path)

    result = fu.run_ffmpeg(args)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


# ---------- render timeline ----------

@app.route("/api/render_timeline", methods=["POST"])
def render_timeline():
    data = request.get_json(force=True)
    clips = data.get("clips") or []
    if not clips:
        return jsonify({"error": "need at least 1 clip"}), 400

    try:
        in_paths = [fu.safe_path(c["input"], fu.INPUT_DIR) for c in clips]
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

        is_first = i == 0
        is_last = i == len(clips) - 1
        lead_hold = float(c.get("headHoldSec") or 0) if is_first else 0.0
        # Freezing an already-frozen frame is a pixel no-op, so a trailing
        # tail-hold and round-hold (Raise) on the same last clip just add.
        trail_hold = (float(c.get("tailHoldSec") or 0) + float(c.get("roundHoldSec") or 0)) if is_last else 0.0

        clip_specs.append({
            "inSec": in_sec,
            "outSec": out_sec,
            "fps": info["fps"] or 30.0,
            "has_audio": info["has_audio"],
            "lead_hold_sec": lead_hold,
            "trail_hold_sec": trail_hold,
        })

    target_w = max(i["width"] for i in infos)
    target_h = max(i["height"] for i in infos)
    target_fps = max(i["fps"] or 30 for i in infos)

    audio_infos = [i for i in infos if i["has_audio"]]
    combined_info = {
        "has_audio": True,
        "audio_bit_rate": max((i["audio_bit_rate"] or 0 for i in audio_infos), default=0),
        "audio_sample_rate": max((i["audio_sample_rate"] or 0 for i in audio_infos), default=0),
        "audio_channels": max((i["audio_channels"] or 0 for i in audio_infos), default=0),
    }

    out_name = fu.unique_output_name(data.get("output") or "render.mp4")
    out_path = os.path.join(fu.OUTPUT_DIR, out_name)

    filt = fu.build_timeline_filter(clip_specs, target_w, target_h, target_fps)

    args = []
    for p in in_paths:
        args += ["-i", p]
    args += ["-filter_complex", filt, "-map", "[outv]", "-map", "[outa]"]
    args += fu.lossless_encode_args(combined_info)
    args.append(out_path)

    # A single-pass whole-timeline render at -qp 0 can run long; the
    # default 600s timeout was sized for single short operations.
    result = fu.run_ffmpeg(args, timeout=1800)
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
    if t < 0 or t >= info["duration"]:
        return jsonify({"error": f"time must be within [0, {info['duration']})"}), 400

    out_name = fu.unique_output_name(data.get("output") or _derive_name(data["input"], "held"))
    out_path = os.path.join(fu.OUTPUT_DIR, out_name)

    filt = fu.build_holdframe_filter(t, dur, fps)
    # build_holdframe_filter always maps an [outa] track (original audio
    # plus anullsrc silence during the hold), so audio is present regardless
    # of the source's has_audio flag.
    hold_info = {**info, "has_audio": True}
    args = ["-i", in_path, "-filter_complex", filt,
            "-map", "[outv]", "-map", "[outa]"]
    args += fu.lossless_encode_args(hold_info)
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

    args = ["-i", in_path, "-vf", "reverse", "-af", "areverse"]
    args += fu.lossless_encode_args(info)
    args.append(out_path)
    result = fu.run_ffmpeg(args)
    if result.returncode != 0:
        return jsonify({"error": "ffmpeg failed", "detail": result.stderr[-4000:]}), 500
    return jsonify({"output": out_name})


def _derive_name(input_name, suffix):
    base, ext = os.path.splitext(input_name)
    return f"{base}_{suffix}{ext}"


# ---------- chatbot ----------

def build_file_context():
    inputs = [f["name"] for f in _list_dir(fu.INPUT_DIR)]
    outputs = [f["name"] for f in _list_dir(fu.OUTPUT_DIR)]
    return (
        f"Files currently in input/: {', '.join(inputs) if inputs else '(none)'}.\n"
        f"Files currently in output/: {', '.join(outputs) if outputs else '(none)'}."
    )


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

    context = build_file_context()

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

    return jsonify({"ok": True, "stderr_tail": result.stderr[-1000:]})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)
