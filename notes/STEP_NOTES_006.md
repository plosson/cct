# Step 006 — Sidebar with Projects & Sessions

## What was done

Added a left sidebar for managing projects (folders on disk) alongside the existing tabbed terminal area.

**New files:**
- `src/main/services/ProjectStore.js` — CRUD + JSON persistence in `app.getPath('userData')/projects.json`
- `src/main/ipc/project.ipc.js` — IPC handlers bridging renderer to ProjectStore
- `tests/step-006-sidebar-projects.spec.js` — 12 Playwright e2e tests
- `docs/plans/2026-02-28-sidebar-projects-sessions.md` — design/implementation plan

**Modified files:**
- `index.html` — added sidebar HTML structure, wrapped terminal area in `.app-body > .main-area`
- `styles/base.css` — sidebar CSS, horizontal flex layout
- `src/main/preload.js` — added `projects` namespace to context bridge
- `src/renderer/index.js` — sidebar rendering, project-to-session tracking, session counts
- `main.js` — wired up ProjectStore + project IPC registration

**Resulting behavior:** Users see a "Projects" sidebar on the left. The "+" button opens a native folder picker. Added projects appear as items with session counts. Clicking a project spawns a new tab whose terminal starts in that folder's directory. Removing a project closes all its sessions. Projects persist across app restarts via JSON file.

## Choices made

- **Native folder picker over drag-and-drop**: Simpler to implement, standard macOS UX, sufficient for the current step. Drag-and-drop can be added later.
- **`addPath(folderPath)` alongside `add()`**: The `add()` method opens the native dialog (for real users), but `addPath()` allows programmatic addition without dialogs — essential for tests. Without this, tests would need to mock the native dialog.
- **Flat project list (no folders/hierarchy)**: YAGNI — the reference project (claude-terminal) has folders and nesting, but that's overkill for step 006. A flat list is simpler and matches the spec.
- **`_cctReloadProjects` test helper**: Tests add projects via IPC (bypassing the dialog), but the renderer's in-memory list needs to sync. Rather than adding a complex event system, a simple test helper function reloads from the store and re-renders. Mirrors the existing `_cctGetBufferText` pattern.

## Architecture decisions

- **ProjectStore as a main-process service**: Follows the TerminalService pattern — a class instantiated in `main.js`, accessed via IPC handlers. Keeps file I/O in the main process where it belongs.
- **Persistence in `app.getPath('userData')`**: Standard Electron convention. The file lives at `~/Library/Application Support/cct/projects.json` on macOS.
- **Session-to-project mapping via `projectPath` field**: Each session in the renderer's Map now carries an optional `projectPath`. This enables counting sessions per project and closing them when a project is removed. No changes to TerminalService needed — it already accepted `cwd`.
- **Sidebar re-renders on session create/close**: `renderSidebar()` is called after `createSession()` and `closeTab()` to keep session counts accurate. Full re-render is fine at this scale.
- **Layout change from column to nested flex**: `.app` remains column (titlebar + app-body). New `.app-body` is row (sidebar + main-area). `.main-area` is column (tab-bar + terminals). Clean nesting.

## How it was tested

12 Playwright e2e tests covering all acceptance criteria from STEPS.md:

1. Sidebar is visible
2. Empty project list on clean start
3. Add project via IPC → appears in sidebar
4. Click project → new tab spawned in that folder (verified with `pwd`)
5. Session count shows 1
6. Add second project → both visible
7. Second project shows 0 sessions
8. Second click on first project → count updates to 2
9. Remove project → sessions closed, removed from sidebar
10. App restart → projects persist
11. JSON config file contains expected structure
12. Step 005 tab behaviors still work (regression)

Full suite: 51 tests passing (steps 001-006), 16.9s total.

**Test pattern notes:** `electronApp.evaluate` with `require()` doesn't work in Playwright's Electron context — modules aren't available via eval in the main process sandbox. All file/dir operations in tests use Node.js directly (tests run in Node) or go through IPC. Temp directories created with `fs.mkdirSync` in the test process, added to the app via the `addPath` IPC.

## Lessons / gotchas

- **`electronApp.evaluate` ≠ full Node.js**: The `require` function isn't available inside `electronApp.evaluate()` callbacks in Playwright. This tripped up the initial test design. Solution: use Node.js APIs directly in test code for file operations, and IPC for app-level operations.
- **Sidebar doesn't auto-sync with IPC-added projects**: When tests add a project via `addPath` IPC, the renderer's in-memory list doesn't update automatically. The `_cctReloadProjects` helper bridges this gap. In a real UX flow (via `add()` which uses the dialog), the renderer updates immediately because `addProject()` in the renderer calls the IPC and pushes to the local array in one flow.
- **No changes to TerminalService**: The `cwd` parameter was already supported since step 003. This step only needed to pass it through from the renderer when spawning project sessions.
