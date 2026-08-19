# Proposal: named, saved export-settings profiles

Status: **superseded — do not implement this plan.** Named, saved export
settings now ship, but built to a different spec: the FFmpeg Custom Settings
window (top-bar gear, `FfmpegCustomSettings.jsx`). Read this file only for the
reasoning it records (the JSON-vs-YAML-vs-XML argument still holds); the plan
below no longer matches the code.

What shipped instead, and why it diverged:

- **What a profile contains.** This doc scopes a profile to `output_dir` +
  `quality`. The delivered feature saves the full encode configuration of the
  new `custom` quality mode (target size, safety headroom, codec, speed preset,
  profile, pixel format, maxrate/bufsize multipliers, raw extra args) and does
  **not** include `output_dir` — the request that drove the work was about
  encoder settings, and folding a directory into the same bundle would make
  "load a preset" quietly relocate someone's exports.
- **Where they live.** Not one JSON file per profile in a new `profiles/`
  directory: a `presets` list *inside* `.export_settings.json`, plus a copy
  inside each `.nara` project (the user asked for project-scoped persistence).
  Import/Export of a single settings file covers the "profile as a file on
  disk" use case this doc wanted the directory for.
- **Routes.** No four new CRUD routes and no `ProfileLibrary.jsx`: the existing
  `GET`/`POST /api/export_settings` carries the list, with POST changed to a
  *partial* update so the two dialogs writing to that document can't clobber
  each other's keys.

If per-profile `output_dir` (or a `quality`-only profile, for the five built-in
modes) is still wanted, that is a genuine gap in what shipped — but design it
as an extension of `presets`, not as the parallel system below.

## Problem

Export settings (`output_dir` + `quality`) currently live in exactly one
global file, `.export_settings.json` at the project root, edited via the
`ExportSettings.jsx` modal (`GET`/`POST /api/export_settings` in `app.py`).
There's no way to save more than one configuration — switching between,
say, "YouTube upload" (`under50mb_hevc`, a specific export folder) and
"Archive" (`lossless`, a different folder) means re-typing both fields
every time.

## Format decision: JSON

The user asked whether YAML, JSON, or XML is the better fit. **JSON.**
This project already persists everything as JSON — `.export_settings.json`
itself, and `.nara` timeline-project files — using Python's `json` module
and JS's native `JSON`, both already in use with zero new dependencies.
Neither PyYAML nor an XML library is installed in the project's `.venv`.
The data itself (flat key-value settings) has no need for YAML's
comments/anchors or XML's schema/namespace machinery. Introducing either
alternative would add a dependency for no real benefit here.

## Existing pattern this mirrors

This project already has a near-identical feature for a different kind of
saved file: the **Project Library** (`projects/*.nara` timeline saves, CRUD
via `/api/projects`, UI in `frontend/src/components/ProjectLibrary.jsx`).
The design below mirrors that CRUD shape closely rather than inventing a
new one — read `app.py` lines ~128-181 (`PROJECTS_DIR`, `list_projects`,
`save_project`, `load_project`, `delete_project`) and
`ProjectLibrary.jsx` in full before implementing, to match conventions
exactly (use of `secure_filename`, `fu.safe_path`, sorted-by-modified-time
listing, hover-reveal delete `×`, etc).

## Scope decision (already made with the user)

**Multiple named, switchable profiles** — not just a reformat of the single
existing settings file. Save the current settings under a name; later
list/load/delete saved profiles. One profile's settings become "active" at
a time by copying them into the existing `.export_settings.json` — there is
no persisted "currently active profile" pointer (see Edge cases).

## Design

### 1. Backend (`app.py`)

New directory + banner section, placed right after the existing
`# ---------- export settings ----------` block (profiles are a feature of
export settings, not of the timeline-project library):

```python
# ---------- export profiles ----------

PROFILES_DIR = os.path.join(fu.PROJECT_ROOT, "profiles")
```

**Profile file shape** — one file per profile, `profiles/<secure_filename(name)>.json`:

```json
{
  "quality": "under50mb_hevc",
  "output_dir": "/Users/you/Movies/YouTubeExports",
  "description": "For channel uploads"
}
```

- `output_dir` — key omitted entirely when the profile means "use the
  default output dir" (mirrors `.export_settings.json`'s own
  `settings.pop("output_dir", None)` convention). Never stored as `""`.
- `quality` — always present, validated against `fu.EXPORT_QUALITIES`.
- `description` — optional free text, defaults to `""`.
- No `name` field inside the file — identity is the filename, exactly like
  `.nara` projects.

**Four routes**, mirroring `list_projects`/`save_project`/`load_project`/
`delete_project` 1:1, using `fu.safe_path`/`secure_filename` for the same
path-traversal safety `projects/` already relies on:

