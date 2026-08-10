// Reformat presets: bounding boxes a source is scaled DOWN to fit inside
// (never up), one per (resolution tier, aspect ratio) combination — fixed
// numbers as given by product, mirrored exactly from
// ffmpeg_utils.REFORMAT_PRESETS so the UI's own output-size preview always
// agrees with what the backend will actually render.
export const REFORMAT_RESOLUTIONS = ['480p', '720p', '1080p', '4K']
export const REFORMAT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']

export const REFORMAT_PRESETS = {
  '480p': {
    '16:9': { w: 864, h: 496 }, '4:3': { w: 752, h: 560 }, '1:1': { w: 640, h: 640 },
    '3:4': { w: 560, h: 752 }, '9:16': { w: 496, h: 864 }, '21:9': { w: 992, h: 432 },
  },
  '720p': {
    '16:9': { w: 1280, h: 720 }, '4:3': { w: 1112, h: 834 }, '1:1': { w: 960, h: 960 },
    '3:4': { w: 834, h: 1112 }, '9:16': { w: 720, h: 1280 }, '21:9': { w: 1470, h: 630 },
  },
  '1080p': {
    '16:9': { w: 1920, h: 1080 }, '4:3': { w: 1664, h: 1248 }, '1:1': { w: 1440, h: 1440 },
    '3:4': { w: 1248, h: 1664 }, '9:16': { w: 1080, h: 1920 }, '21:9': { w: 2206, h: 946 },
  },
  '4K': {
    '16:9': { w: 3840, h: 2160 }, '4:3': { w: 3326, h: 2494 }, '1:1': { w: 2880, h: 2880 },
    '3:4': { w: 2494, h: 3326 }, '9:16': { w: 2160, h: 3840 }, '21:9': { w: 4398, h: 1886 },
  },
}

function evenFloor(n) {
  return Math.max(2, Math.floor(n / 2) * 2)
}

// Preview-only: the dimensions the backend's own contain-fit scale-down
// will produce for this source — mirrors ffmpeg_utils.py's
// reformat_scale_dims exactly (min(1, ...) never-upscale + even-pixel
// floor) so the UI can show the real output size before rendering.
function scaleDims(sourceW, sourceH, targetW, targetH) {
  const scale = Math.min(1, targetW / sourceW, targetH / sourceH)
  return { w: evenFloor(sourceW * scale), h: evenFloor(sourceH * scale) }
}

// "adaptive": keeps the SOURCE's own aspect ratio (unlike the 6 fixed
// ratios, which reshape to their own ratio) sized to roughly that
// resolution tier's pixel budget (that tier's 16:9 entry's area — every
// given ratio per tier lands within ~4% of that same area). Mirrors
// ffmpeg_utils.py's reformat_adaptive_dims exactly.
function adaptiveDims(sourceW, sourceH, resolution) {
  const { w: targetW, h: targetH } = REFORMAT_PRESETS[resolution]['16:9']
  const targetArea = targetW * targetH
  const sourceArea = sourceW * sourceH
  const scale = Math.min(1, Math.sqrt(targetArea / sourceArea))
  return { w: evenFloor(sourceW * scale), h: evenFloor(sourceH * scale) }
}

export function reformatOutputDims(resolution, ratio, sourceW, sourceH) {
  if (!resolution || !ratio || !sourceW || !sourceH) return null
  if (ratio === 'adaptive') return adaptiveDims(sourceW, sourceH, resolution)
  const target = REFORMAT_PRESETS[resolution]?.[ratio]
  if (!target) return null
  return scaleDims(sourceW, sourceH, target.w, target.h)
}
