import json
import math
import os
import shlex
import subprocess

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
INPUT_DIR = os.path.join(PROJECT_ROOT, "input")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"

ALLOWED_EXTENSIONS = (".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm")

# Audio-only files are accepted for one purpose: the A1 audio bed (see
# build_timeline_filter's audio_bed). ALLOWED_EXTENSIONS stays video-only on
# purpose — anywhere a VIDEO is required (a timeline clip, an overlay source)
# still gates on it, so an audio file can never be mistaken for a clip.
# MEDIA_EXTENSIONS is the wider "may live in input/ or the export dir" set,
# used by the listing/upload/delete/rename routes.
AUDIO_EXTENSIONS = (".wav", ".mp3", ".m4a", ".aac", ".flac", ".aiff")
MEDIA_EXTENSIONS = ALLOWED_EXTENSIONS + AUDIO_EXTENSIONS

# Fixed playback gain applied to the A1 bed before it is mixed under V1's own
# audio. amix normalize=0 is an exact unity-gain SUM (v1[i] + bed[i]), so a
# full-scale bed would clip the mix outright; a bed also belongs UNDER the
# dialogue by design. With no per-clip volume control in the UI, the gain
# lives here. The preview <audio> element uses the same value so what the
# user hears matches what renders.
BED_GAIN = 0.35

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
    video_duration = None
    video_profile = None
    pix_fmt = None
    bits_per_raw_sample = None
    video_bit_rate = None
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video" and width is None:
            width = stream.get("width")
            height = stream.get("height")
            video_codec = stream.get("codec_name")
            video_profile = stream.get("profile")
            pix_fmt = stream.get("pix_fmt")
            bits_per_raw_sample = stream.get("bits_per_raw_sample")
            video_bit_rate = stream.get("bit_rate")
            nb_frames = stream.get("nb_frames")
            # The video stream's own duration can be shorter than the
            # container/format duration (which reflects the longest stream,
            # often audio) — frame-freeze operations must never sample past
            # the last actual video frame, so track it separately.
            try:
                video_duration = float(stream["duration"])
            except (KeyError, ValueError, TypeError):
                video_duration = None
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
        "video_duration": video_duration if video_duration is not None else duration,
        "width": width,
        "height": height,
        "fps": fps,
        "has_audio": has_audio,
        "video_codec": video_codec,
        "video_profile": video_profile,
        "pix_fmt": pix_fmt,
        "bits_per_raw_sample": int(bits_per_raw_sample) if bits_per_raw_sample else None,
        "video_bit_rate": int(video_bit_rate) if video_bit_rate else None,
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

EXPORT_QUALITIES = ("lossless", "match", "high", "under50mb", "under50mb_hevc")

# Hard size cap for the "under50mb" mode, and the safety margin subtracted
# from it before any bitrate math — container/muxing overhead (moov atom,
# packet headers, index) is a few tenths of a percent, but two-pass ABR
# itself typically overshoots its target by 1-3% in practice, and the
# retry loop below needs headroom to shrink into on the first attempt
# rather than needing a retry for every single render.
UNDER_50MB_TARGET_BYTES = 50 * 1024 * 1024
UNDER_50MB_SAFETY_MARGIN = 0.92  # aim for 92% of the cap on the first pass

# Two-pass ABR cannot usefully target below this — libx264 starts refusing
# to maintain acceptable quality/stability much under ~100 kbps for normal
# content, and an unwatchable video is not a meaningful interpretation of
# "as lossless as possible."
MIN_VIDEO_BITRATE = 100_000

# Audio floor for under50mb: lower than MIN_AUDIO_BITRATE (which assumes
# plenty of budget) but still above where AAC becomes obviously degraded.
# Only used when the byte budget is tight enough that matching the
# source's own audio bitrate would leave too little for video.
UNDER_50MB_MIN_AUDIO_BITRATE = 96_000


def audio_args(source_info):
    """-c:a args shared by every quality mode: AAC matched to (never worse
    than) the source's bitrate/sample-rate/channels, or -an if silent."""
    if source_info.get("has_audio"):
        bit_rate = max(source_info.get("audio_bit_rate") or 0, MIN_AUDIO_BITRATE)
        sample_rate = source_info.get("audio_sample_rate") or 44100
        channels = source_info.get("audio_channels") or 2
        return ["-c:a", "aac", "-b:a", str(bit_rate),
                "-ar", str(sample_rate), "-ac", str(channels)]
    return ["-an"]


def target_bitrate_for_size(duration_s, source_info, target_bytes=UNDER_50MB_TARGET_BYTES,
                             safety=UNDER_50MB_SAFETY_MARGIN):
    """Split a byte budget into (video_bitrate, audio_bitrate) for a render
    of `duration_s` seconds, so video_bitrate*duration + audio_bitrate*duration
    ≈ target_bytes*8*safety. Audio is held at the source's own quality
    (floored at UNDER_50MB_MIN_AUDIO_BITRATE, not the higher MIN_AUDIO_BITRATE
    used elsewhere) unless doing so would leave less than MIN_VIDEO_BITRATE
    for video, in which case audio is squeezed down first — video is the
    dimension actually being asked to "look as lossless as possible," so it
    gets first claim on the budget.
    """
    duration_s = max(duration_s, 0.1)
    total_bits_budget = target_bytes * 8 * safety

    has_audio = source_info.get("has_audio")
    audio_rate = 0
    if has_audio:
        audio_rate = max(source_info.get("audio_bit_rate") or 0, UNDER_50MB_MIN_AUDIO_BITRATE)

    video_rate = (total_bits_budget / duration_s) - audio_rate
    if video_rate < MIN_VIDEO_BITRATE and has_audio:
        # Budget is tight enough that source-quality audio would starve
        # video below its own floor — give audio only what's left after
        # video takes MIN_VIDEO_BITRATE, down to a hard floor of its own.
        video_rate = MIN_VIDEO_BITRATE
        audio_rate = max((total_bits_budget / duration_s) - video_rate, 32_000)
    video_rate = max(int(video_rate), MIN_VIDEO_BITRATE)
    audio_rate = int(audio_rate) if has_audio else 0
    return video_rate, audio_rate


