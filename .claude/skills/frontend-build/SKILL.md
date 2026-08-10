---
name: frontend-build
description: Build and lint the React frontend — run after every frontend change to catch compile errors
---

This project has no test suite for the frontend; the build is the compile check. Run it after every frontend edit.

## Steps

1. Must run from `frontend/` — running from the repo root fails with `[UNRESOLVED_ENTRY] Cannot resolve entry module index.html`:

   ```bash
   cd /Users/sarmieaj/Documents/Claude/ffmpeg/frontend
   eval "$(/opt/homebrew/bin/brew shellenv)"
   npx vite build 2>&1 | tail -8
   ```

   Success looks like `✓ built in ~100ms` with `dist/assets/index-*.js` sizes printed. `dist/` is gitignored and nothing serves it — the build exists purely as a compile check.

2. Optionally lint (oxlint, not eslint):

   ```bash
   npm run lint
   ```

## Testing pure logic modules

`clipMath.js`, `analyzeMath.js`, `timecode.js`, and `fileList.js` are import-clean ES modules — unit-test them directly with node, no build needed:

```bash
node --input-type=module -e "
import { clipMainSec } from '/Users/sarmieaj/Documents/Claude/ffmpeg/frontend/src/clipMath.js'
console.assert(clipMainSec({inSec: 0.5, outSec: 2.5, speed: 0.5}) === 4.0)
console.log('PASS')
"
```

(`crypto.randomUUID` is available in this node, so `analyzeMath.js` works too.)
