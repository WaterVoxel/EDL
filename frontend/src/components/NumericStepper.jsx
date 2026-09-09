// Numeric input with the same compact ▲/▼ up-down steppers used by the
// timeline transport's timecode field, replacing the browser-native
// number-input spinners for a consistent look.
//
// The field is `text-[8px]`, matching every button and label in the clip-tool
// row it lives in (it was 10px until 0.74.3, the one thing in that row drawn at
// a different size). All three call sites — Hold's duration, Trim's in/out and
// A1 Noise's dB — sit in that row, so the size belongs here rather than as a
// per-caller prop. The transport's own timecode field is NOT this component and
// stays 10px: it is on a different row, and it is read while playing.
export default function NumericStepper({
  value, onChange, onStep, step = 0.1, min = 0, max = Infinity,
  disabled = false, width = 'w-11', title,
}) {
  function handleStep(dir) {
    if (onStep) { onStep(dir); return }
    const n = parseFloat(value)
    const base = Number.isNaN(n) ? 0 : n
    const next = Math.max(min, Math.min(base + dir * step, max))
    // Trim float noise (0.30000000000000004 -> 0.3)
    onChange(String(parseFloat(next.toFixed(4))))
  }

  return (
    <div className="flex items-center gap-0.5">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        title={title}
        className={`${width} px-1.5 py-0.5 text-[8px] rounded bg-neutral-950 border border-neutral-700 text-neutral-300 disabled:opacity-50`}
      />
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => handleStep(1)}
          disabled={disabled}
          className="w-3 h-2.5 flex items-center justify-center text-[7px] text-neutral-500 hover:text-white disabled:opacity-40"
        >▲</button>
        <button
          type="button"
          onClick={() => handleStep(-1)}
          disabled={disabled}
          className="w-3 h-2.5 flex items-center justify-center text-[7px] text-neutral-500 hover:text-white disabled:opacity-40"
        >▼</button>
      </div>
    </div>
  )
}
