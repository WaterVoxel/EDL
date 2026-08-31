// The folder row, and the two icons + indent rule that go with it. Shared by the
// Media Bin and the Export Bin so a folder looks and behaves identically in both;
// only the FILE rows differ between the panels (a source file has a + and a track
// tag, a render has a timestamp), which is why those stayed in the panels.
//
// Stroked 24-grid icons in the house style (see FrameGrabButtons) rather than a
// glyph, because ▶ and ★ next to a 📁 emoji would read as three different eras.
export function FolderIcon({ plus = false }) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 6.5a1.8 1.8 0 0 1 1.8-1.8h3.3a1.8 1.8 0 0 1 1.4.7l1.1 1.4h7.2a1.8 1.8 0 0 1 1.8 1.8v8.7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V6.5Z" />
      {plus && <path d="M12 10.8v5" />}
      {plus && <path d="M9.5 13.3h5" />}
    </svg>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 5.5l7 6.5-7 6.5" />
    </svg>
  )
}

// Left padding per nesting level, in px, applied as an inline style because the
// depth is computed — Tailwind can't generate a class for a runtime value. 8px is
// the `px-2` every row used before folders nested, so a top-level row is
// unchanged and each level below steps in by 14.
const ROW_PAD = 8
const INDENT_PX = 14
export const rowPad = depth => ROW_PAD + INDENT_PX * depth

// `bin` is the useBinFolders instance; `onContextMenu` stays with the panel
// because the two bins render their menus differently.
export default function BinFolderRow({ row, bin, onContextMenu }) {
  const {
    foldersForcedOpen, setFolderOpen, editingFolder, setEditingFolder,
    commitFolderName, cancelFolderName, dragFolder, dropFolder, canDropInto,
    endDrag, handleFolderDragStart, handleRowDragOver, handleRowDrop,
  } = bin
  return (
    <li
      onContextMenu={onContextMenu}
      // A folder drags whole, contents and subfolders with it. Not while its name
      // is being edited, or the drag would steal the caret.
      draggable={editingFolder !== row.name}
      onDragStart={e => handleFolderDragStart(e, row.name, row.parent)}
      onDragEnd={endDrag}
      onDragOver={e => handleRowDragOver(e, row.name)}
      onDrop={e => handleRowDrop(e, row.name)}
      style={{ paddingLeft: rowPad(row.depth) }}
      className={`flex items-center gap-1.5 pr-2 py-1 text-[11px] ${
        dragFolder === row.name ? 'opacity-40' : ''
      } ${
        dropFolder === row.name && canDropInto(row.name)
          ? 'bg-indigo-900/40 ring-1 ring-inset ring-indigo-400'
          : 'hover:bg-neutral-800/70'
      }`}
    >
      <button
        onClick={() => setFolderOpen(row.name, !row.open)}
        disabled={foldersForcedOpen}
        title={foldersForcedOpen ? 'Folders stay open while a filter is active' : row.open ? 'Collapse' : 'Expand'}
        className="shrink-0 w-3 h-4 flex items-center justify-center text-neutral-500 enabled:hover:text-neutral-300 disabled:opacity-40"
      ><ChevronIcon open={row.open} /></button>
      <span className="shrink-0 text-neutral-500"><FolderIcon /></span>
      {editingFolder === row.name ? (
        /* Mounted straight into edit mode by the hook's newFolder, so a new
           folder is named in one gesture. Enter blurs (blur commits), Escape
           cancels via the hook's ref, and keystrokes are stopped here so
           Backspace never reaches the list's own key handler. */
        <input
          autoFocus
          defaultValue={row.name}
          onFocus={e => e.target.select()}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            else if (e.key === 'Escape') { e.preventDefault(); cancelFolderName() }
          }}
          onBlur={e => commitFolderName(row.name, e.target.value)}
          className="flex-1 min-w-0 px-1 py-0 text-[9px] rounded bg-neutral-950 border border-indigo-500 text-neutral-200 outline-none"
        />
      ) : (
        <button
          onClick={() => { if (!foldersForcedOpen) setFolderOpen(row.name, !row.open) }}
          onDoubleClick={() => setEditingFolder(row.name)}
          title={foldersForcedOpen ? 'Double-click to rename' : 'Click to open or close, double-click to rename'}
          className="flex-1 min-w-0 text-left"
        ><span className="block truncate text-[9px] text-neutral-300">{row.name}</span></button>
      )}
      <span
        title={`${row.count} file${row.count === 1 ? '' : 's'} inside, including any in subfolders`}
        className="shrink-0 text-[9px] text-neutral-600"
      >{row.count}</span>
    </li>
  )
}
