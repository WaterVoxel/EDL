import json
import math
import os
import shlex
import subprocess

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
INPUT_DIR = os.path.join(PROJECT_ROOT, "input")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
# Constant, checked-in media the app itself owns (as opposed to user sources in
# input/, which the Media Bin's Clear button wipes). Nothing here is uploadable,
# listable, or deletable through any route — assets are referenced by the code
# that needs them, never by name from the client.
ASSETS_DIR = os.path.join(PROJECT_ROOT, "frontend", "assets")
# Room tone used to fill the silent gaps a hold/round/slow-down would otherwise
# leave in the audio track (see build_timeline_filter's fill_noise). It is only
# ~3 s long, so every use aloops it and atrims to the exact gap length.
NOISE_ASSET = os.path.join(ASSETS_DIR, "Audio_NOISE.wav")
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

EXPORT_QUALITIES = ("lossless", "match", "high", "under50mb", "under50mb_hevc", "custom")

# The modes that CANNOT be expressed as one encode_args() list because they
# need two full ffmpeg passes plus a measure-and-retry loop. Every route that
# renders checks membership here before falling through to the single-pass
# encode_args() + run_ffmpeg() path (see app.multipass_export_render).
MULTIPASS_QUALITIES = ("under50mb", "under50mb_hevc", "custom")

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


# ---------- the "custom" mode's settings vocabulary ----------
#
# Every other entry in EXPORT_QUALITIES is a fixed, hand-tuned recipe. "custom"
# is the one whose flags come from data: a settings dict edited in the FFmpeg
# Custom Settings window (gear icon), persisted in .export_settings.json and in
# the .nara project, and validated by normalize_export_settings() below before
# it ever reaches an ffmpeg argv. It is otherwise the same shape of mode as
# under50mb*: two-pass ABR under a hard byte cap, enforced by measurement.

# Software encoders only. This is a macOS/Apple Silicon target, so there is no
# NVENC to offer; VideoToolbox's hardware h264/hevc encoders are excluded for a
# stronger reason — they have no two-pass mode at all, which is precisely what
# a size-capped export needs.
EXPORT_CODECS = ("libx265", "libx264")

EXPORT_PRESETS = ("ultrafast", "superfast", "veryfast", "faster", "fast",
                  "medium", "slow", "slower", "veryslow")

# These profile lists are ours, not ffmpeg's: both encoders take a free-form
# string (verified — `ffmpeg -h encoder=libx265` documents -profile only as
# "set the x265 profile", with no enum to read back), so an invalid value is
# only caught when the encoder aborts mid-render. "auto" means omit -profile:v
# entirely and let the encoder derive it from the pixel format, which is the
# right answer for 8-bit libx265 (there is no "main8").
EXPORT_PROFILES = {
    "libx265": ("auto", "main", "main10", "main12"),
    "libx264": ("auto", "baseline", "main", "high", "high10"),
}

# p010le is offered because it is the 10-bit format Apple's own pipelines use,
# but neither software encoder actually accepts it: verified by hand that
# `ffmpeg -h encoder=libx265` lists yuv420p10le and NOT p010le. Asking for it
# still works — ffmpeg auto-inserts a conversion and the stream comes out
# yuv420p10le ("Video: hevc ..., yuv420p10le(tv, progressive)", confirmed) — so
# here it is an alias for yuv420p10le that costs one extra scale step. Kept as
# an option only because it's the name users bring with them from Apple tools.
EXPORT_PIX_FMTS = ("p010le", "yuv420p10le", "yuv420p")

TEN_BIT_PIX_FMTS = ("p010le", "yuv420p10le")
TEN_BIT_PROFILES = ("main10", "main12", "high10")

# Defaults are the user-specified ones for this mode: HEVC 10-bit, two-pass,
# preset slow, 0.90 safety headroom, maxrate 0.95x / bufsize 1.5x the computed
# bitrate. target_mib matches the legacy under50mb cap so switching between
# them is a codec/quality change, not a size change.
DEFAULT_EXPORT_SETTINGS = {
    "target_mib": 50.0,
    "safety": 0.90,
    "codec": "libx265",
    "preset": "slow",
    "profile": "main10",
    "pix_fmt": "yuv420p10le",
    "maxrate_mult": 0.95,
    "bufsize_mult": 1.5,
    "extra_args": "",
}

