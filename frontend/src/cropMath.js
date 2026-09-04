// Crop presets: fixed target resolutions the user picks from, grouped by
// the two supported output tiers. Grouped as [group, options] so the UI can
// render them as <optgroup>s in source order.
export const CROP_PRESETS = [
  ['480p', [
    { label: '864×496 (16:9)', w: 864, h: 496 },
    { label: '752×560 (4:3)', w: 752, h: 560 },
    { label: '640×640 (1:1)', w: 640, h: 640 },
    { label: '560×752 (3:4)', w: 560, h: 752 },
    { label: '496×864 (9:16)', w: 496, h: 864 },
    { label: '992×432 (21:9)', w: 992, h: 432 },
  ]],
  ['720p', [
    { label: '1280×720 (16:9)', w: 1280, h: 720 },
    { label: '1112×834 (4:3)', w: 1112, h: 834 },
    { label: '960×960 (1:1)', w: 960, h: 960 },
    { label: '834×1112 (3:4)', w: 834, h: 1112 },
    { label: '720×1280 (9:16)', w: 720, h: 1280 },
    { label: '1470×630 (21:9)', w: 1470, h: 630 },
  ]],
]

export function findPreset(key) {
  if (!key) return null
  for (const [, options] of CROP_PRESETS) {
    const found = options.find(o => `${o.w}x${o.h}` === key)
    if (found) return found
  }
  return null
}

export function presetKey(preset) {
  return preset ? `${preset.w}x${preset.h}` : ''
}

// The crop box's size in SOURCE pixels: exactly the preset's own pixel
// dimensions whenever they fit inside the source frame — picking "864x496"
// crops a literal 864x496 region, it does not get magnified to fill the
// frame. Only scaled DOWN (preserving aspect ratio), and only when the
// preset is larger than the source in some dimension, so cropping never
// exceeds what the source actually has. Snapped to even dimensions
// (libx264 yuv420p requires even width/height) — except square (1:1)
// presets, which snap to a multiple of SQUARE_CROP_STEP so a downscaled
// 1:1 box still lands on a valid free-scale resolution.
export function cropBoxSize(preset, sourceW, sourceH) {
  if (!preset || !sourceW || !sourceH) return null
  const scale = Math.min(1, sourceW / preset.w, sourceH / preset.h)
  if (preset.w === preset.h) {
    const n = Math.max(SQUARE_CROP_STEP, Math.floor((preset.w * scale) / SQUARE_CROP_STEP) * SQUARE_CROP_STEP)
    return { w: n, h: n }
  }
  const w = Math.max(2, Math.floor((preset.w * scale) / 2) * 2)
  const h = Math.max(2, Math.floor((preset.h * scale) / 2) * 2)
  return { w, h }
}

// Does the source frame have EXACTLY this preset's aspect ratio?
//
// Cross-multiplies integers instead of comparing w/h quotients: 1920/1080 and
// 1280/720 are the same ratio but not reliably the same double, and any
// epsilon-based test would need a tolerance that also swallows the 480p tier,
// whose presets are deliberately approximate — 864×496 is 1.7419, a full 2.02%
// off a true 16:9, and 1:1 is the only 480p entry that is exact (every 720p
// entry is). Cross-multiplication has no tolerance to tune and no float error
// to reason about, so "same aspect ratio" means the same thing here, in
// app.py's validation, and in a user's head.
export function isExactAspectMatch(preset, sourceW, sourceH) {
  if (!preset || !sourceW || !sourceH) return false
  return sourceW * preset.h === sourceH * preset.w
}

// FIT rather than CUT. When the source is the preset's exact aspect ratio AND
// larger than it, picking that preset scales the WHOLE frame down into the
// preset's box instead of cutting a preset-sized region out of the middle: a
// 960×960 source against the 640×640 preset keeps all of the picture rather
// than the 44% a centred cut leaves. Because the ratios are exactly equal the
// scale is uniform on both axes, so nothing stretches and the result lands on
// the preset's exact pixel dimensions.
//
// Requires source > preset because this app never upscales (see cropBoxSize):
// a 320×320 source against the 640×640 preset ALREADY yields a whole-frame box
// today, so there is nothing for fit to improve there, and magnifying it would
// invent a behaviour nobody asked for. That bound is why fit only ever changes
// clips that were losing picture, and never changes one that wasn't.
export function fitsWholeFrame(preset, sourceW, sourceH) {
  return isExactAspectMatch(preset, sourceW, sourceH) && sourceW > preset.w
}

