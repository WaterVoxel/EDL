function Section({ title, children }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wide">{title}</h4>
      <div className="text-[11px] text-neutral-300 leading-relaxed space-y-1.5">{children}</div>
    </div>
  )
}

export default function AboutDialog({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl w-[34rem] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <h3 className="text-sm font-bold text-white tracking-tight">NARA EDITOR</h3>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-white hover:bg-neutral-700 text-[13px]"
          >×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          <p className="text-[11px] text-neutral-300 leading-relaxed">
            NARA EDITOR is a local, EDL-style video editor built on ffmpeg. Every edit — trim, splice,
            reverse, slow down, hold, round-up — is staged as a non-destructive decision and only
            applied when you press Render, in a single ffmpeg pass. Source files are never modified.
          </p>

          <Section title="Lossless pipeline">
            <p>
              Renders default to <strong>mathematically lossless</strong> video: H.264 encoded with a
              constant quantizer of zero (<span className="font-mono text-neutral-400">-qp 0</span>),
              which preserves every decoded pixel bit-exactly. This is verified frame-by-frame against
              source hashes — including on 10-bit sources, where the commonly-cited{' '}
              <span className="font-mono text-neutral-400">-crf 0</span> is <em>not</em> actually
              lossless. Five alternatives live in Export Settings (⚙, in the Export Bin header) for
              when file size matters more than bit-exactness:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="text-neutral-500 border-b border-neutral-800">
                    <th className="text-left font-normal px-1.5 py-0.5">Mode</th>
                    <th className="text-left font-normal px-1.5 py-0.5">Video</th>
                    <th className="text-left font-normal px-1.5 py-0.5">Output size</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-neutral-900">
                    <td className="px-1.5 py-0.5 text-neutral-300">Lossless</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">-qp 0, High 4:4:4 Predictive</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">2–3× source (if source is lossy)</td>
                  </tr>
                  <tr className="border-b border-neutral-900">
                    <td className="px-1.5 py-0.5 text-neutral-300">Match source</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">ABR at source's own bitrate</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">≈ source size</td>
                  </tr>
                  <tr className="border-b border-neutral-900">
                    <td className="px-1.5 py-0.5 text-neutral-300">High quality</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">CRF 18</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">usually smaller than source</td>
                  </tr>
                  <tr className="border-b border-neutral-900">
                    <td className="px-1.5 py-0.5 text-neutral-300">Under 50MB</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">two-pass ABR, H.264, preset slow</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">under 50MB, measured not estimated</td>
                  </tr>
                  <tr className="border-b border-neutral-900">
                    <td className="px-1.5 py-0.5 text-neutral-300">Under 50MB (HEVC)</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">two-pass ABR, libx265 Main 10</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">same cap, better picture, far slower</td>
                  </tr>
                  <tr className="border-b border-neutral-900">
                    <td className="px-1.5 py-0.5 text-neutral-300">Custom</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">two-pass ABR, your own flags</td>
                    <td className="px-1.5 py-0.5 text-neutral-400">under your own cap</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              The size-capped modes are a real promise, not an estimate: they encode twice (the first
              pass measures the picture's complexity, the second spends the byte budget against that
              map), then <strong>weigh the finished file</strong> and re-encode 15% smaller if it
              still overshot.
            </p>
            <p>
              <strong>Custom</strong> is the same machinery with every knob exposed — target size,
              safety headroom, codec, speed preset, profile, pixel format, rate-control multipliers
              and raw ffmpeg flags — in <strong>FFmpeg Custom Settings</strong> (the gear button in
              the top bar). Settings
              there can be saved as named presets, exported and imported as files, and travel inside
              the project file, so a delivery spec is set up once and reused. HEVC output isn't
              browser-playable, so previewing it in-app transcodes on the fly; it's a delivery
              format, not a working one.
            </p>
            <p>
              Audio is AAC in every mode, matched to — never worse than — the source's own bitrate
              (192 kb/s floor; the size-capped modes drop to a 96 kb/s floor so the cap can be met),
              sample rate, and channel count.
            </p>
            <p>
              Several edits introduce <strong>zero new pixels</strong> in any mode, since they only
              rearrange or repeat frames that already exist in the source:
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li><strong>Reverse</strong> — plays existing frames back to front.</li>
              <li><strong>Hold</strong> / <strong>Round Up</strong> — freezes on one existing frame.</li>
              <li>
                <strong>Speed</strong> — stretches frame timing (
                <span className="font-mono text-neutral-400">setpts</span>) with no interpolation or
                generated frames; capped so the effective rate never drops below 12 fps.
              </li>
              <li><strong>Splice</strong> / <strong>Trim</strong> — cuts between existing frames, copies nothing new.</li>
            </ul>
            <p>
              Every claim above is enforced by the project's own test discipline, not just asserted:
              render correctness is checked by comparing exact per-frame MD5 hashes against the
              source (<span className="font-mono text-neutral-400">ffmpeg -f framemd5</span>), never
              by eye or by a similarity metric like PSNR.
            </p>
          </Section>

          <Section title="Crop resolutions & AI-model alignment">
            <p>
              Crop lets you keep a fixed-size region of a clip's frame at Render time — 12 presets
              across two size tiers (480p, 720p) and six aspect ratios each, positioned by dragging
              the box on the preview. The box never upscales past the source's own resolution, and
              its size/position always snap to even pixels (required for standard 4:2:0 chroma
              subsampling).
            </p>
            <p>
              The specific pixel counts aren't round numbers — they're chosen to land close to a
              multiple of <strong>16px</strong> in both dimensions. That unit matters for AI video
              models such as Seedance-style diffusion transformers, which downsample through an 8×
              VAE encoder and then group pixels into 2×2 patches — an 8 × 2 = 16px native processing
              grid. Feeding such a model a resolution that divides evenly by 16 (ideally 32) avoids
              it silently padding or cropping your input before generation.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="text-neutral-500 border-b border-neutral-800">
                    <th className="text-left font-normal px-1.5 py-0.5">Preset</th>
                    <th className="text-left font-normal px-1.5 py-0.5">Dimensions</th>
                    <th className="text-left font-normal px-1.5 py-0.5">÷16</th>
                    <th className="text-left font-normal px-1.5 py-0.5">÷32</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['480p 16:9', '864×496', true, false],
                    ['480p 4:3', '752×560', true, false],
                    ['480p 1:1', '640×640', true, true],
                    ['480p 3:4', '560×752', true, false],
                    ['480p 9:16', '496×864', true, false],
                    ['480p 21:9', '992×432', true, false],
                    ['720p 16:9', '1280×720', true, false],
                    ['720p 4:3', '1112×834', false, false],
                    ['720p 1:1', '960×960', true, true],
                    ['720p 3:4', '834×1112', false, false],
                    ['720p 9:16', '720×1280', true, false],
                    ['720p 21:9', '1470×630', false, false],
                  ].map(([label, dims, ok16, ok32]) => (
                    <tr key={label} className="border-b border-neutral-900">
                      <td className="px-1.5 py-0.5 text-neutral-300">{label}</td>
                      <td className="px-1.5 py-0.5 text-neutral-400">{dims}</td>
                      <td className={`px-1.5 py-0.5 ${ok16 ? 'text-emerald-400' : 'text-neutral-600'}`}>{ok16 ? '✓' : '✗'}</td>
                      <td className={`px-1.5 py-0.5 ${ok32 ? 'text-emerald-400' : 'text-neutral-600'}`}>{ok32 ? '✓' : '✗'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              9 of the 12 presets land cleanly on the 16px grid; only the two square (1:1) presets
              also divide evenly by 32. The three exceptions — 720p at 4:3, 3:4, and 21:9 — are the
              closest achievable pixel counts for that aspect ratio at the 720p tier, but don't
              divide evenly by 16 in both dimensions. If exact model-grid alignment matters for
              downstream use, prefer the 1:1 or 16:9 presets at either tier. Note that when a source
              is smaller than the chosen preset, the crop box is scaled down to fit — its size is
              then only guaranteed even-pixel (not 16-aligned) in that case.
            </p>
          </Section>

          <Section title="Media In / Media Out">
            <p>
              <strong>Media Info In</strong> (left panel) inspects whatever source is selected —
              container, duration, frame count, resolution, codec, profile, pixel format, bit depth,
              and video/audio bitrates — straight from ffprobe. <strong>Media Info Out</strong>{' '}
              (right panel) shows the same fields for the rendered result. Comparing the two panels
              is how you confirm what the render did: in Lossless mode the pixel format and bit depth
              match the source exactly while the profile reads High 4:4:4 Predictive; in Match/High
              modes the profile stays standard High. Duration and total frames grow by exactly your
              holds, round-ups, and slow-downs.
            </p>
          </Section>

          <Section title="Edit Decision List (EDL)">
            <p>
              The timeline is an edit <em>decision</em> list, not a working copy of the media. Each
              clip on V1 is a record — source file, IN/OUT points, hold durations, reversed flag,
              playback speed — displayed in the EDL table below the timeline with SMPTE-style
              source/record timecodes. Nothing touches disk until Render, which compiles the whole
              list into one ffmpeg filter graph: per clip, an optional head freeze, the trimmed main
              body (reversed and/or time-stretched as flagged), an optional tail/round freeze — then
              everything is normalized to a common resolution and frame rate and concatenated into
              one continuous file, frame-budgeted so clip boundaries never drift. Because decisions
              stay data until render time, everything is undoable (Cmd/Ctrl+Z), saveable to the
              project Library (.nara JSON), and exportable as a CMX-style .edl file.
            </p>
          </Section>

          <Section title="Analyze & Reconstruct (V2 track)">
            <p>
              V2 is a reference lane above the main track for round-tripping edits between files.
            </p>
            <p>
              <strong>① V2 Analyzer</strong> — drop any video onto V2, and Analyze clones V1's cut
              structure onto it at identical time locations: same IN/OUT points, same hold and
              round-up durations, always played forward. Use it to conform an alternate take, a
              cleaned-up master, or an AI-processed version of the footage to the exact cuts you
              built on V1.
            </p>
            <p>
              <strong>② V2 Reconstruct</strong> — the inverse: it reads V1's decisions and undoes them,
              placing the full, untrimmed, un-reversed, hold-free original source file(s) on V2 —
              one clip per distinct source, in the order they appear. The result is the pre-edit
              state of the footage, verified bit-exact against the original.
            </p>
            <p>
              <strong>③ Render V2</strong> — renders whatever is on V2 through the same lossless
              pipeline to a file in the Export Bin. Each track has its own eye toggle; the preview shows
              the topmost visible track, while the playhead, ruler, and transport always follow
              V1's timing.
            </p>
          </Section>

          <Section title="Agentic Assistant Editor">
            <p>
              The chat panel (AGENT tab, next to Timeline) turns a plain-English request into an ffmpeg command using
              a local Claude Code CLI process, run non-interactively with no tool access of its own —
              it can only propose a command as structured text, never execute anything. On the first
              message of a conversation it's told which files exist in Media Bin/Export Bin and, if a
              clip is selected on the timeline, that clip's filename as the likely target; later
              messages in the same conversation rely on the CLI's own session memory instead of
              re-sending that context.
            </p>
            <p>
              A proposed command is <strong>never run automatically</strong>. It's checked server-side
              first — must literally start with <span className="font-mono text-neutral-400">ffmpeg</span>,
              every input/output path must resolve inside{' '}
              <span className="font-mono text-neutral-400">input/</span> or{' '}
              <span className="font-mono text-neutral-400">output/</span>, and shell metacharacters are
              inert (commands run as an argument list, never through a shell). If it passes, you get{' '}
              <strong>Run</strong> and <strong>Cancel</strong> buttons; if it fails validation, the
              rejection reason is shown and there is no way to force it through. Execution itself is
              re-validated independently and capped at 10 minutes; the proposal step is capped at 60
              seconds. <strong>New</strong> clears the visible conversation and starts a fresh session.
            </p>
            <p>
              When a Run succeeds and a clip is selected, the produced file is loaded onto that clip
              in place — same treatment Reconstruct gives a fresh source: IN/OUT reset to the file's
              full length and any hold, reverse, speed, or crop staged against the old source is
              cleared, since the chat edit is now baked into new pixels and those old settings no
              longer apply. With no clip selected, the result simply appears in the Export Bin.
            </p>
          </Section>

          <Section title="Also on board">
            <p>
              Frame-accurate transport (play/stop, frame stepping, first/last frame, loop, editable
              timecode with a TC/frames toggle) · project Library with save/open · .nara project
              export · EDL export · <strong>frame grabs</strong> from the Preview header — download the
              current frame as a PNG at full source resolution, or copy it to the clipboard (the
              decoded frame only; the crop box and V2 overlay layers aren't baked in) ·{' '}
              <strong>Render without audio</strong> on any render (picture only;
              it also leaves out the A1 bed and room tone) · export-destination picker · right-click{' '}
              <strong>Rename</strong>,{' '}
              <strong>Show destination</strong> and <strong>Delete</strong> in both media bins
              (renaming is blocked while a clip on the timeline still points at that file) · favorites, sorting, and filtering in
              both media panels.
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}