```python
@app.route("/api/profiles", methods=["GET"])
def list_profiles():
    # os.makedirs(PROFILES_DIR, exist_ok=True); read every *.json file;
    # return [{name, modified, output_dir, quality, description}, ...].
    # Unlike list_projects (name+modified only), embed output_dir/quality/
    # description too — profile files are tiny, and previewing settings
    # before switching is the whole point of this feature.

@app.route("/api/profiles", methods=["POST"])
def save_profile():
    # data = {name, output_dir, quality, description}. name is REQUIRED
    # (400 "name is required" if blank — deliberate deviation from
    # save_project's soft default, since an anonymous profile defeats the
    # feature). Validate quality against fu.EXPORT_QUALITIES (400 on
    # mismatch, same message shape set_export_settings already uses).
    # Validate output_dir is absolute if provided, but do NOT os.makedirs
    # or isdir-check it here (unlike set_export_settings) — a saved
    # profile may legitimately point at an unmounted drive; existence is
    # only enforced at apply/render time. Write {quality, output_dir?,
    # description} to profiles/<secure_filename(name)>.json, overwriting
    # unconditionally (matches save_project's own overwrite behavior).

@app.route("/api/profiles/<name>", methods=["GET"])
def load_profile(name):
    # fu.safe_path(name, PROFILES_DIR); 404 if missing; return the raw
    # JSON dict. Identical shape to load_project.

@app.route("/api/profiles/<name>", methods=["DELETE"])
def delete_profile(name):
    # fu.safe_path(name, PROFILES_DIR); 404 if missing; os.remove.
    # Identical shape to delete_project. Never touches .export_settings.json
    # even if this profile happens to be the one currently "active" (see
    # Edge cases) — there is no tracked active-profile pointer to clean up.
```

**Applying a profile needs no new "apply" endpoint.** The frontend does a
`GET /api/profiles/<name>` followed by the *existing*
`POST /api/export_settings` with that profile's `{output_dir, quality}`.
This means loading a profile behaves exactly like a user manually retyping
those two fields and clicking Save — same validation, same
mkdir-if-missing, same error surface — and automatically inherits
`get_output_dir()`'s existing `os.path.isdir(custom)` fallback-to-default
behavior with zero new backend logic. If a profile's saved `output_dir` no
longer exists on disk, applying it goes through `set_export_settings`'s
existing `os.makedirs` attempt (succeeds if the parent still exists, 400s
if not); the profile file itself is never touched by a failed apply.

### 2. Frontend

**`frontend/src/api.js`** — four new thin wrappers, matching the existing
project functions' exact shape:

```js
export const listProfiles = () => fetch('/api/profiles').then(r => r.json())
export const saveProfile = (name, profile) => postJSON('/api/profiles', { name, ...profile })
export const loadProfile = (name) => fetch(`/api/profiles/${encodeURIComponent(name)}`).then(r => r.json())
export const deleteProfile = (name) => fetch(`/api/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(r => r.json())
```

**UI: hybrid** — an inline picker/save-as row inside `ExportSettings.jsx`
(the fast, one-click path) plus a new `ProfileLibrary.jsx` modal (mirroring
`ProjectLibrary.jsx`'s list/delete UI) for full management. A pure separate
top-level modal would be disconnected from the settings form it affects;
pure-inline-only can't comfortably fit a scrollable, delete-capable list.

`ExportSettings.jsx` additions:
- New state: `profiles`, `activeProfileName` (session-local UI label only —
  never persisted, since there's no "active profile" concept server-side),
  `showSaveAs`/`newProfileName`, `showProfileLibrary`, `profileError`.
- `useEffect` loads `listProfiles()` on mount.
- One centralized `applyProfile(name)` — does the GET+POST sequence above,
  then updates local `dir`/`quality` state — used by both the inline
  `<select>` and `ProfileLibrary`'s row-click, so the apply logic lives in
  exactly one place.
- `handleSaveAsProfile()` — saves the form's *currently displayed* `dir`/
  `quality` (not a fresh re-fetch of `.export_settings.json`), with a
  case-insensitive collision check against the loaded `profiles` list
  before overwriting (macOS's default filesystem is case-insensitive but
  case-preserving, so a case-sensitive JS check would miss a real
  collision) — `confirm(...)` before overwrite, matching the existing
  delete-confirm pattern.
- New JSX block above the existing "Export quality" section: a `<select>`
  of saved profiles + "Save as…" (reveals a name input) + "Manage…" (opens
  `ProfileLibrary`). Closing `ProfileLibrary` re-runs `listProfiles()` so a
  just-deleted profile doesn't linger as a stale dropdown option.

**New `frontend/src/components/ProfileLibrary.jsx`** — structurally a close
copy of `ProjectLibrary.jsx`: same overlay/modal shell, same
loading/empty/list states, same hover-reveal delete `×`. Differs in one
way: clicking a row calls `onApply(name)` directly (owned by the parent's
`applyProfile`) rather than fetching content itself, since applying a
profile is a pure backend round-trip with no client-side shape to
hydrate — unlike opening a `.nara` project, which hands raw clip data back
to `App.jsx`.

Sketch of the inline block in `ExportSettings.jsx` (adjust to match
whatever styling conventions exist in the file at implementation time):

```jsx
<div className="flex flex-col gap-1 pb-2 border-b border-neutral-800">
  <label className="text-[10px] text-neutral-400">Profile</label>
  <div className="flex gap-1.5">
    <select
      value={activeProfileName}
      onChange={e => e.target.value ? applyProfile(e.target.value) : setActiveProfileName('')}
      className="flex-1 px-2 py-1.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-200"
    >
      <option value="">— none —</option>
      {profiles.map(p => (
        <option key={p.name} value={p.name}>
          {p.name.replace(/\.json$/, '')} ({p.quality})
        </option>
      ))}
    </select>
    <button onClick={() => setShowSaveAs(v => !v)} className="px-2 py-1.5 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200">Save as…</button>
    <button onClick={() => setShowProfileLibrary(true)} className="px-2 py-1.5 text-[10px] rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200">Manage…</button>
  </div>
  {showSaveAs && (
    <div className="flex gap-1.5 mt-1">
      <input
        value={newProfileName}
        onChange={e => setNewProfileName(e.target.value)}
        placeholder="Profile name"
        className="flex-1 px-2 py-1.5 text-[11px] rounded bg-neutral-950 border border-neutral-700 text-neutral-200"
      />
      <button onClick={handleSaveAsProfile} className="px-2 py-1.5 text-[10px] rounded bg-indigo-600 text-white hover:bg-indigo-500">Save</button>
    </div>
  )}
  {profileError && <p className="text-[10px] text-red-400">{profileError}</p>}
