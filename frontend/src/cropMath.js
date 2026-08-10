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
// (libx264 yuv420p requires even width/height).
export function cropBoxSize(preset, sourceW, sourceH) {
  if (!preset || !sourceW || !sourceH) return null
  const scale = Math.min(1, sourceW / preset.w, sourceH / preset.h)
  const w = Math.max(2, Math.floor((preset.w * scale) / 2) * 2)
  const h = Math.max(2, Math.floor((preset.h * scale) / 2) * 2)
  return { w, h }
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

// Aspect-locked resize from the bottom-right corner. The top-left corner
// (anchorX, anchorY) stays pinned; the box grows/shrinks toward the pointer
// (pointerX/pointerY, in source pixels) while keeping its current w:h ratio,
// so the preset's aspect is preserved. A single scale factor drives both
// sides — the ratio can't drift — chosen from whichever axis the pointer
// pushed further, then clamped: never below MIN_CROP_SIZE, never past the
// source edge from the anchor. Result is even-snapped.
export function resizeCropBox(w, h, anchorX, anchorY, pointerX, pointerY, sourceW, sourceH) {
  if (!w || !h) return { w, h }
  const sx = (pointerX - anchorX) / w
  const sy = (pointerY - anchorY) / h
  let scale = Math.max(sx, sy)
  // Floor: neither side may fall below the minimum.
  scale = Math.max(scale, MIN_CROP_SIZE / w, MIN_CROP_SIZE / h)
  // Ceiling: the box must stay inside the frame measured from the anchor.
  scale = Math.min(scale, (sourceW - anchorX) / w, (sourceH - anchorY) / h)
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