# Bounds for the numeric fields. Generous — these exist to reject nonsense
# (a 0 MiB cap, a negative multiplier) that would otherwise surface as a
# baffling ffmpeg error or an unkillable retry loop, not to express taste.
_EXPORT_SETTING_BOUNDS = {
    "target_mib": (0.1, 1_048_576.0),   # 100 KiB .. 1 TiB
    "safety": (0.1, 1.0),
    "maxrate_mult": (0.1, 10.0),
    "bufsize_mult": (0.1, 20.0),
}

# Flags the Advanced extra args field must not contain, with the reason shown
# to the user. Two kinds: flags this mode's own machinery owns (a second -b:v
# would silently win over the computed one, and ffmpeg takes the LAST
# occurrence, so a duplicate is a settings field that quietly stops working),
# and flags that would break the render outright (-vf/-filter_complex replace
# the timeline's whole filter graph — see _inject_pixel_format's docstring for
# why a duplicate is destructive rather than additive).
_EXTRA_ARG_CONFLICTS = {
    "-i": "inputs come from the timeline",
    "-pass": "owned by the two-pass machinery",
    "-passlogfile": "owned by the two-pass machinery",
    "-x265-params": "carries this mode's pass/stats settings",
    "-x264-params": "conflicts with -pass/-passlogfile",
    "-x264opts": "conflicts with -pass/-passlogfile",
    "-vf": "would replace the timeline's filter graph",
    "-filter": "would replace the timeline's filter graph",
    "-filter:v": "would replace the timeline's filter graph",
    "-filter:a": "would replace the timeline's filter graph",
    "-filter_complex": "would replace the timeline's filter graph",
    "-af": "would replace the timeline's audio filters",
    "-f": "the output format follows the file extension",
    "-c:v": 'use the "Codec" setting',
    "-vcodec": 'use the "Codec" setting',
    "-b:v": "computed from the target size",
    "-maxrate": 'use the "maxrate x" setting',
    "-bufsize": 'use the "bufsize x" setting',
    "-preset": 'use the "Preset" setting',
    "-profile:v": 'use the "Profile" setting',
    "-pix_fmt": 'use the "Pixel format" setting',
    "-y": "already passed by run_ffmpeg",
    "-n": "would make every render prompt and hang",
}


def _coerce_float(raw, key):
    """Float within _EXPORT_SETTING_BOUNDS[key], or (None, reason)."""
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None, f"{key} must be a number"
    if value != value or value in (float("inf"), float("-inf")):
        return None, f"{key} must be a finite number"
    low, high = _EXPORT_SETTING_BOUNDS[key]
    if not (low <= value <= high):
        return None, f"{key} must be between {low} and {high}"
    return value, None