</div>
```

### 3. Edge cases

| Case | Behavior |
|---|---|
| Overwrite on name collision (backend) | Silent — matches `save_project`'s own unconditional overwrite. |
| Overwrite on name collision (frontend) | `confirm(...)` before sending, case-insensitive comparison against the loaded `profiles` list. |
| Deleting the "active" profile | No-op against `.export_settings.json` — there's no persisted pointer from settings back to the profile they came from. Only clears the frontend's local `activeProfileName` label if it matches. |
| No rename | Out of scope, matching Project Library's own scope (delete + save-as-new only). |
| Stale/unmounted `output_dir` | `get_output_dir()`'s existing runtime `os.path.isdir` fallback is unaffected by how a value got persisted — applies automatically, no new code needed. |
| Empty name on save | 400, not a silent default — an anonymous profile defeats the point of the feature. |

## Files that would be touched

- `app.py` — `PROFILES_DIR` + 4 new routes (`list_profiles`, `save_profile`,
  `load_profile`, `delete_profile`)
- `frontend/src/api.js` — `listProfiles`/`saveProfile`/`loadProfile`/`deleteProfile`
- `frontend/src/components/ExportSettings.jsx` — profile picker/save-as UI,
  `applyProfile`/`handleSaveAsProfile`
- `frontend/src/components/ProfileLibrary.jsx` — new file, mirrors `ProjectLibrary.jsx`
- `.claude/docs/domain-glossary.md` — new "Export profile" glossary entry
- `.claude/docs/key-files.md` — `profiles/` directory row, new component row

## Verification checklist (for whenever this gets implemented)

1. Start Flask (per the `run-app` skill). Save a profile via the UI with a
   distinctive name/quality/dir; confirm `profiles/<name>.json` is written
   with the expected shape (no `output_dir` key if left blank).
2. Reload the page; confirm the profile appears in the picker with the
   right preview text, and applying it updates both the dropdown/quality
   select and `.export_settings.json` (`GET /api/export_settings`).
3. Save a second profile reusing an existing name; confirm the
   overwrite-confirm dialog fires and the file's contents actually change.
4. Delete a profile via `ProfileLibrary`; confirm the file is removed and
   the picker in `ExportSettings.jsx` no longer lists it after closing the
   library modal.
5. Apply a profile whose `output_dir` doesn't exist on disk (rename/remove
   the directory first); confirm the existing `set_export_settings` 400
   path surfaces correctly and the profile file is untouched.
6. `npx vite build` + `oxlint` clean on all changed/new frontend files.
7. Clean up any test profiles created in `profiles/` and restore
   `.export_settings.json` to its prior state; stop any Flask instance
   started for testing.
