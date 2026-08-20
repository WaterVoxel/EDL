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
          <h3 className="text-sm font-bold text-white tracking-tight">GENAI EDITOR</h3>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-white hover:bg-neutral-700 text-[13px]"
          >×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          <p className="text-[11px] text-neutral-300 leading-relaxed">
            GENAI EDITOR is a local, EDL-style video editor built on ffmpeg. Every picture edit — trim,
            split, reverse, slow down, hold, round-up, crop, overlay — is staged as a non-destructive
            decision and only applied when you press Render, which compiles the entire timeline into a
            single ffmpeg filter graph (two passes, in the size-capped modes). An edit never rewrites
            your footage: renders always write a new file to{' '}
            <span className="font-mono text-neutral-400">output/</span>.
          </p>

          <Section title="Lossless pipeline">
            <p>
              <strong>Lossless</strong> is the reference mode: H.264 at a constant quantizer of zero
              (<span className="font-mono text-neutral-400">-qp 0</span>), which preserves every
              decoded pixel bit-exactly. This is verified frame-by-frame against source hashes —
              including on 10-bit sources, where the commonly-cited{' '}
              <span className="font-mono text-neutral-400">-crf 0</span> is <em>not</em> actually
              lossless. It's also what the app falls back to when no mode has been chosen. Six modes
              live in Export Settings (⚙, in the Export Bin header), and whichever is selected there
              is what every render uses — worth a glance before you deliver:
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
              The three size-capped modes are a real promise, not an estimate. They encode twice — the
              first pass measures the picture's complexity, the second spends the byte budget against
              that map — then <strong>weigh the finished file</strong>. The budget starts at 92% of the
              cap (90% for Custom, and adjustable) as headroom for container overhead; if the result
              still overshoots, the budget is cut to 85% and it encodes again, up to four attempts
              total. If four can't make it, the render <em>fails and reports the size it actually
              reached</em> rather than quietly handing you an oversized file.
            </p>
            <p>
              <strong>Custom</strong> is the same machinery with every knob exposed — target size,
              safety headroom, codec, speed preset, profile, pixel format, rate-control multipliers
              and raw ffmpeg flags — in <strong>FFmpeg Custom Settings</strong> (the gear button in
              the top bar). Settings there can be saved as named presets, exported and imported as
              files, and travel inside the project file, so a delivery spec is set up once and
              reused. HEVC output isn't browser-playable, so previewing it in-app transcodes on the
              fly; it's a delivery format, not a working one.
            </p>
            <p>
              Audio in a timeline render is AAC, matched to — never worse than — the source's own
              bitrate (192 kb/s floor), at the highest sample rate and channel count in play. The two
              Under 50MB modes lower that floor to 96 kb/s and, when the cap is tight, will squeeze
              audio as far as 32 kb/s: video is served first, down to a hard minimum of 100 kb/s.
              Custom is different — it hands the <em>whole</em> budget to video and lets 96 kb/s-plus
              audio ride on top, which is why its retry loop earns its keep.
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
              <li><strong>Split</strong> / <strong>Trim</strong> — cuts between existing frames, copies nothing new.</li>
            </ul>
            <p>
              Every claim above is enforced by the project's own test discipline, not just asserted:
              render correctness is checked by comparing exact per-frame MD5 hashes against the
              source (<span className="font-mono text-neutral-400">ffmpeg -f framemd5</span>), never
              by eye or by a similarity metric like PSNR.
            </p>
          </Section>

          <Section title="Crop — presets, free-form, animated">
            <p>
              Crop keeps a region of a clip's frame, applied at Render time. Three ways to set the box:
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <strong>Presets</strong> — 12 fixed sizes across two tiers (480p, 720p) and six aspect
                ratios each, positioned by dragging the box on the preview.
              </li>
              <li>
                <strong>Free</strong> — drag the corners. The aspect ratio stays locked to the preset
                you started from, no side is allowed below 16px, and square boxes snap to multiples of
                32 so they stay on the grid described below.
              </li>
              <li>
                <strong>Animate</strong> — keyframe the box's <em>position</em> over the clip (the
                ANIM lane under the clip). Size is fixed for the whole animation, because a changing
                crop size would mean a changing output resolution. Only x and y interpolate; motion is
                linear between keyframes and held flat before the first and after the last. Keyframe
                times are source seconds measured from the clip's IN point, which is the one unit the
                preview and the render expression already agree on.
              </li>
            </ul>
            <p>
              The box never upscales past the source's own resolution, and its size and position land
              on even pixels, as standard 4:2:0 chroma subsampling requires. That last rule has a
              visible consequence worth knowing: ffmpeg floors the crop offset to an even number, so a
              very slow programmed pan advances in <strong>2px steps</strong> rather than continuously.
              That's deliberate — the alternative is chroma-plane misalignment.
            </p>
            <p>
              The preset pixel counts aren't round numbers — they're chosen to land close to a
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

          <Section title="Reformat">
            <p>
              Reformat is the other geometry tool, and the one exception to the stage-everything rule:
              it takes a file straight from the Media Bin, rescales the whole frame, and writes the
              result to the Export Bin immediately. Nothing about the timeline is involved and no
              framing decision is made — Crop chooses <em>which part</em> of the picture you keep,
              Reformat keeps all of it at a different size.
            </p>
            <p>
              24 bounding boxes are on offer: four tiers (480p, 720p, 1080p, 4K) × the same six aspect
              ratios as Crop. The source is contain-fitted into the box —{' '}
              <span className="font-mono text-neutral-400">scale = min(1, boxW/srcW, boxH/srcH)</span>{' '}
              — so it keeps <strong>its own</strong> aspect ratio, not the box's, and there is no pad
              step: you get whatever the proportional shrink produces, never letterboxing. The leading{' '}
              <span className="font-mono text-neutral-400">min(1, …)</span> means it will never
              upscale; ask for a bigger box than the source and the file comes back at its own size.
            </p>
            <p>
              <strong>Adaptive</strong> is a seventh choice that drops the target ratio entirely and
              keeps the source's exact ratio, sizing it to the tier's pixel budget instead:{' '}
              <span className="font-mono text-neutral-400">min(1, √(tierArea/sourceArea))</span>,
              where the budget is that tier's 16:9 area. That works because all six ratios in a tier
              land within about 4% of the same area — 1080p's six boxes are all ≈2.07–2.09 megapixels
              — so the area generalizes cleanly to an arbitrary source ratio.
            </p>
            <p>
              The scale is a single{' '}
              <span className="font-mono text-neutral-400">-vf scale=W:H</span>, with both dimensions
              floored to even pixels, and it honors whichever export quality mode is selected — so a
              Reformat under a size-capped mode goes through the same two-pass weigh-and-retry loop.
              Worth being explicit about one thing: rescaling resamples, so a Reformat is the one
              operation that cannot be bit-exact against its source even in Lossless mode. Lossless
              there means the encode adds nothing on top of the resample.
            </p>
          </Section>

          <Section title="Media In / Media Out">
            <p>
              <strong>Media Info In</strong> (left panel) inspects whatever source is selected,
              straight from ffprobe, in three groups: <em>File</em> (name, format, size, duration,
              total frames, overall bit rate), <em>Video</em> (codec, profile, resolution, frame rate,
              pixel format, bit depth, video bitrate) and <em>Audio</em> (codec, sample rate,
              channels). <strong>Media Info Out</strong> (right panel) shows the same fields for the
              rendered result.
            </p>
            <p>
              Comparing the two panels is how you confirm what a render did. In Lossless mode the
              pixel format and bit depth match the source exactly while the profile reads High 4:4:4
              Predictive. Match source and High quality pin neither profile nor pixel format, so those
              rows show whatever the encoder chose for that source — informative, but not a promise.
              Duration and total frames grow by exactly your holds, round-ups, and slow-downs.
            </p>
          </Section>

          <Section title="Edit Decision List (EDL)">
            <p>
              The timeline is an edit <em>decision</em> list, not a working copy of the media. Each
              clip on V1 is a record — source file, IN/OUT points, hold durations, reversed flag,
              playback speed, crop box and keyframes, overlay — displayed in the EDL table below the
              timeline with SMPTE-style source/record timecodes. Add clips by clicking a Media Bin
              file's +, or by dragging one or more files straight onto the V1 track — a multi-file
              drop lands as clips end to end in the order dropped, the same way A1 takes audio.
              <strong>Raise</strong> pulls a Media Bin file onto the track, <strong>Duplicate</strong>{' '}
              copies a clip with every decision intact, and <strong>Split</strong> divides one clip
              into two at the playhead.
            </p>
            <p>
              No timeline edit touches disk. Render compiles the whole list into one filter graph:
              per clip, an optional overlay composite, then crop, then an optional head freeze, the
              trimmed main body (reversed and/or time-stretched as flagged), an optional tail/round
              freeze — then everything is normalized to a common resolution and frame rate and
              concatenated into one continuous file, frame-budgeted so clip boundaries never drift.
            </p>
            <p>
              Because decisions stay data until render time, the timeline is saveable to the project
              Library (.nara JSON) and exportable as a CMX-style .edl file. Undo (Cmd/Ctrl+Z) covers
              every track from one history — V1, V2, A1, and crop keyframes on either video track —
              up to 50 steps back, with no redo. One history rather than one per track, because a
              single keystroke should mean "step back my last edit" wherever that edit was, not
              something different depending on which lane you last clicked. A whole drag (an
              edge-drag trim, a crop-box move) is one step, not one per mouse movement, and a
              render costs no step at all. Opening a project or deleting the source files clears
              the history rather than adding to it: undoing across either would restore clips
              pointing at media that is gone.
            </p>
          </Section>

          <Section title="V2 — Analyze, Batch Analyze, Reconstruct, composite">
            <p>
              V2 is a second video lane above the main track, for round-tripping edits between files.
            </p>
            <p>
              <strong>① V2 Analyzer</strong> — drop any video onto V2, and Analyze clones V1's cut
              structure onto it at identical time locations: same IN/OUT points, same hold and
              round-up durations, always played forward. Use it to conform an alternate take, a
              cleaned-up master, or an AI-processed version of the footage to the exact cuts you
              built on V1.
            </p>
            <p>
              <strong>② V2 Batch Analyzer</strong> — the plain-cut sibling, for a sequence handled as
              one file. Render V1 (or Render V2 on <em>1</em>), take that single joined file through
              an external tool in one pass, drop it back on V2, and this cuts it where V1 cuts: four
              clips on V1 give four clips on V2, at the same places. Holds count as cuts of their own
              — a head hold, a tail hold and a Raise's round-up are each a stretch of one frozen
              frame in that joined file, so each becomes its own clip (<em>Head01</em>, <em>Tail01</em>,
              <em>Round01</em>) instead of being buried inside the shot beside it. It works in
              sequence time rather than source time — the second shot in a joined file starts where
              the first one ended, not at V1 clip 2's IN point, which is exactly the case ① can't
              describe. Nothing else is copied: holds, reverse and speed are already baked into that
              footage as real frames, so re-applying them would double them. The last clip runs to
              the end of the file, so extra length an external tool added is kept rather than trimmed
              off silently — the Actions log reports it, along with any cut that fell past the end of
              a file shorter than V1.
            </p>
            <p>
              <strong>③ V2 Reconstruct</strong> — the inverse: it reads V1's decisions and undoes them,
              placing the full, untrimmed, un-reversed, hold-free original source file(s) on V2 —
              one clip per distinct source, in the order they appear. The result is the pre-edit
              state of the footage, verified bit-exact against the original.
            </p>
            <p>
              <strong>④ Render V2</strong> has an <strong>A / A/B</strong> switch. <em>A</em> renders
              the V2 track by itself to{' '}
              <span className="font-mono text-neutral-400">&lt;stem&gt;-analyzed.mp4</span>.{' '}
              <em>A/B</em> composites V2 <strong>onto</strong> V1 and renders the pair as one clip, to{' '}
              <span className="font-mono text-neutral-400">&lt;stem&gt;-composite.mp4</span> — the
              only route to a composite file.
            </p>
            <p>
              <strong>⑤ 1 / 1+</strong> — the switch beside it, deciding how many files that same
              click writes. <em>1</em> is one file, the whole track joined into a single clip.{' '}
              <em>1+</em> renders every cut on its own:{' '}
              <span className="font-mono text-neutral-400">&lt;name&gt;_01</span>,{' '}
              <span className="font-mono text-neutral-400">_02</span>… in track order, one ffmpeg
              pass each, for handing individual shots to a tool that takes one clip at a time. The
              two switches are independent — A / A/B decides what a shot contains, 1 / 1+ decides
              how it's split — and the cuts belong to whichever track the render is built from:
              V2's own clips in A, V1's in A/B. <em>1+</em> and <strong>②</strong> are the two halves
              of the same choice: send the shots out separately, or send one joined file out and cut
              it back into shots on the way in.
            </p>
            <p>
              Laid end to end a 1+ series <em>is</em> the 1 render, frame for frame (verified by
              frame hash across a head hold, a reverse, a slow-down and a tail hold). What changes
              is what being a separate file implies: each shot keeps its own resolution and frame
              rate instead of being padded up to the largest clip on the track, a size-capped
              quality mode gives every file its own budget, and A1 is left out — that lane is timed
              to the whole V1 sequence, so re-laying it under each shot would restart it at every
              cut. Holds stay the sequence's: the head hold opens the first shot, the tail and
              round-up close the last, and nothing appears in the middle that the joined render
              doesn't have.
            </p>
            <p>
              The compositing rule is the point of the feature. Crop a moving region out of V1 (crop
              box plus ANIM keyframes), render it, run it through an external tool — an AI video
              model, a grade, a cleanup pass — and drop the result on V2. It comes back the size of
              the crop box, not the size of V1. GenAI Editor recognizes that from the resolution difference
              alone, with no flag to remember, and puts it back exactly where the box was, following
              the same animated path: <strong>the crop box becomes the overlay's placement
              rectangle</strong>, and V1 itself is never cropped in a composite — the whole point is
              to lay the processed region back onto the full original frame. Pairing across several
              clips is positional: 1st V2 clip onto 1st V1 clip, each inheriting that V1 clip's own
              box and keyframes.
            </p>
            <p>
              Sizes must match the box <strong>exactly</strong>; nothing is resampled to fit. A
              513×512 file against a 512×512 box is a mistake upstream, and silently scaling it would
              bake a soft, misaligned patch into an otherwise lossless render — so those cases warn
              and are left alone. Same-resolution V2 is ordinary full-frame replacement, not a
              composite, and produces no warning. A/B mode adds one case: a V2 clip matching V1's
              source size covers the whole frame at 0,0 — unless that V1 clip is cropped, where
              "cover the frame" has two possible meanings and neither is safe to guess, so it refuses
              and says why.
            </p>
            <p>
              Under the hood each overlay gets its own{' '}
              <span className="font-mono text-neutral-400">-i</span> even when two clips reference the
              same file, and is drawn with{' '}
              <span className="font-mono text-neutral-400">overlay=…:eof_action=pass:repeatlast=0</span>{' '}
              so a short overlay stops cleanly instead of freezing on its last frame for the rest of
              the clip. Every overlay source is probed, and a placement that would run off the frame
              is rejected rather than silently clipped.
            </p>
            <p>
              Each track has its own eye toggle, and they control the render target and the frame grab
              as well as the display. The playhead, ruler, and transport always follow V1's timing.
            </p>
          </Section>

          <Section title="A1 — audio bed & room tone">
            <p>
              A1 is an audio-only track under the picture. Drop a file on it and it plays beneath the
              whole V1 sequence at <span className="font-mono text-neutral-400">volume=0.35</span>,
              summed with the clips' own audio by{' '}
              <span className="font-mono text-neutral-400">
                amix=inputs=N:duration=first:dropout_transition=0:normalize=0
              </span>{' '}
              — two inputs for a bed, three once room tone is on.
            </p>
            <p>
              <span className="font-mono text-neutral-400">normalize=0</span> is the load-bearing part.
              amix's default divides every input by the number of inputs, which would quietly drop your
              clip audio 6 dB the moment a bed was added; with normalization off it's an exact
              unity-gain sum — verified to a residual of 7.45e-09 across 485,100 samples with two
              inputs, and 3.73e-09 across 286,650 sample-frames with three (clips, a bed and room
              tone), both far under one float32 LSB. So clip audio passes through at precisely its
              own level and the bed is the only thing attenuated.{' '}
              <span className="font-mono text-neutral-400">duration=first</span> ends the mix with the
              picture, however long the bed happens to be.
            </p>
            <p>
              The bed starts where V1's <em>picture</em> starts. A head hold is a frozen frame, so the
              bed is pushed past it with{' '}
              <span className="font-mono text-neutral-400">adelay=delays=&lt;ms&gt;:all=1</span> —
              prepending real silence rather than shifting timestamps, which keeps the later
              pad-and-trim measuring from zero so the render ends flush. Two ordering details were
              found by measurement, not reasoning:{' '}
              <span className="font-mono text-neutral-400">aformat</span> must come <em>before</em> the
              pad (resampling after padding shifted the tail by 14 samples), and nowhere in the graph
              is <span className="font-mono text-neutral-400">aresample=async=1</span> used — nothing
              is permitted to silently stretch audio to fit. Length comes from the sum of the clips'
              frame-quantized durations, the same truth the picture uses; under mixed frame rates and
              slow-motion that can differ from wall-clock by up to ~0.076s, and the audio follows the
              frames. Adding a bed changes <strong>zero</strong> video frame hashes — checked across
              105 frames in four configurations.
            </p>
            <p>
              <strong>Room tone.</strong> A hold has no audio of its own, and digital silence in the
              middle of a cut is audible as a hole. The toggle fills those holes and nothing else:
              wherever the sequence carries sound, it comes out untouched at its own level; wherever
              it carries silence — holds, round-ups, slow-motion bodies, a source with no audio
              stream, the tail past the end of a short A1 track — room tone plays instead. The
              material is a 3.003s, 48 kHz stereo asset looped by{' '}
              <span className="font-mono text-neutral-400">aloop=loop=-1</span>, lifted{' '}
              <span className="font-mono text-neutral-400">+12 dB</span> to −27.0 dB RMS / −12.8 dB
              peak, conformed by <span className="font-mono text-neutral-400">aformat</span> to the
              graph's rate and layout, and summed in as one more amix input at the very end.
            </p>
            <p>
              Which stretches those are is <em>measured</em>, not guessed from layout. Python walks the
              same per-clip pieces the audio graph itself emits — lead hold, body, trail hold, the
              sub-frame slack a non-frame-aligned trim leaves — marks each as sound or silence, then
              subtracts how far the A1 track's own audio actually reaches, taken from the probed
              duration of its audio <em>stream</em> rather than its container. The complement is the
              fill. This is what the first attempt got wrong: eligibility was decided by a gap's{' '}
              <em>position</em>, which narrowed to the head hold alone as soon as anything sat on A1,
              so a timeline with a bed and no head hold — the ordinary case — had no eligible gap and
              the toggle emitted nothing at all. Measuring coverage also retires an old limitation: a
              bed padded with silence, or shorter than the sequence, now gets tone from the point its
              sound stops.
            </p>
            <p>
              Three details are load-bearing and all three came out of measurement. The asset ends with
              856 frames (17.8ms) of pure zero, so looping the file whole put a silence dropout in the
              noise floor once every 3.003s — 39 of them in a two-minute render, a 0.333 Hz pulse that
              reads as pumping. A 50ms RMS scan can't see it; a 5ms scan shows −∞. The fix is to cut
              the asset's dead tail before looping, at its own 48 kHz sample 143174, where the material
              is still at full level. Second, the fill is built <em>per clip</em> and padded to each
              clip's own frame-quantized length, so it quantizes exactly the way the picture's audio
              does; one <span className="font-mono text-neutral-400">anullsrc</span> of the total
              duration would not, because at 24 fps a frame is 44100/24 = 1837.5 samples and a 10.0s
              three-clip timeline measures 441,001 samples against 441,000 for a single span. Third,
              merging adjacent runs still shifts the last boundary by a half-sample, and{' '}
              <span className="font-mono text-neutral-400">amix</span> reads an input that ends early
              as silence — which left one literal (0, 0) sample-frame at the very end of the render.
              So the last clip's fill is built 50ms long and{' '}
              <span className="font-mono text-neutral-400">duration=first</span> cuts it, rather than
              the graph trying to land the rounding exactly.
            </p>
            <p>
              Switching the toggle cannot move a sample of existing audio or change a video frame: it
              adds one chain and widens the final amix by one input, and every other chain in the graph
              is textually identical either way. Verified by subtraction rather than by ear — on a real
              project, 240 frames with identical{' '}
              <span className="font-mono text-neutral-400">framemd5</span> on and off, the same audio
              sample count, the bed's whole 9.4167s reach differing by exactly 0.000e+00, and the only
              samples that changed being the 0.583s round-up at the end. Across a matrix of ten
              timeline shapes — no-audio sources, holds, slow-motion, reversed clips, unaligned trims,
              beds shorter and longer than the picture — not one sample-frame of tone ever landed over
              existing sound, and every silent 5ms window went to zero. Because tone plays only where
              nothing else does, it costs no headroom: the render's peak is the greater of what was
              already there and −12.8 dBFS. One caveat: room tone is applied at <em>render</em> time
              only. The in-app preview does not emulate it, so the toggle changes nothing you can hear
              until you render. The render response reports how much was filled —{' '}
              <span className="font-mono text-neutral-400">noise_fill_sec</span> against{' '}
              <span className="font-mono text-neutral-400">sequence_sec</span> — and the log line shows
              it, so &ldquo;nothing happened&rdquo; is distinguishable from &ldquo;nothing needed
              filling&rdquo;.
            </p>
            <p>
              <strong>Render A1</strong> writes the timeline's audio alone as a{' '}
              <span className="font-mono text-neutral-400">.wav</span> —{' '}
              <span className="font-mono text-neutral-400">-c:a pcm_s16le</span>, uncompressed, the
              same length as the V1 render, opening no clip as a video input at all. It rebuilds the
              bed chain node for node and runs the same fill plan against the same clip list, so it
              places tone in exactly the stretches the V1 render does — which is why it reads each
              clip's <span className="font-mono text-neutral-400">has_audio</span> even though it
              renders no clip audio: that is what tells it where the picture's own sound would be, and
              therefore where tone must stay out. Measured by subtraction against the V1 render's own
              audio — a timeline with clip audio, a head hold, a trailing hold, a silent source and a
              slow-motion clip, all three passes exactly 286,650 sample-frames long — the stem matched
              the render's A1 contribution to 3.73e-09, one thirty-second of a float32 LSB and
              therefore bit-identical once quantized. That's a usable stem, not an approximation of
              one. Asking for a stem that would be silent — room tone on, no A1 track, and every
              stretch of the sequence already carrying sound — is refused with that explanation rather
              than writing an empty file.
            </p>
          </Section>

          <Section title="Frame grabs">
            <p>
              The Preview header can hand you the current frame as a still: <strong>download</strong>{' '}
              it as a PNG, or <strong>copy</strong> it to the clipboard. Both capture at full source
              resolution, drawn 1:1 with no resampling. The canvas is sized to the smaller of the
              probed width and the decoded video width — a deliberate guard, because browsers
              sometimes report a macroblock-padded decode size and taking that at face value would
              add a strip of garbage down the edge.
            </p>
            <p>
              Downloads are named{' '}
              <span className="font-mono text-neutral-400">&lt;source&gt;_&lt;HH-MM-SS-FF&gt;.png</span>,
              so the timecode of the grab is in the filename. Copying goes through the async clipboard
              handed the encode <em>promise</em> rather than the finished blob, which is what WebKit
              requires to keep the user-gesture permission alive. You get a brief confirmation flash
              either way.
            </p>
            <p>
              What you capture is the decoded frame only — the crop box, its keyframe path, and the
              composited overlay layer are on-screen guides and aren't baked in. The eye toggles do
              matter, though: they decide which track the shared decoder is showing, and therefore
              which track you grab.
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
              every input/output path must resolve inside the project's own{' '}
              <span className="font-mono text-neutral-400">input/</span> or{' '}
              <span className="font-mono text-neutral-400">output/</span> folders, and shell metacharacters are
              inert (commands run as an argument list, never through a shell). If it passes, you get{' '}
              <strong>Run</strong> and <strong>Cancel</strong> buttons; if it fails validation, the
              rejection reason is shown and there is no way to force it through. Execution itself is
              re-validated independently and capped at 10 minutes; the proposal step is capped at 60
              seconds. <strong>New</strong> clears the visible conversation and starts a fresh session.
            </p>
            <p>
              This is the one path that can write into{' '}
              <span className="font-mono text-neutral-400">input/</span>, and only over a file that
              already exists there — it cannot create one. Read the proposed output path before
              pressing Run; everywhere else in the app, source files are only ever read.
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
              export · EDL export · <strong>Render without audio</strong> on the V1, V2 and composite
              renders (picture only; it also leaves out the A1 bed and room tone) · export-destination
              picker · right-click <strong>Rename</strong>, <strong>Show destination</strong> and{' '}
              <strong>Delete</strong> in both media bins (renaming is blocked while a clip on the
              timeline — or the A1 bed — still points at that file) · favorites, sorting, and
              filtering in both media panels.
            </p>
          </Section>

          {/* Colophon. Kept in the plain-text/box-rule style of README.txt's contact block
              rather than restyled as a Section, so the credit reads the same in both places.
              The rules are .repeat()ed so their widths can't drift (56 and 57, as in README). */}
          <div className="pt-1 pb-1 flex flex-col items-center gap-1 font-mono text-[10px] leading-relaxed text-neutral-400">
            <div className="text-neutral-700">{'═'.repeat(56)}</div>
            <div className="font-semibold tracking-[0.25em] text-indigo-400">CONTACT</div>
            <div className="text-neutral-700">{'═'.repeat(56)}</div>

            <div className="pt-1.5">Created and maintained by:</div>

            <div className="flex flex-col whitespace-pre text-neutral-300">
              <span>Name .......... Julian Sarmiento</span>
              <span>
                Email .......... &lt;
                <a
                  href="mailto:sarmieaj@amazon.com"
                  className="text-indigo-400 hover:text-indigo-300 hover:underline"
                >sarmieaj@amazon.com</a>
                &gt;
              </span>
              <span>Departament ......... VFX GenAI Specialist, PV Studio AI (7931)</span>
              <span>Location ......... LAX22-CO (Culver City,CA,US)</span>
            </div>

            <p className="pt-1.5 text-center">
              Questions, bug reports, and feature requests are welcome<br />
              through any of the channels above.
            </p>

            <div className="text-neutral-700">{'─'.repeat(57)}</div>
            <div className="text-neutral-500">&lt;08/2026&gt;</div>
            <div className="text-neutral-700">{'═'.repeat(56)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