def encode_args(source_info, quality="lossless"):
    """-c:v/-c:a args for rendered output at the chosen quality mode.

    quality:
      "lossless" — mathematically lossless video (-qp 0). Uses "-qp 0"
        (constant quantizer), not "-crf 0": verified by hand on this ffmpeg
        build (libx264 via Homebrew) that -crf 0 does NOT round-trip
        bit-exact for 10-bit (yuv420p10le) sources — only -qp 0 does.
        -crf 0 is the commonly-cited "lossless" flag online, but that only
        holds for 8-bit. Note libx264 always emits the High 4:4:4
        Predictive profile in lossless mode, and losslessly re-encoding an
        already-lossy source typically costs 2-3x its size.
      "match" — target the source's own video bitrate (ABR with a 1.5x
        maxrate ceiling), so output size ≈ source size. Falls back to
        container bitrate minus audio when the video stream doesn't report
        its own rate, and to "high" when neither is known.
      "high" — CRF 18, visually lossless, usually smaller than the source.
      "under50mb" / "under50mb_hevc" — a HARD SIZE CAP that outranks
        quality: true losslessness has no size ceiling (entropy varies with
        content), so "lossless AND always under 50MB" is unsatisfiable for
        arbitrary footage. Neither mode is produced by this function — both
        need two full ffmpeg passes plus a measure-and-retry loop, not a
        single args list — see render_size_capped() below, which callers
        use in place of encode_args()+run_ffmpeg() entirely for these modes
        (codec="h264" for under50mb, codec="hevc" for under50mb_hevc — HEVC
        gets better quality per bit at the same size, at the cost of a much
        slower two-pass encode).

    Audio is identical in all modes here: AAC matched to (never worse
    than) the source's bitrate/sample-rate/channels — AAC is lossy by
    nature, but this removes the avoidable degradation ffmpeg's encoder
    defaults would otherwise introduce. `source_info` is a get_video_info()
    dict, or for multi-input operations the per-field maximum across all
    inputs' dicts.
    """
    if quality == "lossless":
        args = ["-c:v", "libx264", "-qp", "0", "-preset", "medium"]
    elif quality == "match":
        video_rate = source_info.get("video_bit_rate") or 0
        if not video_rate:
            container = source_info.get("bit_rate") or 0
            audio = source_info.get("audio_bit_rate") or 0
            video_rate = max(container - audio, 0)
        if video_rate:
            args = ["-c:v", "libx264", "-b:v", str(video_rate),
                    "-maxrate", str(int(video_rate * 1.5)),
                    "-bufsize", str(video_rate * 2), "-preset", "medium"]
        else:
            # No usable source bitrate to match — CRF 18 is the closest
            # "about as good as the source" stand-in.
            args = ["-c:v", "libx264", "-crf", "18", "-preset", "medium"]
    else:  # "high"
        args = ["-c:v", "libx264", "-crf", "18", "-preset", "medium"]

    return args + audio_args(source_info)


def lossless_encode_args(source_info):
    return encode_args(source_info, "lossless")


def _inject_pixel_format(filter_args, pix_fmt):
    """Append `,format=<pix_fmt>` onto whatever video filter chain
    `filter_args` already specifies, WITHOUT adding a second -vf/-filter_complex
    flag. ffmpeg silently lets a later duplicate -vf/-filter_complex flag on
    the same output stream replace the earlier one entirely (confirmed by
    hand: "Multiple -filter/-af/-vf options specified for stream 0, only the
    last option will be used") — appending a second, separate -vf would
    therefore silently DISCARD whatever filtering the caller already needed
    (e.g. reverse's own -vf "reverse", or a whole -filter_complex graph),
    not add to it. The only safe way to add a pixel-format conversion is to
    splice it directly into the existing filter string.

    Handles the three shapes seen at this project's 5 call sites:
      - [] (trim: no filter at all yet) -> adds a fresh -vf "format=<fmt>"
      - ["-vf", "<chain>", "-af", ...] (reverse) -> appends ",format=<fmt>"
        onto "<chain>" in place
      - ["-filter_complex", "<graph>", "-map", "[outv]", "-map", "[outa]"]
        (splice/render_timeline/hold_frame) -> every filter builder in this
        module terminates its video chain with the literal label "[outv]"
        (verified: build_concat_filter, build_holdframe_filter,
        build_timeline_filter all do). Renaming that label to an
        intermediate one and appending a new "format=<fmt>" node as a
        SEPARATE, semicolon-joined chain (rather than comma-chaining
        directly onto whatever produced [outv]) is required because
        build_concat_filter's/build_timeline_filter's terminal node is
        `concat=...[outv][outa]` — a single filter with TWO output labels.
        Comma-chaining a filter onto "[outv]" in place would try to attach
        one more filter step after only one of concat's two outputs, which
        ffmpeg rejects ("More output link labels specified for filter
        'format' than it has outputs") — confirmed by hand.
    """
    args = list(filter_args)
    if not args:
        return ["-vf", f"format={pix_fmt}"]
    if args[0] == "-vf":
        args[1] = f"{args[1]},format={pix_fmt}"
        return args
    if args[0] == "-filter_complex":
        if "[outv]" not in args[1]:
            raise ValueError("filter_complex has no [outv] label to inject pixel format before")
        graph = args[1].replace("[outv]", "[outv_pre]", 1)
        args[1] = f"{graph};[outv_pre]format={pix_fmt}[outv]"
        return args
    raise ValueError(f"unrecognized filter_args shape: {filter_args!r}")


