# Step 028 — Project Context Menu (Reveal in Finder, Copy Path, Remove)

## What was done

Added a right-click context menu to sidebar projects with three options: Reveal in Finder, Copy Path, and Remove Project.

**Modified files:**
- `main.js` — added `shell-show-item-in-folder` IPC handler using Electron's `shell.showItemInFolder()`
- `src/main/preload.js` — exposed `shell.showItemInFolder` via context bridge
- `src/renderer/index.js` — added `contextmenu` event listener on sidebar project elements, `showProjectContextMenu()` function, `_cctGetProjectContextMenuItems` test helper

**New files:**
- `tests/step-028-project-context-menu.spec.js` — 5 Playwright tests

**Resulting behavior:**
- Right-click a project in the sidebar to get a context menu
- "Reveal in Finder" opens Finder with the project folder highlighted
- "Copy Path" copies the project's absolute path to the system clipboard
- "Remove Project" removes the project (same as the × button)

## Choices made

- **Electron `shell.showItemInFolder`**: The standard Electron API for revealing items in the system file manager. Cross-platform (Finder on macOS, Explorer on Windows).
- **IPC round-trip for shell**: `shell.showItemInFolder` must run in the main process. Added a dedicated IPC handler rather than exposing the shell module directly in preload.
- **Reused existing context menu infrastructure**: The same `api.contextMenu.show()` pattern used for tab context menus.

## Architecture decisions

- **Consistent context menu pattern**: Both tab and project context menus use the same IPC-based `show-context-menu` handler, which builds a native `Menu` and returns the selected action.
- **Clipboard reuse**: "Copy Path" reuses the same `api.clipboard.writeText()` already exposed for terminal clipboard operations (step 023).

## How it was tested

5 Playwright tests:

1. Project context menu items are correct (3 items: Reveal in Finder, Copy Path, Remove Project)
2. `shell.showItemInFolder` API is available in preload bridge
3. Copy Path writes project path to clipboard
4. Project item element exists and is visible
5. Reveal in Finder IPC handler exists and doesn't throw

All 5 tests pass.

## Lessons / gotchas

- **`shell` module in main process**: `shell.showItemInFolder` is a main-process API. Can't call it directly from the renderer even with the `shell` module available in Node.js — must go through IPC under context isolation.
