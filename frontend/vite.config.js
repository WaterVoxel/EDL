import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The app's version comes from ONE file: `VERSION` at the repo root, one line,
// plain text (see CLAUDE.md). The backend reads the same file at import; nothing
// else is allowed to hold its own copy.
//
// `__dirname` is unavailable in an ESM config, hence resolving off
// `import.meta.dirname` — `frontend/` → repo root.
const ROOT = resolve(import.meta.dirname, '..')
const APP_VERSION = readFileSync(resolve(ROOT, 'VERSION'), 'utf8').trim()

// Hand the version to the client through Vite's OWN env channel, as
// `import.meta.env.VITE_APP_VERSION`. Setting it on `process.env` here is what
// makes that work: `loadEnv` runs after this config module is evaluated and
// sweeps in every `VITE_`-prefixed key it finds on `process.env`, so the value
// lands in `import.meta.env` without a `.env` file — and a `.env` file would be
// a SECOND place storing the version, which is the one thing this setup exists
// to prevent.
//
// `define: { __APP_VERSION__ }` is the more obvious tool and it is WRONG here.
// Verified against vite 8.1.5: `vite:define`'s transform starts with
// `if (this.environment.config.consumer === "client") return`, so user defines
// are applied only to bundled environments — `vite build` inlines them, the dev
// server does not, and the identifier reaches the browser undeclared. Since dev
// mode is the only supported way to run this app (see architecture.md), that
// route puts a ReferenceError in the toolbar. `import.meta.env` is injected at
// the top of every dev-served module and inlined at build, so it is the one
// channel that behaves the same in both.
process.env.VITE_APP_VERSION = APP_VERSION

// Deliberately NOT wrapped in a try: a build that cannot find the version has no
// business succeeding quietly and shipping a bundle whose footer reads
// "undefined". The backend's fallback is soft because a missing VERSION must not
// stop someone rendering; a build has no such excuse.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(APP_VERSION)) {
  throw new Error(`VERSION must be a semver string, got "${APP_VERSION}"`)
}

// package.json's `version` is a DERIVED copy, kept in step by bump_version.py.
// The package is `private: true` and never published, so nothing breaks if it
// drifts — which is exactly why it would, and why someone would then trust a
// stale number from `npm pkg get version`. Checking it here means drift cannot
// survive a build, and the build runs after every frontend change.
const pkgVersion = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')).version
if (pkgVersion !== APP_VERSION) {
  throw new Error(
    `version drift: VERSION says "${APP_VERSION}" but frontend/package.json says "${pkgVersion}". `
    + 'VERSION is canonical — run `python3 bump_version.py --sync` from the repo root.'
  )
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind IPv4 loopback explicitly. Vite's default host is the string
    // "localhost", which Node resolves to IPv6 ::1 on this machine -- the
    // dev server then answers http://localhost:5173/ but NOT
    // http://127.0.0.1:5173/ (connection refused). Pinning 127.0.0.1 serves
    // both spellings and stays loopback-only (no LAN exposure, unlike
    // host: true).
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5001',
      '/input': 'http://127.0.0.1:5001',
      '/output': 'http://127.0.0.1:5001',
      '/preview': 'http://127.0.0.1:5001',
    },
  },
})