# Two-pass stats-file suffixes to clean up per codec — libx264's -passlogfile
# and libx265's -x265-params stats= use different naming conventions
# (verified by hand: libx264 produces "<prefix>-0.log"/"-0.log.mbtree";
# libx265 produces "<file>" itself plus "<file>.cutree").
_PASSLOG_SUFFIXES = {
    "h264": ("-0.log", "-0.log.mbtree", ".log", ".log.mbtree"),
    "hevc": ("", ".cutree"),
}


def render_size_capped(input_args, filter_args, source_info, out_path, duration_s,
                        target_bytes=UNDER_50MB_TARGET_BYTES, timeout=1800, max_attempts=4,
                        codec="h264"):
    """Two-pass encode (libx264 or libx265) targeting the largest bitrate
    that fits `duration_s` seconds of video into `target_bytes`, then
    VERIFIES the real output file actually fits and shrinks+retries if it
    doesn't.

    Two-pass (not single-pass ABR, not CRF) is the deliberate choice here:
    CRF has no size guarantee at all (it targets a quality level and the
    resulting size depends entirely on content complexity — the opposite
    of what "always under 50MB" needs). Single-pass ABR knows a target
    bitrate but can't see the whole file's complexity in advance, so its
    real output routinely drifts several percent off target. Two-pass runs
    the encoder once to gather a per-frame complexity map (pass 1, video
    only, discarded to /dev/null) and a second time to actually spend the
    bit budget optimally against that map (pass 2) — this is the standard
    technique for "hit an exact size, maximize quality within it," and the
    reason this mode can claim "as lossless as possible under the cap"
    rather than just "somewhat smaller than the cap."

    codec: "h264" (default, libx264) or "hevc" (libx265, Main10 profile with
    a 10-bit yuv420p10le intermediate — H.265 gets meaningfully better
    quality per bit than H.264 at the same bitrate, which is a direct win
    for a mode whose whole point is "best quality under a hard size cap").
    Verified by hand on this project's ffmpeg build: libx265 has no
    -pass/-passlogfile options at all (unlike libx264) — two-pass is done
    via -x265-params "pass=1:stats=<file>"/"pass=2:stats=<file>" instead,
    and it DOES accept the same top-level -maxrate/-bufsize flags libx264
    does (confirmed via the encoded stream's own reported CPB properties),
    so those don't need a codec-specific branch.

    The measure-and-retry loop exists because even two-pass isn't a
    perfect guarantee — very short or very-high-motion clips can still
    overshoot slightly. Each retry shrinks the bitrate 15% and re-encodes
    both passes; this is the mechanism that actually enforces "no matter
    what" rather than merely aiming for it.

    input_args: the "-i ..." arguments (one or more inputs), identical for
    both passes. filter_args: any "-filter_complex ...-map...-map..."
    arguments (may be empty list for a single plain input). Both passes
    share these plus the pass-specific -c:v/-b:v/... args this function
    computes internally.

    Returns None on success (the file at out_path is the final result).
    Raises RuntimeError with the responsible ffmpeg's stderr on failure —
    including if every retry still overshoots the cap.
    """
    if codec == "hevc":
        filter_args = _inject_pixel_format(filter_args, "yuv420p10le")
    stats_prefix = out_path + ".ffpass"
    last_stderr = ""
    try:
        for attempt in range(max_attempts):
            shrink = 0.85 ** attempt  # shrink the bitrate 15% per retry
            video_rate, audio_rate = target_bitrate_for_size(
                duration_s, source_info, target_bytes=int(target_bytes * shrink))

            if codec == "hevc":
                common_video = ["-c:v", "libx265", "-profile:v", "main10",
                                 "-b:v", str(video_rate),
                                 "-maxrate", str(int(video_rate * 1.1)),
                                 "-bufsize", str(video_rate * 2), "-preset", "medium"]
                pass_args = [
                    ["-x265-params", f"pass=1:stats={stats_prefix}"],
                    ["-x265-params", f"pass=2:stats={stats_prefix}"],
                ]
            else:
                common_video = ["-c:v", "libx264", "-b:v", str(video_rate),
                                 "-maxrate", str(int(video_rate * 1.1)),
                                 "-bufsize", str(video_rate * 2), "-preset", "slow"]
                pass_args = [
                    ["-pass", "1", "-passlogfile", stats_prefix],
                    ["-pass", "2", "-passlogfile", stats_prefix],
                ]

            if source_info.get("has_audio"):
                sample_rate = source_info.get("audio_sample_rate") or 44100
                channels = source_info.get("audio_channels") or 2
                audio_out = ["-c:a", "aac", "-b:a", str(audio_rate),
                             "-ar", str(sample_rate), "-ac", str(channels)]
            else:
                audio_out = ["-an"]

            pass1 = (input_args + filter_args + common_video + pass_args[0] +
                     ["-an", "-f", "null", os.devnull])
            pass2 = (input_args + filter_args + common_video + audio_out +
                     pass_args[1] + [out_path])

            result1 = run_ffmpeg(pass1, timeout=timeout)
            if result1.returncode != 0:
                last_stderr = result1.stderr[-4000:]
                raise RuntimeError(last_stderr)

            result2 = run_ffmpeg(pass2, timeout=timeout)
            if result2.returncode != 0:
                last_stderr = result2.stderr[-4000:]
                raise RuntimeError(last_stderr)

            actual_size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
            if actual_size <= target_bytes:
                return None
            last_stderr = (
                f"encode succeeded but output was {actual_size} bytes "
                f"(over the {target_bytes} byte cap) after {attempt + 1} attempt(s)"
            )
        raise RuntimeError(last_stderr)
    finally:
        for suffix in _PASSLOG_SUFFIXES[codec]:
            try:
                os.remove(stats_prefix + suffix)
            except OSError:
                pass


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


