import { useRef, useState } from 'react'
import {
  loadBinFolders, createBinFolder, renameBinFolder, deleteBinFolder,
  moveFilesToBinFolder, moveFolderToParent, isDescendantFolder,
  folderOfFile, renameBinFolderFile, buildBinRows,
  DEFAULT_FOLDER_NAME,
} from '../fileList'

// Every piece of bin-folder behaviour that isn't a panel's own row markup: the
// persisted tree, the view state around it (collapse, inline rename, the drag in
// flight) and the handlers. Three panels mount this — the Media Bin over input/,
// the Export Bin over output/, the Project Library over projects/ — so a fix to a
// folder rule lands in all of them at once.
//
// `scope` ('input' | 'output' | 'projects') is the only difference between the
// instances. It picks the localStorage key (see fileList.foldersKey) and the
// directory named in the remove-folder confirm; nothing else here knows or cares
// which list it is running over.
//
// What stays with the PANEL rather than moving in here: the context menu (the
// panels render menus differently), row markup, and selection. Selection reaches us
// only through `actingOn`, which answers "which files does a gesture on this row
// apply to" — the Media Bin's multi-select version, or the default single row for
// a bin that has no multi-select.
//
// Rows are computed here too, from the panel's own list/sort/filter state, so
// that both bins get the same layout rules with no chance of one drifting.
export default function useBinFolders({
  scope,
  dirLabel,
  files,
  favorites,
  query,
  sortBy,
  sortDir,
  trackFilter = 'all',
  trackTags = {},
  actingOn = name => [name],
  onDragCollapse,
}) {
  // The persisted tree: { [folderName]: { parent, files: [filename] } }. A
  // grouping over the directory, not directories on disk — see fileList.js.
  const [folders, setFolders] = useState(() => loadBinFolders(scope))
  // Which folders are shut. Collapse is view state, not a preference: unlike
  // favorites and the folders themselves it isn't persisted. Seeded with EVERY
  // folder, because closed is the default — the bin opens as a short list of
  // folder names rather than every file at once, and you open what you want.
  const [collapsed, setCollapsed] = useState(() => new Set(Object.keys(loadBinFolders(scope))))
  // The folder whose name is being edited inline, or null.
  const [editingFolder, setEditingFolder] = useState(null)
  // Escape has to cancel an edit, but removing the focused input also blurs it,
  // and blur is what commits. A ref (not state) so the blur handler firing in
  // the same tick sees the flag.
  const cancelEditRef = useRef(false)
  // What the in-flight internal drag is carrying: filenames (one, or the whole
  // selection), or a single folder with everything inside it. Never both. Either
  // being set doubles as the "this is our drag, not an OS file drop" test — an
  // internal drag carries no dataTransfer items, so there is nothing on the
  // event to read.
  const [dragFiles, setDragFiles] = useState([])
  const [dragFolder, setDragFolder] = useState(null)
  // Folder under the cursor mid-drag; null means the top level.
  const [dropFolder, setDropFolder] = useState(null)
  const dragging = dragFiles.length > 0 || dragFolder !== null

  function endDrag() {
    setDragFiles([])
    setDragFolder(null)
    setDropFolder(null)
  }

  // One flat row list — folder rows and file rows interleaved in display order.
  // All of the sorting and filtering still happens in fileList, applied within
  // each folder as well as at the top level.
  const rows = buildBinRows({ files, folders, favorites, query, trackFilter, trackTags, sortBy, sortDir, collapsed, pinnedFolder: editingFolder })
  // The files a keyboard walk can reach: file rows only, in the order shown, so
  // the walk skips folder rows and anything inside a collapsed folder.
  const visibleFiles = rows.filter(r => r.type === 'file').map(r => r.file)
  // Mirrors buildBinRows' own `filtering` test. A filter forces every folder
  // open — a match inside a shut folder would be unreachable — which means the
  // collapse control genuinely can't act, so it's shown disabled rather than
  // left as a button that does nothing.
  const foldersForcedOpen = Boolean(query) || trackFilter !== 'all'
  // Highlight the list as a drop target only when dropping there would actually
  // move something — dragging a top-level file around the top level shouldn't
  // light anything up.
  const rootDropActive = dropFolder === null && (dragFolder !== null
    ? (folders[dragFolder]?.parent ?? null) !== null
    : dragFiles.some(n => folderOfFile(n, folders) !== null))

  // Whether the drag in flight may land in `folder` (null = the top level). Only
  // a folder drag can be refused: into itself, or into its own descendant, which
  // would cut that branch off from the root.
  function canDropInto(folder) {
    if (!dragging) return false
    if (dragFolder === null) return true
    return folder !== dragFolder && !(folder !== null && isDescendantFolder(folder, dragFolder, folders))
  }

  function setFolderOpen(name, open) {
    setCollapsed(prev => {
      if (open === !prev.has(name)) return prev
      const next = new Set(prev)
      if (open) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // `parent` nests the new folder inside an existing one ("New folder inside" on
  // a folder's menu); null puts it at the top level.
  function newFolder(parent = null) {
    const { folders: next, name } = createBinFolder(DEFAULT_FOLDER_NAME, folders, parent, scope)
    setFolders(next)
    // Open (a folder of this name may have been collapsed, removed and remade)
    // and go straight into rename mode, so the folder gets named in the same
    // gesture that created it rather than needing a second click. The parent has
    // to open too, or the row waiting to be named is inside something shut.
    if (parent) setFolderOpen(parent, true)
    setFolderOpen(name, true)
    setEditingFolder(name)
  }

  function commitFolderName(oldName, value) {
    setEditingFolder(null)
    if (cancelEditRef.current) { cancelEditRef.current = false; return }
    const { folders: next, name } = renameBinFolder(oldName, value, folders, scope)
    if (next === folders) return
    setFolders(next)
    // Carry the collapse state across so a renamed folder doesn't spring open.
    setCollapsed(prev => {
      if (!prev.has(oldName)) return prev
      const s = new Set(prev)
      s.delete(oldName)
      s.add(name)
      return s
    })
  }

  function cancelFolderName() {
    cancelEditRef.current = true
    setEditingFolder(null)
  }

  function removeFolder(name) {
    // Counted against what's actually in the directory, not against the stored
    // assignments — a file deleted from the bin leaves its assignment behind,
    // and the confirm must say the same number the folder row shows.
    const count = (folders[name]?.files || []).filter(n => files.some(f => f.name === n)).length
    // Direct children only: those are the ones that re-parent. What's deeper
    // moves with them, still inside them.
    const subs = Object.keys(folders).filter(k => (folders[k].parent ?? null) === name).length
    const up = folders[name]?.parent ?? null
    const where = up ? `"${up}"` : 'the top level'
    const moving = [
      count > 0 && `its ${count} file${count === 1 ? '' : 's'}`,
      subs > 0 && `its ${subs} subfolder${subs === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' and ')
    // Nothing leaves the directory — only the grouping goes — so this doesn't
    // warrant the same warning file Delete gets, just a heads-up when something's
    // inside. Subfolders keep their own contents; they just move up a level.
    if (moving && !window.confirm(`Remove the folder "${name}"? ${moving[0].toUpperCase()}${moving.slice(1)} move to ${where}. Nothing is deleted from ${dirLabel}.`)) return
    setFolders(deleteBinFolder(name, folders, scope))
  }

  // --- Dragging files and folders between folders --------------------------
  // HTML5 drag events, following the timeline's clip reorder (TimelineClip.jsx)
  // rather than conventions.md's pointer-listener idiom: this is a drag between
  // list rows, which is what the native API is for, and the two need to look
  // and feel the same.

  // Grabbing a row that's part of a multi-selection drags the whole selection;
  // grabbing anything else drags that row alone, and `onDragCollapse` lets the
  // panel narrow its selection to it so what moves is exactly what's highlighted.
  function handleFileDragStart(e, name, folder) {
    e.dataTransfer.effectAllowed = 'move'
    const names = actingOn(name)
    if (names.length === 1) onDragCollapse?.(name)
    setDragFiles(names)
    setDropFolder(folder)
  }

  function handleFolderDragStart(e, name, parent) {
    e.dataTransfer.effectAllowed = 'move'
    setDragFolder(name)
    setDropFolder(parent)
  }

  // `dragging` gates every handler so an OS file drop passing over the list is
  // left entirely to Dropzone — we never preventDefault on someone else's drag.
  // Not preventDefault-ing is also how a refused folder target (itself, or its
  // own descendant) simply won't accept the drop.
  function handleRowDragOver(e, folder) {
    if (!canDropInto(folder)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (folder !== dropFolder) setDropFolder(folder)
  }

  function handleRowDrop(e, folder) {
    if (!canDropInto(folder)) return
    e.preventDefault()
    e.stopPropagation()
    if (dragFolder !== null) setFolders(moveFolderToParent(dragFolder, folder, folders, scope))
    else setFolders(moveFilesToBinFolder(dragFiles, folder, folders, scope))
    // Dropping into a collapsed folder would swallow what arrived with no sign
    // it landed anywhere.
    if (folder) setFolderOpen(folder, true)
    endDrag()
  }

  // The keyboard-and-menu way out of a folder, so a mis-drop doesn't need a
  // second precise drag to undo. `folder` null is the top level.
  function moveFiles(names, folder) {
    setFolders(moveFilesToBinFolder(names, folder, folders, scope))
    if (folder) setFolderOpen(folder, true)
  }

  // A file renamed on disk keeps its folder — the assignment is keyed by
  // filename, exactly like the ★, so without this the file jumps to the top level.
  function carryRenamedFile(oldName, newName) {
    setFolders(prev => renameBinFolderFile(oldName, newName, prev, scope))
  }

  function fileFolder(name) {
    return folderOfFile(name, folders)
  }

  return {
    folders,
    rows,
    visibleFiles,
    foldersForcedOpen,
    collapsed,
    setFolderOpen,
    editingFolder,
    setEditingFolder,
    commitFolderName,
    cancelFolderName,
    newFolder,
    removeFolder,
    dragFiles,
    dragFolder,
    dropFolder,
    dragging,
    canDropInto,
    rootDropActive,
    endDrag,
    handleFileDragStart,
    handleFolderDragStart,
    handleRowDragOver,
    handleRowDrop,
    moveFiles,
    carryRenamedFile,
    fileFolder,
  }
}
