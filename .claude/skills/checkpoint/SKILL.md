---
name: checkpoint
description: Save the current session state before clearing context
---

Review the current conversation and update `.claude/docs/current-work.md` so the next session can resume seamlessly.

## Steps

1. Read `.claude/docs/current-work.md` as it stands now.

2. Rewrite it (overwrite stale entries rather than appending forever) with:
   - **Current task** — what is in progress right now, in one or two sentences, including which files are mid-change.
   - **Decisions made** — decisions taken this session *and the reasons behind them*, especially user choices from questions asked (these are otherwise lost with the context).
   - **What was tried and rejected** — approaches that failed or were abandoned, and why, so the next session doesn't repeat them.
   - **Next steps** — concrete, ordered actions the next session should take first.

3. Keep the whole file under one page. Facts that are permanently true about the project belong in the other docs (architecture.md, gotchas.md, …) — move them there instead of letting them rot in the checkpoint.

4. If nothing is in progress, reset the sections to their empty placeholders.