# Reformat presets: bounding boxes a source is scaled DOWN to fit inside
# (never up), one per (resolution tier, target aspect ratio) combination —
# fixed numbers as given by product, not derived. This is a bounding box
# for `scale=w:h:force_original_aspect_ratio=decrease`, not a crop target,
# so it deliberately has no pad step: the output keeps the source's exact
# native aspect ratio and is whatever size the proportional scale-down
# produces, not letterboxed to match the preset ratio exactly.
REFORMAT_RESOLUTIONS = ("480p", "720p", "1080p", "4K")
REFORMAT_RATIOS = ("16:9", "4:3", "1:1", "3:4", "9:16", "21:9")
REFORMAT_PRESETS = {
    "480p": {
        "16:9": (864, 496), "4:3": (752, 560), "1:1": (640, 640),
        "3:4": (560, 752), "9:16": (496, 864), "21:9": (992, 432),
    },
    "720p": {
        "16:9": (1280, 720), "4:3": (1112, 834), "1:1": (960, 960),
        "3:4": (834, 1112), "9:16": (720, 1280), "21:9": (1470, 630),
    },
    "1080p": {
        "16:9": (1920, 1080), "4:3": (1664, 1248), "1:1": (1440, 1440),
        "3:4": (1248, 1664), "9:16": (1080, 1920), "21:9": (2206, 946),
    },
    "4K": {
        "16:9": (3840, 2160), "4:3": (3326, 2494), "1:1": (2880, 2880),
        "3:4": (2494, 3326), "9:16": (2160, 3840), "21:9": (4398, 1886),
    },
}