def normalize_export_settings(raw):
    """Validate one "custom" settings dict. Returns (settings, error): on any
    problem error is a message fit to show the user and settings is None,
    otherwise settings is a COMPLETE dict (every DEFAULT_EXPORT_SETTINGS key
    present) so no consumer needs .get() fallbacks.

    Missing keys default rather than erroring, so a settings file written by an
    older version of this window still loads. Unknown keys are dropped, not
    rejected — the dict is round-tripped through the client and a .nara file,
    and refusing to load a project because it carries an extra key would be a
    worse failure than ignoring it.

    Beyond per-field validation this enforces the one CROSS-field rule that
    ffmpeg would otherwise only reveal mid-encode: bit depth has to agree
    between profile and pixel format. libx265 given -profile:v main10 with
    yuv420p input errors out with "profile main10 not compatible with input
    depth"; the inverse (10-bit pixels under an 8-bit profile) silently loses
    the extra two bits at best.
    """
    if not isinstance(raw, dict):
        return None, "export settings must be an object"

    settings = dict(DEFAULT_EXPORT_SETTINGS)
    for key in ("target_mib", "safety", "maxrate_mult", "bufsize_mult"):
        if key in raw:
            value, error = _coerce_float(raw[key], key)
            if error:
                return None, error
            settings[key] = value

    codec = raw.get("codec", settings["codec"])
    if codec not in EXPORT_CODECS:
        return None, f"codec must be one of {', '.join(EXPORT_CODECS)}"
    settings["codec"] = codec

    preset = raw.get("preset", settings["preset"])
    if preset not in EXPORT_PRESETS:
        return None, f"preset must be one of {', '.join(EXPORT_PRESETS)}"
    settings["preset"] = preset

    # Defaulted per codec, not globally: main10 is libx265's name and is
    # meaningless to libx264, so a settings dict that only switches codec
    # would otherwise carry an invalid profile across.
    allowed_profiles = EXPORT_PROFILES[codec]
    profile = raw.get("profile", DEFAULT_EXPORT_SETTINGS["profile"])
    if profile not in allowed_profiles:
        return None, f"profile for {codec} must be one of {', '.join(allowed_profiles)}"
    settings["profile"] = profile

    pix_fmt = raw.get("pix_fmt", settings["pix_fmt"])
    if pix_fmt not in EXPORT_PIX_FMTS:
        return None, f"pix_fmt must be one of {', '.join(EXPORT_PIX_FMTS)}"
    settings["pix_fmt"] = pix_fmt

    ten_bit_pix = pix_fmt in TEN_BIT_PIX_FMTS
    ten_bit_profile = profile in TEN_BIT_PROFILES
    if ten_bit_profile and not ten_bit_pix:
        return None, f"profile {profile} needs a 10-bit pixel format ({', '.join(TEN_BIT_PIX_FMTS)})"
    if ten_bit_pix and profile != "auto" and not ten_bit_profile:
        return None, f"pixel format {pix_fmt} is 10-bit, so profile {profile} would truncate it"

    extra_args = raw.get("extra_args", "")
    if not isinstance(extra_args, str):
        return None, "extra_args must be a string"
    ok, reason, _ = validate_extra_encode_args(extra_args)
    if not ok:
        return None, f"extra args: {reason}"
    settings["extra_args"] = extra_args.strip()

    return settings, None


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
      "custom" — the same kind of two-pass size-capped mode as those two, but
        with every flag (cap, codec, preset, profile, pixel format, maxrate/
        bufsize multipliers, extra args) supplied by the FFmpeg Custom Settings
        window instead of hardcoded here. Also not produced by this function —
        see render_custom_two_pass().

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


