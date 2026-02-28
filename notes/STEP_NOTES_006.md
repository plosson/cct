# Step 006 — Sidebar with Projects & Sessions

## What was done

Added a left sidebar for managing projects (folders on disk) with project-scoped sessions. Sessions always belong to a project. Switching projects switches the visible tab set.

**New files:**
- `src/main/services/ProjectStore.js` — CRUD + JSON persistence in `app.getPath('userData')/projects.json`
- `src/main/ipc/project.ipc.js` — IPC handlers bridging renderer to ProjectStore
- `tests/step-006-sidebar-projects.spec.js` — 12 Playwright e2e tests
- `docs/plans/2026-02-28-sidebar-projects-sessions.md` — design/implementation plan

**Modified files:**
- `index.html` — added sidebar HTML structure, empty state element, wrapped terminal area in `.app-body > .main-area`
- `styles/base.css` — sidebar CSS, selected project highlight, empty state, horizontal flex layout
- `src/main/preload.js` — added `projects` namespace to context bridge
- `src/renderer/index.js` — project-scoped sessions, sidebar rendering, project selection, tab visibility switching
- `main.js` — wired up ProjectStore + project IPC registration
- `tests/step-003-xterm-shell.spec.js` — updated to create a project before spawning sessions
- `tests/step-004-claude-session.spec.js` — updated to create a project before spawning sessions
- `tests/step-005-tabbed-terminals.spec.js` — updated for project-scoped model, test 9 now verifies empty state instead of auto-create

**Resulting behavior:**
- No terminal on launch — empty state says "Add a project to get started"
- Sidebar "+" opens native folder picker to add projects
- Clicking a project **selects** it (highlighted in sidebar)
- Selected project's tabs are shown; other projects' tabs are hidden (not closed)
- Tab bar "+" creates a new session under the selected project
- Removing a project closes all its sessions
- Projects persist across app restarts via JSON file

## Choices made

- **Project-scoped sessions (not free-floating)**: All sessions belong to a project. No orphan tabs. This models the real workflow — you work in a project folder.
- **Select-then-create (not click-to-spawn)**: Clicking a project selects it and shows its tabs. Creating a session is a separate action ("+"). This avoids accidental session creation.
- **Empty states for each scenario**: "Add a project to get started" (no projects), "No sessions — click + to create one" (project selected, no sessions), "Select a project from the sidebar" (projects exist but none selected).
- **Native folder picker over drag-and-drop**: Simpler to implement, standard macOS UX.
- **`addPath(folderPath)` alongside `add()`**: Programmatic addition for tests, native dialog for users.
- **`_cctReloadProjects` + `_cctSelectProject` test helpers**: Tests add projects via IPC but the renderer's in-memory list needs syncing. Simple helpers bridge the gap.

## Architecture decisions

- **ProjectStore as a main-process service**: Follows the TerminalService pattern — instantiated in `main.js`, accessed via IPC. File I/O stays in main process.
- **Persistence in `app.getPath('userData')`**: Standard Electron convention (`~/Library/Application Support/cct/projects.json`).
- **`selectedProjectPath` state in renderer**: Drives tab visibility filtering. When switching projects, all sessions' tab/panel visibility is toggled based on `projectPath` match.
- **Tab visibility via `style.display`**: Tabs for non-selected projects get `display: none`. Panels get `active` class removed. Simple, no DOM thrashing.
- **`activateTab` scoped to same project**: When activating a tab, only deactivates sibling tabs from the same project, not all tabs globally.
- **No auto-create on close-last-tab**: Closing the last tab in a project shows empty state instead of auto-creating. Users explicitly create sessions.
- **Layout**: `.app` (column: titlebar + app-body) → `.app-body` (row: sidebar + main-area) → `.main-area` (column: tab-bar + terminals).

## How it was tested

12 Playwright e2e tests for step 006:

1. Sidebar is visible
2. Empty project list + empty state on clean start
3. Add project via IPC → appears in sidebar
4. Click project selects it, "+" creates session in that folder (verified with `pwd`)
5. Session count shows 1
6. Add second project → both visible
7. Second project shows 0 sessions, first shows 1
8. Create second session under first project → count updates to 2
9. Switching projects switches visible tabs (project 2 tabs hidden, project 1 tabs shown)
10. Remove project → sessions closed, removed from sidebar
11. App restart → projects persist
12. Config file contains expected JSON structure

All older test files (003-005) updated to create a temp project in `beforeAll` before spawning sessions. Step 005 test 9 changed from "auto-creates new tab" to "shows empty state".

Full suite: **51 tests passing** (steps 001-006), 16.8s total.

## Lessons / gotchas

- **`electronApp.evaluate` ≠ full Node.js**: `require` isn't available in Playwright's Electron evaluate context. Use Node.js APIs directly in test code for file ops, IPC for app-level operations.
- **Test setup complexity**: Since sessions now require a project, every test file that uses terminals needs project setup in `beforeAll`. Added `_cctSelectProject` test helper to programmatically select a project from tests.
- **No changes to TerminalService**: The `cwd` parameter was already supported since step 003. The entire project-scoping logic lives in the renderer.
- **Tab visibility vs. DOM removal**: Hiding tabs with `display: none` is simpler and faster than removing/re-adding DOM nodes. Terminal state (xterm buffers) is preserved across project switches since panels stay in the DOM.