def _even_floor(n):
    return max(2, int(n // 2) * 2)


def reformat_scale_dims(source_w, source_h, target_w, target_h):
    """Contain-fit `source_w`x`source_h` inside the `target_w`x`target_h`
    bounding box, preserving the source's own aspect ratio exactly (never
    the target preset's) and never upscaling. Snapped to even pixels
    (libx264 yuv420p requires even width/height) — mirrors
    cropMath.js's cropBoxSize, the crop feature's equivalent contain-fit
    math, so the two features round the same way.
    """
    scale = min(1, target_w / source_w, target_h / source_h)
    return _even_floor(source_w * scale), _even_floor(source_h * scale)


def reformat_adaptive_dims(source_w, source_h, resolution):
    """"adaptive" ratio: keep the source's OWN aspect ratio exactly (unlike
    the 6 fixed ratios, which reshape to their own ratio) but size it to
    roughly the same pixel budget as `resolution`'s tier — using that
    tier's 16:9 entry's area as the budget, since every one of the 6 given
    ratios per tier lands within ~4% of that same area (e.g. 1080p's
    16:9/4:3/1:1/3:4/9:16/21:9 areas are all ~2.07-2.09 megapixels), so this
    generalizes the same pattern to an arbitrary source ratio. Never
    upscales — if the source is already smaller than the budget, its own
    resolution is kept as-is.
    """
    target_w, target_h = REFORMAT_PRESETS[resolution]["16:9"]
    target_area = target_w * target_h
    source_area = source_w * source_h
    scale = min(1, math.sqrt(target_area / source_area))
    return _even_floor(source_w * scale), _even_floor(source_h * scale)


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


def keyframe_ladder(keyframes, coord, in_sec):
    """Piecewise-linear ffmpeg expression mapping `t` → keyframes[coord].

    Emits a nested if(lt(t,...),branch,else) ladder. Endpoints HOLD: before
    the first keyframe the value is the first keyframe's, after the last it's
    the last keyframe's — matching cropAnimation.sampleCropOrigin's own
    extrapolation model exactly (the preview and the render must agree).

    `keyframes` must be sorted by t (invariant #1 of the frontend's keyframe
    contract) and indexed relative to the clip's main body; `in_sec` is added
    so the ladder is expressed in the SOURCE frame's own timestamps. Both the
    `crop` and `overlay` filters this feeds run on the RAW input before any
    trim/setpts, so their `t` variable is source time.

    Verified by hand: these ladders parse to at least 64 nesting levels, and
    both filters re-evaluate the expression per frame (overlay defaults to
    eval=frame, so it needs no explicit eval= option).
    """
    kfs = sorted(keyframes, key=lambda k: k["t"])
    expr = f"{kfs[-1][coord]:.4f}"
    for j in range(len(kfs) - 1, 0, -1):
        a = kfs[j - 1]
        b = kfs[j]
        ta = a["t"] + in_sec
        tb = b["t"] + in_sec
        va = a[coord]
        vb = b[coord]
        if tb - ta < 1e-9:
            branch = f"{vb:.4f}"
        else:
            slope = (vb - va) / (tb - ta)
            branch = f"({va:.4f}+({slope:.6f})*(t-{ta:.4f}))"
        expr = f"if(lt(t,{tb:.4f}),{branch},{expr})"
    # Before the very first keyframe → hold at kfs[0].
    first_t = kfs[0]["t"] + in_sec
    return f"if(lt(t,{first_t:.4f}),{kfs[0][coord]:.4f},{expr})"


def build_timeline_filter(clip_specs, target_w, target_h, target_fps,
                           sample_rate=44100, channel_layout="stereo", no_audio=False,
                           audio_bed=None):
    """Build one filter_complex string that renders an entire timeline (a
    sequence of trimmed clips, each optionally extended by a frozen-frame
    hold at its lead and/or trail edge, and optionally played backwards)
    as a single continuous video.

    no_audio=True skips building the audio graph entirely — the returned
    filter string declares only [outv], not [outv][outa]. This is NOT the
    same as a caller adding -an: an -an on the ffmpeg command line disables
    an INPUT stream, and this graph's audio chains reference [i:a] inputs
    directly (atrim/areverse/anullsrc), so -an would break filtergraph
    binding rather than just silence the output (confirmed by hand: -an
    before -i disables that input's audio decoder, and the filtergraph then
    fails with "Cannot decode a disabled input stream" / "Error binding an
    input stream to complex filtergraph input"). The caller must also drop
    -map "[outa]" from its own args when no_audio=True — mapping a label
    this function never declares is also a hard ffmpeg error.

    audio_bed is the A1 audio bed: an ffmpeg INPUT INDEX (an int, not a
    path — the caller owns -i ordering, same contract overlay's input_index
    follows) for a file whose audio is mixed UNDER the whole rendered
    sequence. It owns no timing of its own: it starts where V1's PICTURE
    starts, is padded with silence if shorter than the sequence and cut if
    longer, and is SUMMED with the clips' own audio rather than replacing it.
    The bed is a purely audio-side addition — it cannot change a single video
    frame (hand-verified by framemd5 with and without one).

    "Where V1's picture starts" means the bed is delayed by the first clip's
    head hold (adelay, frame-quantized to lead_frames/fps like the hold's own
    silence). A hold freezes the first frame BEFORE the clip proper begins, so
    a bed starting at 0 would play music over that frozen frame and land out
    of step with the cut; delaying it keeps the bed's downbeat on the first
    real frame, and changing or removing the hold moves the bed with it. The
    delay uses adelay (prepends silence) rather than an asetpts shift, so
    apad/atrim below still measure from 0 and the render ends flush: a 1s hold
    yields 1s of leading silence and 1s less bed heard, never a longer output.

    Bed parameters, each measured rather than assumed:
      * amix normalize=0 is an exact unity-gain sum (verified
        mixed[i] == v1[i] + bed[i] to 7.45e-09 over 485100 samples).
        normalize=1 would instead duck the clips' own dialogue by 6 dB, so
        the bed is attenuated by BED_GAIN on its own branch and the mix
        leaves V1's level alone.
      * duration=first is what makes the bed length-agnostic: it pads a
        short bed AND cuts a long one. With duration=longest a 20s bed on a
        5.5s sequence produced audio,20.010000 vs video,5.500000.
      * apad+atrim on the bed branch are strictly REDUNDANT given
        duration=first (byte-identical PCM either way). They are kept
        because they make the bed's intended length explicit in the graph
        and independently checkable, and because they are the same idiom
        the per-clip audio normalization above already uses.
      * aformat comes BEFORE apad. Resampling after padding shifted the
        tail by 14 samples — a determinism problem, not a correctness one.
      * Do NOT add aresample=async=1 here. It may insert or drop samples,
        which makes a render non-reproducible and breaks hash verification.
      * The bed's target length is the sum of the per-clip expected_sec
        values computed below — the frame-quantized truth the audio branch
        is already padded/cut to — never a wall-clock duration. The two
        drift by up to 0.076s under mixed fps + slow-mo (exactly 0 for
        uniform fps).
    no_audio=True with a bed is a contradiction (there is no [aseq] to mix
    into) and raises ValueError rather than silently dropping one of them.

    clip_specs[i] is a dict: {inSec, outSec, fps, has_audio, lead_hold_sec,
    trail_hold_sec, reversed, video_duration, crop}. lead_hold_sec should only be
    nonzero for clip 0 and trail_hold_sec only for the last clip (callers
    must enforce this — this function does not check clip position). Input
    index i in the filter graph corresponds to the i-th "-i" argument on
    the ffmpeg command line, in the same order as clip_specs.

    video_duration is the video *stream's* duration, which can be shorter
    than the container duration (outSec typically defaults to the container
    duration, driven by the longest stream — often audio). Hold sampling
    must be clamped to it: sampling a one-frame window past the last real
    video frame selects zero frames, and the freeze silently vanishes from
    the video track while its anullsrc audio still gets inserted.

    Per clip: an optional leading freeze (looped) is prepended, the main
    trimmed segment follows, then an optional trailing freeze (looped) is
    appended — these 1-3 pieces are concatenated into one per-clip
    segment, normalized to the common target resolution/fps, and finally
    every clip's normalized segment is concatenated into [outv][outa].

    A hold's silence is what OFFSETS that clip's own audio: the anullsrc
    piece is concatenated ahead of the main audio in the same order the
    freeze is prepended to the video, so a head hold pushes the clip's
    dialogue later by exactly the hold's length and the two tracks stay
    frame-aligned. That means the silence must be quantized to the SAME
    frame grid the freeze is — round(H*fps) frames, i.e. lead_frames/fps
    seconds, not the raw requested lead_hold. The freeze emits a whole
    number of frames by construction (loop=round(H*fps)-1), so with a hold
    that isn't a frame multiple (e.g. 0.5s at 24fps = 12 frames = 0.5s, but
    0.51s = 12 frames = 0.5s) the raw value would make the audio longer
    than the picture it's padding and shift every following clip's audio
    late by the difference. Using lead_frames/fps makes the offset exactly
    the freeze's own duration, and it also makes the per-clip apad/atrim to
    expected_sec (which is computed from lead_frames/trail_frames) a no-op
    rather than a silent truncation of real dialogue.

    When reversed is true, the main segment plays backwards (reverse/
    areverse), and — since after reversal the frame that plays *first* is
    the one originally at outSec, and the frame that plays *last* is the
    one originally at inSec — the lead hold freezes a frame sampled from
    outSec (not inSec) and the trail hold freezes a frame sampled from
    inSec (not outSec), so a hold always freezes on the frame actually
    adjacent to it in the final playback order.

    spec["speed"] (0 < speed <= 1, default 1) slows the main segment by
    stretching PTS — setpts=(1/speed)*PTS — with NO interpolation or
    generated frames; the fps normalization repeats existing frames to
    fill the stretched span. Slowed segments get silent audio (the spec's
    -an equivalent within a concat graph that requires an audio stream).
    Callers must enforce the effective-fps floor (source_fps * speed).

    spec["crop"] (optional dict {w, h, x, y}, source-pixel coordinates) is
    applied to the raw input before trim/reverse/speed/holds, so a lead or
    trail hold (which samples a frame from the same input) is cropped
    identically to the main segment — a crop is a spatial transform of the
    whole source, not something tied to the trim window.

    spec["overlay"] (optional dict {input_index, w, h, x, y, keyframes,
    in_sec, out_sec}) composites a SECOND video on top of this clip — the V2
    animated-overlay feature: a region that was cropped out of this clip,
    processed externally, and is being placed back exactly where it came
    from, following the same animated path. Like crop, it is applied to the
    RAW input before trim/reverse/speed/holds, which is what makes it correct
    for free under every one of those: `t` is source time (the same unit the
    keyframes and the crop ladder already use, so one generator serves both),
    a hold freezes an already-composited frame, and reverse/speed transform
    the composite as a unit. `x`/`y` follow the same keyframe ladder as an
    animated crop when keyframes are present, so the overlay tracks the crop
    box that produced it frame for frame.

    A clip may carry BOTH crop and overlay, and order matters: the overlay is
    composited onto the full frame FIRST, then crop applies to the result.
    (Cropping first would throw away the very pixels the overlay is meant to
    be placed back onto.)

    The overlaid input is time-aligned to this clip's own trim window via
    setpts=PTS-STARTPTS+in_sec/TB — the processed region starts at frame 0 of
    its own file but belongs at in_sec on the source's clock.
    eof_action=pass + repeatlast=0 mean a shorter overlay simply stops
    compositing (the background continues untouched) rather than freezing its
    last frame over the rest of the clip, and never truncates the render to
    the overlay's length. Hand-verified: with an overlay covering source
    t=1..4 of a 5s background, frames outside that window come back
    pixel-clean, the output keeps its full 150-frame length, and the region
    the overlay never touches is BIT-EXACT against the same render without
    it.
    """
    if no_audio and audio_bed is not None:
        raise ValueError("audio_bed cannot be used with no_audio=True: there is no audio graph to mix into")

    chains = []
    norm_v_labels = []
    norm_a_labels = []
    # Per-clip frame-quantized durations; their sum is the bed's exact target
    # length (see the audio_bed notes in the docstring).
    expected_secs = []
    # How far into the sequence the first clip's VIDEO actually starts — i.e.
    # its head hold, frame-quantized. The bed is delayed by exactly this so it
    # starts on the first real frame rather than on the frozen one. Set in the
    # loop below from clip 0 (the only clip a head hold may live on).
    bed_offset_sec = 0.0
    for i, spec in enumerate(clip_specs):
        in_sec = spec["inSec"]
        out_sec = spec["outSec"]
        fps = spec["fps"] or 30.0
        has_audio = spec["has_audio"]
        lead_hold = spec.get("lead_hold_sec") or 0
        trail_hold = spec.get("trail_hold_sec") or 0
        is_reversed = spec.get("reversed") or False
        speed = spec.get("speed") or 1.0
        video_dur = spec.get("video_duration") or out_sec
        crop = spec.get("crop")

        v_pieces = []
        a_pieces = []

        # Raw video for this clip, before any spatial pre-filter.
        v_src = f"[{i}:v]"

        # Composite the V2 overlay onto the FULL frame first — a crop (if any)
        # must apply to the already-composited picture, since cropping first
        # would discard the pixels the overlay is being placed back onto.
        overlay = spec.get("overlay")
        if overlay:
            ov_idx = overlay["input_index"]
            ov_kfs = overlay.get("keyframes") or []
            # The overlay file's OWN trim window (its clip on V2 is editable
            # like any other), then re-based to 0 and shifted to in_sec: the
            # processed region starts at frame 0 of its file but belongs at
            # in_sec on the background's source clock. Trimming before the
            # shift also stops a longer processed file painting past the body.
            ov_in = overlay.get("in_sec") or 0
            ov_out = overlay.get("out_sec")
            trim_step = f"trim=start={ov_in}:end={ov_out}" if ov_out else f"trim=start={ov_in}"
            chains.append(
                f"[{ov_idx}:v]{trim_step},setpts=PTS-STARTPTS+{in_sec}/TB[ovin{i}]"
            )
            if len(ov_kfs) >= 1:
                ox = f"'{keyframe_ladder(ov_kfs, 'x', in_sec)}'"
                oy = f"'{keyframe_ladder(ov_kfs, 'y', in_sec)}'"
            else:
                ox = f"{overlay['x']}"
                oy = f"{overlay['y']}"
            # eof_action=pass + repeatlast=0: a shorter overlay stops
            # compositing and leaves the rest of the background untouched,
            # instead of freezing its last frame over it or truncating the
            # render. shortest is left at its default (0) for the same reason.
            chains.append(
                f"{v_src}[ovin{i}]overlay=x={ox}:y={oy}:eof_action=pass:repeatlast=0[vov{i}]"
            )
            v_src = f"[vov{i}]"

        if crop:
            keyframes = spec.get("crop_keyframes") or []
            if len(keyframes) >= 1:
                # Animated pan: crop.w/crop.h stay static, crop.x/crop.y
                # follow a piecewise-linear interpolation over `t` (the
                # frame's presentation timestamp in seconds, in the source
                # clip's OWN time — the `crop` filter runs before any
                # trim/setpts, so t == source seconds here, and the
                # frontend already emits keyframes indexed by source
                # seconds relative to inSec via clip main-body time).
                # keyframe_ladder adds in_sec itself and holds at both
                # endpoints, matching sampleCropOrigin's extrapolation.
                x_expr = keyframe_ladder(keyframes, "x", in_sec)
                y_expr = keyframe_ladder(keyframes, "y", in_sec)
                chains.append(
                    f"{v_src}crop={crop['w']}:{crop['h']}:x='{x_expr}':y='{y_expr}'[vsrc{i}]"
                )
            else:
                chains.append(f"{v_src}crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']}[vsrc{i}]")
            v_src = f"[vsrc{i}]"

        # Snap hold sampling to the frame grid, clamped to the last frame
        # that actually exists in the video stream. out_sec routinely lands
        # past that frame (its default is the container duration, which the
        # audio stream can extend beyond the video), and a raw one-frame
        # window at out_sec would then select nothing — dropping the freeze
        # from the video while its silence still lands in the audio,
        # desyncing the whole clip.
        eps = 1e-6
        last_frame = max(int(round(video_dur * fps)) - 1, 0)
        first_idx = int(math.floor(in_sec * fps + eps))       # frame shown at in_sec
        last_idx = int(math.ceil(out_sec * fps - eps)) - 1    # last frame before out_sec

        def frame_window(idx):
            idx = min(max(idx, 0), last_frame)
            return idx / fps, (idx + 1) / fps

        # A hold freezes the frame adjacent to it in final playback order:
        # reversal flips which end of the trim window plays first/last.
        lead_sample_start, lead_sample_end = frame_window(last_idx if is_reversed else first_idx)
        trail_sample_start, trail_sample_end = frame_window(first_idx if is_reversed else last_idx)

        # Exact frame budget for this clip's normalized segment. trim selects
        # source frames with pts in [in_sec, out_sec), holds contribute
        # round(H*fps) frames each by construction. The fps normalization
        # filter can emit one spurious duplicate frame at EOF (the concat
        # graph runs in a 1/1000000 timebase, and an end timestamp landing
        # exactly on a frame tick rounds into an extra output frame), so the
        # per-clip chain is hard-capped at this count — and the audio is
        # padded/cut to the same length — or every clip boundary drifts
        # another 1/fps out of sync.
        lead_frames = int(round(lead_hold * fps)) if lead_hold > 0 else 0
        trail_frames = int(round(trail_hold * fps)) if trail_hold > 0 else 0
        first_sel = max(int(math.ceil(in_sec * fps - eps)), 0)
        last_sel_excl = min(int(math.ceil(out_sec * fps - eps)), last_frame + 1)
        n_main = max(last_sel_excl - first_sel, 1)
        # A slow-down stretches only the main segment's timing (holds are
        # already absolute durations); the constant-fps normalization then
        # fills the stretched span by repeating source frames.
        expected_sec = (lead_frames + trail_frames) / fps + (n_main / fps) / speed
        n_norm_frames = max(int(round(expected_sec * target_fps)), 1)
        expected_secs.append(expected_sec)
        if i == 0:
            bed_offset_sec = lead_frames / fps

        # v_src feeds up to three consumers (lead hold, main body, trail
        # hold). ffmpeg auto-splits a raw INPUT pad like [0:v] across multiple
        # consumers, but a FILTER-PRODUCED label (crop's [vsrcN], overlay's
        # [vovN]) must be split explicitly — consuming one twice is an error.
        # Without this, crop-or-overlay + any hold fails to render at all:
        # only the first consumer gets the filtered picture and the rest bind
        # to the unfiltered source, so concat then rejects the mismatched
        # sizes ("Input link parameters (1920x1080) do not match ... (512x512)",
        # exit 234) — or, when the sizes happen to agree (an overlay doesn't
        # change frame size), it silently renders the body WITHOUT the
        # composite instead of failing. Verified by hand both ways.
        n_consumers = 1 + (1 if lead_hold > 0 else 0) + (1 if trail_hold > 0 else 0)
        if n_consumers > 1 and not v_src.startswith(f"[{i}:v"):
            split_labels = [f"[vsp{i}_{k}]" for k in range(n_consumers)]
            chains.append(f"{v_src}split={n_consumers}{''.join(split_labels)}")
            lead_src = split_labels[0] if lead_hold > 0 else None
            main_src = split_labels[1 if lead_hold > 0 else 0]
            trail_src = split_labels[-1] if trail_hold > 0 else None
        else:
            lead_src = main_src = trail_src = v_src

        if lead_hold > 0:
            n_loops = max(round(lead_hold * fps) - 1, 0)
            chains.append(
                f"{lead_src}trim=start={lead_sample_start}:end={lead_sample_end},setpts=PTS-STARTPTS,"
                f"loop=loop={n_loops}:size=1:start=0,setpts=PTS-STARTPTS[vlead{i}]"
            )
            v_pieces.append(f"[vlead{i}]")
            if not no_audio:
                chains.append(
                    f"anullsrc=channel_layout={channel_layout}:sample_rate={sample_rate}:"
                    f"duration={lead_frames / fps}[alead{i}]"
                )
                a_pieces.append(f"[alead{i}]")

        v_reverse_step = ",reverse" if is_reversed else ""
        a_reverse_step = ",areverse" if is_reversed else ""
        # Slow-down = pure PTS stretch (setpts=(1/speed)*PTS): no frame
        # interpolation or generated frames — existing frames just display
        # longer, and the fps normalization below repeats them to fill the
        # constant output rate.
        v_speed_step = f",setpts={1.0 / speed}*PTS" if speed != 1.0 else ""
        chains.append(f"{main_src}trim=start={in_sec}:end={out_sec},setpts=PTS-STARTPTS{v_reverse_step}{v_speed_step}[vmain{i}]")
        v_pieces.append(f"[vmain{i}]")
        if not no_audio:
            if speed != 1.0:
                # Stretched video has no natural audio (playing it slowed
                # would shift pitch/tempo — out of scope for a lossless time
                # stretch), so the main segment gets silence of the
                # stretched duration, same as hold segments do.
                chains.append(
                    f"anullsrc=channel_layout={channel_layout}:sample_rate={sample_rate}:"
                    f"duration={(out_sec - in_sec) / speed}[amain{i}]"
                )
            elif has_audio:
                chains.append(f"[{i}:a]atrim=start={in_sec}:end={out_sec},asetpts=PTS-STARTPTS{a_reverse_step}[amain{i}]")
            else:
                chains.append(
                    f"anullsrc=channel_layout={channel_layout}:sample_rate={sample_rate}:"
                    f"duration={out_sec - in_sec}[amain{i}]"
                )
            a_pieces.append(f"[amain{i}]")

        if trail_hold > 0:
            n_loops = max(round(trail_hold * fps) - 1, 0)
            chains.append(
                f"{trail_src}trim=start={trail_sample_start}:end={trail_sample_end},setpts=PTS-STARTPTS,"
                f"loop=loop={n_loops}:size=1:start=0,setpts=PTS-STARTPTS[vtrail{i}]"
            )
            v_pieces.append(f"[vtrail{i}]")
            if not no_audio:
                chains.append(
                    f"anullsrc=channel_layout={channel_layout}:sample_rate={sample_rate}:"
                    f"duration={trail_frames / fps}[atrail{i}]"
                )
                a_pieces.append(f"[atrail{i}]")

        if len(v_pieces) > 1:
            chains.append(f"{''.join(v_pieces)}concat=n={len(v_pieces)}:v=1:a=0[vseg{i}]")
            v_seg_label = f"[vseg{i}]"
        else:
            v_seg_label = v_pieces[0]

        chains.append(
            f"{v_seg_label}scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
            f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={target_fps},"
            f"trim=start_frame=0:end_frame={n_norm_frames},setpts=PTS-STARTPTS[vnorm{i}]"
        )
        norm_v_labels.append(f"[vnorm{i}]")

        if not no_audio:
            if len(a_pieces) > 1:
                chains.append(f"{''.join(a_pieces)}concat=n={len(a_pieces)}:v=0:a=1[aseg{i}]")
                a_seg_label = f"[aseg{i}]"
            else:
                a_seg_label = a_pieces[0]
            chains.append(
                f"{a_seg_label}aformat=sample_rates={sample_rate}:channel_layouts={channel_layout},"
                f"apad=whole_dur={expected_sec},atrim=end={expected_sec},asetpts=PTS-STARTPTS[anorm{i}]"
            )
            norm_a_labels.append(f"[anorm{i}]")

    if no_audio:
        chains.append(f"{''.join(norm_v_labels)}concat=n={len(clip_specs)}:v=1:a=0[outv]")
    else:
        interleaved = "".join(f"{v}{a}" for v, a in zip(norm_v_labels, norm_a_labels))
        if audio_bed is None:
            chains.append(f"{interleaved}concat=n={len(clip_specs)}:v=1:a=1[outv][outa]")
        else:
            # The clips' own concatenated audio becomes an intermediate
            # ([aseq]) so the bed can be summed into it; [outa] is still the
            # label the caller maps, so nothing downstream changes.
            total_sec = sum(expected_secs)
            chains.append(f"{interleaved}concat=n={len(clip_specs)}:v=1:a=1[outv][aseq]")
            # The bed starts where V1's PICTURE starts: adelay by the first
            # clip's head hold so a hold pushes the bed forward with the video
            # instead of playing over the frozen frame. adelay prepends silence
            # rather than shifting PTS, so the padded length below is measured
            # from 0 and the bed still ends flush with the sequence — a 1s hold
            # means 1s of leading silence and 1s less bed heard, never a render
            # that runs 1s long.
            bed_src = f"[{audio_bed}:a]"
            if bed_offset_sec > 0:
                delay_ms = round(bed_offset_sec * 1000)
                # all=1 delays every channel by the one value (without it
                # adelay only shifts the channels it was given delays for, so a
                # stereo bed would come out with one channel early).
                chains.append(f"{bed_src}adelay=delays={delay_ms}:all=1[abdel]")
                bed_src = "[abdel]"
            chains.append(
                f"{bed_src}aformat=sample_rates={sample_rate}:channel_layouts={channel_layout},"
                f"apad=whole_dur={total_sec},atrim=end={total_sec},asetpts=PTS-STARTPTS,"
                f"volume={BED_GAIN}[abed]"
            )
            chains.append(
                "[aseq][abed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[outa]"
            )
    return ";".join(chains)


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