def custom_target_bitrate_kbps(duration_s, target_bytes, safety):
    """Video bitrate in kbps for the "custom" mode, as specified:

        (target_bytes * 8 * safety) / duration_s / 1000

    Note what this deliberately does NOT do, in contrast to
    target_bitrate_for_size() above: it hands the WHOLE byte budget to video
    and reserves nothing for audio. The AAC track is muxed on top of it, so
    the real file is larger than this bitrate alone implies — which is exactly
    what the safety headroom (default 0.90) is there to absorb, and why the
    measure-and-retry loop in render_custom_two_pass() is what actually
    enforces the cap. The consequence worth knowing: on a long render with a
    high-bitrate source audio track, audio can eat a big enough share of the
    budget that the first attempt overshoots and a retry is needed (each retry
    re-encodes both passes, so it costs real time). Lower the safety headroom
    for those, rather than expecting the formula to account for audio.

    Floored at MIN_VIDEO_BITRATE so a wildly undersized cap produces a bad
    render rather than a zero-bitrate ffmpeg error.
    """
    duration_s = max(duration_s, 0.1)
    kbps = (target_bytes * 8 * safety) / duration_s / 1000
    return max(int(kbps), MIN_VIDEO_BITRATE // 1000)


def render_custom_two_pass(input_args, filter_args, source_info, out_path, duration_s,
                            settings=None, timeout=1800, max_attempts=4):
    """Two-pass ABR render driven by the FFmpeg Custom Settings window's
    `settings` dict instead of by hardcoded flags — the "custom" quality mode.

    Same contract as render_size_capped(): returns None on success (the file at
    out_path is the result), raises RuntimeError carrying the responsible
    ffmpeg's stderr on failure, including when every retry still overshoots the
    cap. Raises ValueError if `settings` doesn't validate (only reachable via a
    hand-edited .export_settings.json — the routes validate on save).

    This deliberately MIRRORS render_size_capped rather than generalizing it.
    The two differ in every substantive decision — legacy reserves audio bits
    inside the budget, hardcodes preset/maxrate/bufsize per codec, and injects
    a 10-bit pixel format only for HEVC — so folding them together would mean a
    single function whose behavior is switched by a flag at every step, and any
    edit to the shared body would put the two hand-verified, frame-hash-checked
    under50mb* modes at risk. The duplicated part is small (the -pass flags) and
    the codec-specific facts behind it are documented once, in
    render_size_capped's docstring: libx265 has no -pass/-passlogfile and uses
    -x265-params "pass=N:stats=<file>", but does honor top-level
    -maxrate/-bufsize.

    Platform notes, all deliberate for this macOS/Apple Silicon target:
      - Software libx265/libx264 only (see EXPORT_CODECS) — no NVENC exists
        here, and VideoToolbox has no two-pass mode.
      - The pass-1 sink is os.devnull, i.e. /dev/null (never NUL).
      - No zscale/colorspace conversion is inserted. Sources are already
        Rec.709 YUV, so a colorspace filter would be a no-op at best and a
        wrong-primaries conversion at worst; the only pixel work done here is
        the bit-depth/chroma format the user asked for.
      - HEVC output is not browser-safe (hevc is absent from
        BROWSER_SAFE_VIDEO_CODECS), so the Export Bin's <video> plays it
        through the existing /preview transcode path. This mode is for
        delivery, not for previewing.

    The chosen pixel format is spliced into the existing filter chain via
    _inject_pixel_format for BOTH codecs (legacy does it for HEVC only), since
    here it's a user-visible setting that has to be honored even when it matches
    the source's own format.
    """
    settings, error = normalize_export_settings(settings or {})
    if error:
        raise ValueError(error)

    ok, reason, extra_args = validate_extra_encode_args(settings["extra_args"])
    if not ok:
        raise ValueError(f"extra args: {reason}")

    codec = settings["codec"]
    # _PASSLOG_SUFFIXES is keyed by the stream codec name, not the encoder's.
    passlog_key = "hevc" if codec == "libx265" else "h264"
    target_bytes = int(settings["target_mib"] * 1024 * 1024)

    filter_args = _inject_pixel_format(filter_args, settings["pix_fmt"])
    stats_prefix = out_path + ".ffpass"
    last_stderr = ""
    try:
        for attempt in range(max_attempts):
            shrink = 0.85 ** attempt  # shrink the budget 15% per retry
            kbps = custom_target_bitrate_kbps(
                duration_s, int(target_bytes * shrink), settings["safety"])

            common_video = ["-c:v", codec, "-b:v", f"{kbps}k",
                            "-maxrate", f"{int(kbps * settings['maxrate_mult'])}k",
                            "-bufsize", f"{int(kbps * settings['bufsize_mult'])}k",
                            "-preset", settings["preset"]]
            if settings["profile"] != "auto":
                common_video += ["-profile:v", settings["profile"]]
            common_video += extra_args

            if codec == "libx265":
                pass_args = [
                    ["-x265-params", f"pass=1:stats={stats_prefix}"],
                    ["-x265-params", f"pass=2:stats={stats_prefix}"],
                ]
            else:
                pass_args = [
                    ["-pass", "1", "-passlogfile", stats_prefix],
                    ["-pass", "2", "-passlogfile", stats_prefix],
                ]

            if source_info.get("has_audio"):
                # Source-quality AAC floored at the same 96 kbps the other
                # size-capped mode uses. These bits are NOT deducted from the
                # video budget — see custom_target_bitrate_kbps.
                audio_rate = max(source_info.get("audio_bit_rate") or 0,
                                 UNDER_50MB_MIN_AUDIO_BITRATE)
                audio_out = ["-c:a", "aac", "-b:a", str(audio_rate),
                             "-ar", str(source_info.get("audio_sample_rate") or 44100),
                             "-ac", str(source_info.get("audio_channels") or 2)]
            else:
                audio_out = ["-an"]

            # Extra args ride along in pass 1 too, so the complexity map is
            # gathered under the same encoder settings that spend it. Verified
            # by hand that output-only flags (-movflags, -tag:v) are simply
            # ignored by the null muxer rather than erroring, so this is safe
            # for the whole documented range of the field.
            pass1 = (input_args + filter_args + common_video + pass_args[0] +
                     ["-an", "-f", "null", os.devnull])
            pass2 = (input_args + filter_args + common_video + audio_out +
                     pass_args[1] + [out_path])

            for args in (pass1, pass2):
                result = run_ffmpeg(args, timeout=timeout)
                if result.returncode != 0:
                    raise RuntimeError(result.stderr[-4000:])

            actual_size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
            if actual_size <= target_bytes:
                return None
            last_stderr = (
                f"encode succeeded but output was {actual_size} bytes "
                f"(over the {target_bytes} byte cap) after {attempt + 1} attempt(s)"
            )
        raise RuntimeError(last_stderr)
    finally:
        for suffix in _PASSLOG_SUFFIXES[passlog_key]:
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


def clip_timing(spec):
    """Frame-quantized timing for one clip: (lead_frames, trail_frames, expected_sec).

    THE source of truth for how long a clip occupies the rendered sequence —
    build_timeline_filter uses it to size every per-clip cap (and, summed, the
    A1 bed), and build_a1_filter uses it to make an A1-only render land on
    exactly the same length. Keep it that way: two independent copies of this
    arithmetic would let a V1 render and its A1 stem drift apart.

    trim selects the source frames with pts in [in_sec, out_sec) and each hold
    contributes round(H*fps) frames by construction, so the whole budget is
    counted in FRAMES first and converted to seconds once — a hold's requested
    duration is never used raw (see the hold-quantization gotcha). out_sec is
    clamped to the video stream's own last frame for the reason the docstring of
    build_timeline_filter gives: a window past that frame selects nothing.
    A slow-down stretches only the main segment; holds are absolute durations.
    """
    fps = spec["fps"] or 30.0
    in_sec = spec["inSec"]
    out_sec = spec["outSec"]
    speed = spec.get("speed") or 1.0
    lead_hold = spec.get("lead_hold_sec") or 0
    trail_hold = spec.get("trail_hold_sec") or 0
    video_dur = spec.get("video_duration") or out_sec

    eps = 1e-6
    last_frame = max(int(round(video_dur * fps)) - 1, 0)
    lead_frames = int(round(lead_hold * fps)) if lead_hold > 0 else 0
    trail_frames = int(round(trail_hold * fps)) if trail_hold > 0 else 0
    first_sel = max(int(math.ceil(in_sec * fps - eps)), 0)
    last_sel_excl = min(int(math.ceil(out_sec * fps - eps)), last_frame + 1)
    n_main = max(last_sel_excl - first_sel, 1)
    expected_sec = (lead_frames + trail_frames) / fps + (n_main / fps) / speed
    return lead_frames, trail_frames, expected_sec


def build_a1_filter(clip_specs, sample_rate=44100, channel_layout="stereo",
                    audio_bed=None, fill_noise=None):
    """Build a filter_complex that renders the A1 track ALONE as [outa].

    This is the audio-only counterpart to build_timeline_filter: same A1
    content, same timing, no video and none of the clips' own audio. Its output
    is sample-for-sample the A1 contribution to the equivalent V1 render, and
    exactly as long, so the .wav drops into another tool already in sync with
    the V1 file.

    That equivalence is why this function reuses the pieces rather than
    reimplementing them: clip_timing for the length (bed offset = clip 0's
    lead_frames/fps, total = the sum of every clip's expected_sec, the same
    frame-quantized truth the V1 graph pads its bed to) and the same adelay →
    aformat → apad/atrim → volume=BED_GAIN bed chain, node for node.

    clip_specs only needs the timing keys (inSec, outSec, fps, speed,
    lead_hold_sec, trail_hold_sec, video_duration) — crop, overlay, reverse and
    has_audio cannot change a length, so they are ignored here. NO clip input is
    referenced by the returned graph at all: the only inputs are the bed and the
    noise asset, which is what makes an A1 render cheap (no video decode).

    audio_bed / fill_noise are input indices, as in build_timeline_filter, and
    obey the same noise rule: room tone fills a HOLD gap only, and never where
    the bed can be heard — so with a bed the head hold is room tone and the rest
    of the track is bed, and with no bed at all the head and trail holds are
    room tone over silence. At least one of the two must be given; with neither
    there is no A1 track to render and the caller gets a ValueError rather than
    a silent file.
    """
    if audio_bed is None and fill_noise is None:
        raise ValueError("build_a1_filter needs an audio_bed, a fill_noise, or both")
    if not clip_specs:
        raise ValueError("build_a1_filter needs at least one clip to take its timing from")

    timings = [clip_timing(spec) for spec in clip_specs]
    fps0 = clip_specs[0]["fps"] or 30.0
    head_sec = timings[0][0] / fps0
    total_sec = sum(t[2] for t in timings)
    # The trail hold lives on the LAST clip (the caller contract the V1 graph
    # relies on too), and its gap is the last trail_frames/fps of the sequence.
    fps_last = clip_specs[-1]["fps"] or 30.0
    tail_sec = timings[-1][1] / fps_last

    chains = []

    def noise_piece(duration, label):
        """Room tone cut to `duration` — the same chain build_timeline_filter emits."""
        return (f"[{fill_noise}:a]aloop=loop=-1:size=2147483647,"
                f"atrim=end={duration},asetpts=PTS-STARTPTS,"
                f"aformat=sample_rates={sample_rate}:channel_layouts={channel_layout}{label}")

    def silence_piece(duration, label):
        return (f"anullsrc=channel_layout={channel_layout}:sample_rate={sample_rate}:"
                f"duration={duration}{label}")

    # The gap layer: room tone where a hold is eligible for it, silence
    # everywhere else, assembled head → middle → tail so the pieces total
    # exactly total_sec. With a bed, only the head is eligible (the bed covers
    # the tail — see build_timeline_filter's noise_gaps), so the tail piece is
    # silence and the layer is just "room tone, then silence".
    head_noise = fill_noise is not None and head_sec > 0
    tail_noise = fill_noise is not None and audio_bed is None and tail_sec > 0
    pieces = []
    if head_sec > 0:
        chains.append((noise_piece if head_noise else silence_piece)(head_sec, "[a1head]"))
        pieces.append("[a1head]")
    middle_sec = total_sec - head_sec - (tail_sec if tail_noise else 0)
    if middle_sec > 1e-9:
        chains.append(silence_piece(middle_sec, "[a1mid]"))
        pieces.append("[a1mid]")
    if tail_noise:
        chains.append(noise_piece(tail_sec, "[a1tail]"))
        pieces.append("[a1tail]")

    if len(pieces) > 1:
        chains.append(f"{''.join(pieces)}concat=n={len(pieces)}:v=0:a=1[a1gaps]")
        gaps_label = "[a1gaps]"
    else:
        gaps_label = pieces[0]

    if audio_bed is None:
        # Room tone alone: pad/trim so the length is the sequence's, exactly as
        # the bed branch below would.
        chains.append(
            f"{gaps_label}aformat=sample_rates={sample_rate}:channel_layouts={channel_layout},"
            f"apad=whole_dur={total_sec},atrim=end={total_sec},asetpts=PTS-STARTPTS[outa]"
        )
        return ";".join(chains)

    # The bed branch, node for node as build_timeline_filter builds it — same
    # adelay (prepends silence, so the pad below still measures from 0), same
    # frame-quantized offset, same BED_GAIN — so this render and the V1 one
    # carry bit-identical bed samples.
    bed_src = f"[{audio_bed}:a]"
    if head_sec > 0:
        delay_ms = round(head_sec * 1000)
        chains.append(f"{bed_src}adelay=delays={delay_ms}:all=1[a1bdel]")
        bed_src = "[a1bdel]"
    chains.append(
        f"{bed_src}aformat=sample_rates={sample_rate}:channel_layouts={channel_layout},"
        f"apad=whole_dur={total_sec},atrim=end={total_sec},asetpts=PTS-STARTPTS,"
        f"volume={BED_GAIN}[a1bed]"
    )
    # duration=first keeps the gap layer (already exactly total_sec) in charge of
    # the length, and normalize=0 makes the sum unity-gain — the same two
    # settings the V1 mix uses.
    chains.append(f"{gaps_label}[a1bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[outa]")
    return ";".join(chains)


def build_timeline_filter(clip_specs, target_w, target_h, target_fps,
                           sample_rate=44100, channel_layout="stereo", no_audio=False,
                           audio_bed=None, fill_noise=None):
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

    fill_noise is an input index (like audio_bed) pointing at NOISE_ASSET.
    When given, the HOLD gaps this function would otherwise fill with anullsrc
    silence are filled with room tone from that input instead: the head hold,
    and the trail hold (which already includes the Raise round-up extension,
    folded in by the caller). Room tone is a patch over a frozen frame, so it
    fills nothing else — a slowed main segment and a silent source's main
    segment are gaps too, but each runs the full length of the picture it
    carries, which would make the room tone a bed under moving video rather
    than a patch; both stay pure silence.

    Noise is also never audible at the same time as the A1 bed. The head hold
    is inherently safe (the bed is delayed past it — see audio_bed above), but
    the trail hold sits at the sequence's end with the bed still summed over
    it, so passing audio_bed and fill_noise TOGETHER silences the trail gap:
    with a bed loaded, only the head hold gets room tone. (Consequence worth
    knowing: a bed shorter than the sequence leaves its own tail silent, and
    that tail is not noise-filled either — the rule is enforced by gap
    position, not by measuring how far the bed actually reaches.)

    Nothing else changes — a clip's real audio is never touched, and the gap
    LENGTHS are identical either way, so switching noise on or off cannot move
    a single sample of dialogue or change any video frame.
    The asset is only ~3s, so each gap aloops it and atrims to the exact
    quantized gap length; a 10s hold works. Every gap reads the SAME input
    pad, which ffmpeg auto-splits (verified) — unlike a filter-produced
    label, a raw input pad needs no explicit asplit. Requires no_audio to be
    False for the same reason a bed does: there is no audio graph to fill.

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
    if no_audio and fill_noise is not None:
        raise ValueError("fill_noise cannot be used with no_audio=True: there is no audio graph to fill")

    # Which KINDS of gap room tone is allowed to fill. Two rules, both about
    # noise never being heard alongside real audio:
    #
    #  * "hold" gaps only. A slowed segment's gap and a silent source's body
    #    are gaps too, but they run as long as the picture they carry, so
    #    filling them turns room tone into a bed under the video instead of a
    #    patch over a frozen frame. Those stay pure silence.
    #  * With an A1 bed, the TRAIL gap drops back to silence as well. The bed
    #    is summed over the whole sequence (amix, at the end of this function),
    #    and the trail hold — tail hold plus the Raise round-up, folded
    #    together by the caller — sits at the sequence's END, under the bed;
    #    that is the one place noise and the bed would sound at once. The HEAD
    #    gap needs no such guard: the bed is delayed past it by construction
    #    (bed_offset_sec below), so the head hold is bed-free. Both halves of
    #    that rely on the same caller contract the bed offset already does —
    #    lead holds only on clip 0, trail holds only on the last clip.
    noise_gaps = {"head_hold"} if audio_bed is not None else {"head_hold", "trail_hold"}

    def gap_chain(duration, label, kind):
        """Emit the chain filling one `duration`-second audio gap into `label`.

        The one place gap audio is generated, so silence and noise can never
        disagree about a gap's LENGTH — only about what it contains. `duration`
        is always an already-frame-quantized value from the caller. `kind` is
        "head_hold", "trail_hold", or "body", and decides only whether this gap
        is eligible for room tone (see noise_gaps above); the emitted length is
        identical either way.
        """
        if fill_noise is None or kind not in noise_gaps:
            return (f"anullsrc=channel_layout={channel_layout}:sample_rate={sample_rate}:"
                    f"duration={duration}{label}")
        # size is the per-iteration sample count aloop buffers; the asset is
        # far shorter than this cap, so one iteration holds all of it and
        # loop=-1 repeats it forever. atrim then cuts the stream to the exact
        # gap length, and aformat conforms it to the graph's rate/layout (the
        # asset is 48k stereo while the graph runs at sample_rate) — aformat
        # LAST, matching the per-clip and bed chains.
        return (f"[{fill_noise}:a]aloop=loop=-1:size=2147483647,"
                f"atrim=end={duration},asetpts=PTS-STARTPTS,"
                f"aformat=sample_rates={sample_rate}:channel_layouts={channel_layout}{label}")

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

        # Exact frame budget for this clip's normalized segment (see
        # clip_timing). The fps normalization filter can emit one spurious
        # duplicate frame at EOF (the concat graph runs in a 1/1000000
        # timebase, and an end timestamp landing exactly on a frame tick rounds
        # into an extra output frame), so the per-clip chain is hard-capped at
        # this count — and the audio is padded/cut to the same length — or every
        # clip boundary drifts another 1/fps out of sync.
        lead_frames, trail_frames, expected_sec = clip_timing(spec)
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
                chains.append(gap_chain(lead_frames / fps, f"[alead{i}]", "head_hold"))
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
                # stretch), so the main segment gets a gap of the stretched
                # duration, same as hold segments do — but always a SILENT one:
                # a body-length gap is not a hold (see noise_gaps).
                chains.append(gap_chain((out_sec - in_sec) / speed, f"[amain{i}]", "body"))
            elif has_audio:
                # The aformat here is load-bearing, not belt-and-braces:
                # concat negotiates its output format from its FIRST input, so
                # without it a clip whose only gap is at the TAIL puts the raw
                # source pad first and a mono/48k source silently downmixes the
                # stereo gap audio that follows (measured -4.4 dB on noise
                # fill; invisible for pure silence, since downmixed silence is
                # still silence). Normalizing every piece as it is created
                # makes the negotiation independent of piece ORDER.
                chains.append(
                    f"[{i}:a]atrim=start={in_sec}:end={out_sec},asetpts=PTS-STARTPTS{a_reverse_step},"
                    f"aformat=sample_rates={sample_rate}:channel_layouts={channel_layout}[amain{i}]"
                )
            else:
                chains.append(gap_chain(out_sec - in_sec, f"[amain{i}]", "body"))
            a_pieces.append(f"[amain{i}]")

        if trail_hold > 0:
            n_loops = max(round(trail_hold * fps) - 1, 0)
            chains.append(
                f"{trail_src}trim=start={trail_sample_start}:end={trail_sample_end},setpts=PTS-STARTPTS,"
                f"loop=loop={n_loops}:size=1:start=0,setpts=PTS-STARTPTS[vtrail{i}]"
            )
            v_pieces.append(f"[vtrail{i}]")
            if not no_audio:
                chains.append(gap_chain(trail_frames / fps, f"[atrail{i}]", "trail_hold"))
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


def _media_path_ok(p):
    """(ok, reason) for one path-looking ffmpeg argument: it must resolve inside
    INPUT_DIR or OUTPUT_DIR, and an input must already exist. Shared by
    validate_ffmpeg_command (the chat assistant's approved commands) and
    validate_extra_encode_args (the export settings' free-text field) so
    "a path ffmpeg is allowed to touch" has exactly one definition."""
    abs_p = p if os.path.isabs(p) else os.path.join(PROJECT_ROOT, p)
    resolved = os.path.realpath(abs_p)
    in_input = resolved.startswith(os.path.realpath(INPUT_DIR) + os.sep)
    in_output = resolved.startswith(os.path.realpath(OUTPUT_DIR) + os.sep)
    if not (in_input or in_output):
        return False, f"path outside input/output: {p!r}"
    if in_input and not os.path.exists(resolved):
        return False, f"input file does not exist: {p!r}"
    return True, None


def _looks_like_path(tok):
    """Whether a lone argument value should be treated as a filesystem path and
    put through _media_path_ok. Deliberately narrow: most values in an encoder
    flag fragment are not paths ("hvc1", "+faststart", "60"), and running the
    containment check on those would reject the whole field. A bare media
    filename counts — an accidental output name typed into extra args is the
    realistic mistake, and it has no slash in it."""
    return (os.sep in tok or tok.startswith("~")
            or tok.lower().endswith(MEDIA_EXTENSIONS))


def validate_extra_encode_args(text):
    """Parse the "custom" mode's Advanced extra args field into an argv list.
    Returns (ok, reason, args) — the same shape validate_ffmpeg_command uses,
    and reached through the same two pieces of machinery: shlex.split for
    tokenizing, and _media_path_ok for any token that looks like a path.

    An empty/blank field is valid and yields []. As with
    validate_ffmpeg_command, no character blocklist is applied to argument
    CONTENTS: these args land in a list handed to subprocess.run (never
    shell=True), so ; ( ) $ are inert bytes in one argv element. What is
    rejected instead is structural:

      - the fragment must start with a flag, so a stray output filename or a
        pasted whole `ffmpeg ...` command is caught rather than being appended
        as a second output;
      - flags this mode already owns or that would break the render, per
        _EXTRA_ARG_CONFLICTS (ffmpeg takes the LAST occurrence of a flag, so an
        unrejected duplicate would silently override a settings field);
      - any path-looking token that isn't inside input/ or output/.
    """
    if not isinstance(text, str):
        return False, "extra args must be a string", None
    if not text.strip():
        return True, None, []
    try:
        tokens = shlex.split(text)
    except ValueError as e:
        return False, f"could not parse: {e}", None
    if not tokens:
        return True, None, []

    if tokens[0] in ("ffmpeg", FFMPEG):
        return False, "give flags only, not a whole ffmpeg command", None
    if not tokens[0].startswith("-"):
        return False, f"must start with a flag, got {tokens[0]!r}", None

    for tok in tokens:
        if tok in _EXTRA_ARG_CONFLICTS:
            return False, f"{tok} is not allowed here ({_EXTRA_ARG_CONFLICTS[tok]})", None
        if _looks_like_path(tok):
            ok, reason = _media_path_ok(tok)
            if not ok:
                return False, reason, None

    return True, None, tokens


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
        ok, reason = _media_path_ok(p)
        if not ok:
            return False, reason, None

    return True, None, argv