// Is this crop a fit? A fit carries the scaled-down output size; a plain cut
// has no fitW/fitH. Every other module asks through this rather than
// re-deriving the rule from a preset and a source resolution, so there is one
// place the answer can change.
export function isFitCrop(crop) {
  return !!(crop && crop.fitW && crop.fitH)
}

// The whole crop decision for one preset: the box in source pixels, where it
// sits, and — for a fit — the size that box is scaled down to at render. This
// is CropForm's single entry point so the fit rule cannot be applied in one
// place and forgotten in another.
export function cropForPreset(preset, sourceW, sourceH) {
  if (!preset || !sourceW || !sourceH) return null
  if (fitsWholeFrame(preset, sourceW, sourceH)) {
    // Box = the entire frame at the origin. Nothing is cut away, so there is
    // no region to position: the render scales this down to fitW × fitH.
    return { w: sourceW, h: sourceH, x: 0, y: 0, fitW: preset.w, fitH: preset.h }
  }
  const box = cropBoxSize(preset, sourceW, sourceH)
  const origin = centeredCropOrigin(box, sourceW, sourceH)
  return { w: box.w, h: box.h, x: origin.x, y: origin.y, fitW: null, fitH: null }
}

// Center a box of size {w, h} inside a source frame — the default position
// before the user drags it anywhere.
export function centeredCropOrigin(box, sourceW, sourceH) {
  return {
    x: Math.floor((sourceW - box.w) / 2 / 2) * 2,
    y: Math.floor((sourceH - box.h) / 2 / 2) * 2,
  }
}

// Smallest crop box side, in source pixels (even, for libx264 yuv420p).
export const MIN_CROP_SIZE = 16

// Square (1:1) crops are constrained to resolutions divisible by 32 (a
// common AI-model input grid — see AboutDialog) rather than the general
// even-pixel snap, so a square free-scale drag always lands on a valid size.
export const SQUARE_CROP_STEP = 32

// Aspect-locked resize from the bottom-right corner. The top-left corner
// (anchorX, anchorY) stays pinned; the box grows/shrinks toward the pointer
// (pointerX/pointerY, in source pixels) while keeping its current w:h ratio,
// so the preset's aspect is preserved. A single scale factor drives both
// sides — the ratio can't drift — chosen from whichever axis the pointer
// pushed further, then clamped: never below MIN_CROP_SIZE, never past the
// source edge from the anchor. Result is even-snapped — except for square
// (1:1) boxes, which snap to the nearest multiple of SQUARE_CROP_STEP.
export function resizeCropBox(w, h, anchorX, anchorY, pointerX, pointerY, sourceW, sourceH) {
  if (!w || !h) return { w, h }
  const isSquare = w === h
  const sx = (pointerX - anchorX) / w
  const sy = (pointerY - anchorY) / h
  let scale = Math.max(sx, sy)
  // Floor: neither side may fall below the minimum.
  scale = Math.max(scale, MIN_CROP_SIZE / w, MIN_CROP_SIZE / h)
  // Ceiling: the box must stay inside the frame measured from the anchor.
  scale = Math.min(scale, (sourceW - anchorX) / w, (sourceH - anchorY) / h)
  if (isSquare) {
    const maxSide = Math.min(sourceW - anchorX, sourceH - anchorY)
    const maxStep = Math.max(SQUARE_CROP_STEP, Math.floor(maxSide / SQUARE_CROP_STEP) * SQUARE_CROP_STEP)
    const n = Math.min(maxStep, Math.max(SQUARE_CROP_STEP, Math.round((w * scale) / SQUARE_CROP_STEP) * SQUARE_CROP_STEP))
    return { w: n, h: n }
  }
  const nw = Math.max(MIN_CROP_SIZE, Math.round((w * scale) / 2) * 2)
  const nh = Math.max(MIN_CROP_SIZE, Math.round((h * scale) / 2) * 2)
  return { w: nw, h: nh }
}

// Clamp a crop origin so the box of size {w, h} stays fully inside the
// source frame, snapped to even pixels.
export function clampCropOrigin(x, y, box, sourceW, sourceH) {
  const maxX = Math.max(0, sourceW - box.w)
  const maxY = Math.max(0, sourceH - box.h)
  return {
    x: Math.round(Math.min(Math.max(x, 0), maxX) / 2) * 2,
    y: Math.round(Math.min(Math.max(y, 0), maxY) / 2) * 2,
  }
}
