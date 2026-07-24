import json
import os
import shlex
import subprocess

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
INPUT_DIR = os.path.join(PROJECT_ROOT, "input")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"

ALLOWED_EXTENSIONS = (".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm")

REVERSE_WARN_THRESHOLD_BYTES = 2 * 1024**3

PREVIEW_CACHE_DIR = os.path.join(PROJECT_ROOT, ".preview_cache")

BROWSER_SAFE_VIDEO_CODECS = {"h264", "vp8", "vp9", "av1"}
BROWSER_SAFE_AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", None}


class PathError(ValueError):
    pass


def safe_path(name, base):
    """Resolve `name` under `base` (INPUT_DIR or OUTPUT_DIR); reject traversal."""
    if not name or os.path.isabs(name):
        raise PathError(f"invalid filename: {name!r}")
    candidate = os.path.realpath(os.path.join(base, name))
    base_real = os.path.realpath(base)
    if os.path.commonpath([candidate, base_real]) != base_real:
        raise PathError(f"path {name!r} escapes {base}")
    return candidate


def probe(path):
    result = subprocess.run(
        [FFPROBE, "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", path],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffprobe failed")
    return json.loads(result.stdout)


def get_video_info(path):
    """Return technical info for a media file: duration, resolution, fps,
    codecs, bitrate, container format, file size, audio sample rate/channels,
    and whether it's directly playable in a browser <video> tag."""
    data = probe(path)
    fmt = data.get("format", {})
    duration = float(fmt.get("duration", 0.0))
    width = height = None
    fps = None
    has_audio = False
    video_codec = None
    audio_codec = None
    audio_sample_rate = None
    audio_channels = None
    audio_bit_rate = None
    nb_frames = None
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video" and width is None:
            width = stream.get("width")
            height = stream.get("height")
            video_codec = stream.get("codec_name")
            nb_frames = stream.get("nb_frames")
            rate = stream.get("r_frame_rate", "0/1")
            num, _, den = rate.partition("/")
            try:
                fps = float(num) / float(den) if den and float(den) != 0 else float(num)
            except (ValueError, ZeroDivisionError):
                fps = 30.0
        if stream.get("codec_type") == "audio":
            has_audio = True
            audio_codec = stream.get("codec_name")
            audio_sample_rate = stream.get("sample_rate")
            audio_channels = stream.get("channels")
            audio_bit_rate = stream.get("bit_rate")
    browser_playable = (
        video_codec in BROWSER_SAFE_VIDEO_CODECS
        and audio_codec in BROWSER_SAFE_AUDIO_CODECS
    )
    try:
        nb_frames = int(nb_frames) if nb_frames is not None else None
    except ValueError:
        nb_frames = None
    return {
        "duration": duration,
        "width": width,
        "height": height,
        "fps": fps,
        "has_audio": has_audio,
        "video_codec": video_codec,
        "audio_codec": audio_codec,
        "audio_sample_rate": int(audio_sample_rate) if audio_sample_rate else None,
        "audio_channels": audio_channels,
        "audio_bit_rate": int(audio_bit_rate) if audio_bit_rate else None,
        "browser_playable": browser_playable,
        "format_name": fmt.get("format_long_name") or fmt.get("format_name"),
        "size_bytes": int(fmt.get("size")) if fmt.get("size") else os.path.getsize(path),
        "bit_rate": int(fmt.get("bit_rate")) if fmt.get("bit_rate") else None,
        "nb_frames": nb_frames,
    }


MIN_AUDIO_BITRATE = 192000


def lossless_encode_args(source_info):
    """-c:v/-c:a args for rendered output: mathematically lossless video,
    and AAC audio matched to (never worse than) the source's bitrate/
    sample-rate/channels. AAC itself is lossy by nature, but this removes
    the avoidable degradation ffmpeg's own encoder defaults would otherwise
    introduce. `source_info` is a get_video_info() dict, or for multi-input
    operations (splice) the per-field maximum across all inputs' dicts.

    Uses "-qp 0" (constant quantizer), not "-crf 0". Verified by hand on
    this ffmpeg build (libx264 via Homebrew) that -crf 0 does NOT round-trip
    bit-exact for 10-bit (yuv420p10le) sources — only -qp 0 does. -crf 0 is
    the commonly-cited "lossless" flag online, but that only holds for
    8-bit; sources here are typically 10-bit HEVC, so -qp 0 is required.
    """
    args = ["-c:v", "libx264", "-qp", "0", "-preset", "medium"]
    if source_info.get("has_audio"):
        bit_rate = max(source_info.get("audio_bit_rate") or 0, MIN_AUDIO_BITRATE)
        sample_rate = source_info.get("audio_sample_rate") or 44100
        channels = source_info.get("audio_channels") or 2
        args += ["-c:a", "aac", "-b:a", str(bit_rate),
                 "-ar", str(sample_rate), "-ac", str(channels)]
    else:
        args += ["-an"]
    return args


def get_or_make_preview(path):
    """Return a path to a browser-playable version of `path`.

    If the source is already H.264/AAC (or similar), returns it unchanged.
    Otherwise transcodes once into PREVIEW_CACHE_DIR and reuses that on
    subsequent calls (keyed by source path + mtime, so edits invalidate it).
    """
    info = get_video_info(path)
    if info["browser_playable"]:
        return path, info

    os.makedirs(PREVIEW_CACHE_DIR, exist_ok=True)
    mtime = int(os.path.getmtime(path))
    key = f"{os.path.basename(path)}.{mtime}.preview.mp4"
    cached = os.path.join(PREVIEW_CACHE_DIR, key)
    if not os.path.exists(cached):
        args = ["-i", path, "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-movflags", "+faststart", cached]
        result = run_ffmpeg(args)
        if result.returncode != 0:
            raise RuntimeError(result.stderr[-2000:])
    return cached, info


def run_ffmpeg(args, timeout=600):
    """args must NOT include the ffmpeg binary itself; -y is always added."""
    cmd = [FFMPEG, "-y"] + args
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def unique_output_name(name):
    """If `name` already exists in OUTPUT_DIR, append a numeric suffix."""
    base, ext = os.path.splitext(name)
    candidate = name
    n = 1
    while os.path.exists(os.path.join(OUTPUT_DIR, candidate)):
        candidate = f"{base}_{n}{ext}"
        n += 1
    return candidate


def build_concat_filter(count, target_w, target_h, target_fps,
                         has_audio_flags, sample_rate=44100, channel_layout="stereo"):
    """Build a filter_complex string that normalizes and concatenates `count` inputs."""
    chains = []
    interleave_parts = []
    for i in range(count):
        chains.append(
            f"[{i}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
            f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={target_fps}[v{i}]"
        )
        if has_audio_flags[i]:
            chains.append(
                f"[{i}:a]aformat=sample_rates={sample_rate}:channel_layouts={channel_layout}[a{i}]"
            )
        else:
            chains.append(
                f"anullsrc=channel_layout={channel_layout}:sample_rate={sample_rate}[a{i}]"
            )
        interleave_parts.append(f"[v{i}][a{i}]")
    chains.append(f"{''.join(interleave_parts)}concat=n={count}:v=1:a=1[outv][outa]")
    return ";".join(chains)


def build_holdframe_filter(t, dur, fps, sample_rate=44100, channel_layout="stereo"):
    """Freeze the frame at time t for dur seconds; silence audio during the hold."""
    frame_dur = 1.0 / fps
    t_end = t + frame_dur
    n_loops = max(round(dur * fps) - 1, 0)
    return (
        f"[0:v]trim=start=0:end={t},setpts=PTS-STARTPTS[v0];"
        f"[0:v]trim=start={t}:end={t_end},setpts=PTS-STARTPTS,"
        f"loop=loop={n_loops}:size=1:start=0,setpts=PTS-STARTPTS[vfreeze];"
        f"[0:v]trim=start={t_end},setpts=PTS-STARTPTS[v1];"
        f"[v0][vfreeze][v1]concat=n=3:v=1:a=0[outv];"
        f"[0:a]atrim=start=0:end={t},asetpts=PTS-STARTPTS[a0];"
        f"anullsrc=channel_layout={channel_layout}:sample_rate={sample_rate}:duration={dur}[afreeze];"
        f"[0:a]atrim=start={t},asetpts=PTS-STARTPTS[a1];"
        f"[a0][afreeze][a1]concat=n=3:v=0:a=1[outa]"
    )


def estimate_reverse_memory_bytes(width, height, duration_s, fps):
    if not width or not height or not fps:
        return 0
    return width * height * 3 * fps * duration_s


def validate_ffmpeg_command(cmd):
    """Parse `cmd` into a safe argv list. Returns (ok, reason, argv).

    No character blocklist is applied to argument contents: subprocess.run is
    always called with a list (never shell=True), so characters like ; ( ) $
    are inert — passed to execve literally as part of one argv element, not
    interpreted by a shell. ffmpeg's own filter_complex syntax legitimately
    needs ';', '()', etc. (e.g. multi-step filter graphs), so blocking them
    would reject valid commands without adding any real protection.
    """
    try:
        tokens = shlex.split(cmd)
    except ValueError as e:
        return False, f"could not parse command: {e}", None

    if not tokens:
        return False, "empty command", None

    if tokens[0] not in ("ffmpeg", FFMPEG):
        return False, "command must start with 'ffmpeg'", None

    # Force the real binary path regardless of what the model wrote.
    argv = [FFMPEG] + tokens[1:]

    # Collect path-looking arguments: anything following -i, and the final
    # positional (output) argument.
    path_args = []
    for i, tok in enumerate(argv):
        if i > 0 and argv[i - 1] == "-i":
            path_args.append(tok)
    if len(argv) > 1 and not argv[-1].startswith("-"):
        path_args.append(argv[-1])

    for p in path_args:
        abs_p = p if os.path.isabs(p) else os.path.join(PROJECT_ROOT, p)
        resolved = os.path.realpath(abs_p)
        in_input = resolved.startswith(os.path.realpath(INPUT_DIR) + os.sep)
        in_output = resolved.startswith(os.path.realpath(OUTPUT_DIR) + os.sep)
        if not (in_input or in_output):
            return False, f"path outside input/output: {p!r}", None
        if in_input and not os.path.exists(resolved):
            return False, f"input file does not exist: {p!r}", None

    return True, None, argv
