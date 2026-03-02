# Step 034 — Command-Line Invocation

## What was done

Added CLI support so users can launch CCT with a project path: `cct .` or `cct /path/to/project`.

**Files created:**
- `bin/cct` — Bash CLI wrapper that resolves the path to absolute, uses `open -a CCT.app` for packaged builds and falls back to `electron` for dev mode
- `tests/step-034-cli-invocation.spec.js` — 8 Playwright tests

**Files modified:**
- `main.js` — Added `parseProjectPath(argv)` to extract directory args from argv, `openProjectFromCLI(projectPath)` to add+select a project, enhanced `requestSingleInstanceLock` with `additionalData` to forward the project path, and `second-instance` handler to open projects from subsequent launches
- `src/main/preload.js` — Added `projects.onOpen` listener via `createListener('open-project')`
- `src/renderer/index.js` — Added `refreshProjectList()` helper to deduplicate MRU sync logic, added `api.projects.onOpen` listener that reloads projects and selects the opened one
- `package.json` — Added `"bin": { "cct": "bin/cct" }` field

## Choices made

- **Single-instance lock with `additionalData`**: Electron's `requestSingleInstanceLock({ projectPath })` passes the project path directly to the running instance via structured data, avoiding the need to re-parse argv in the `second-instance` handler. Falls back to argv parsing if `additionalData` is missing.
- **Delayed open on first launch**: The initial project path is opened via `webContents.on('did-finish-load')` with a 500ms delay, ensuring the renderer is ready to receive the IPC message.
- **Bash CLI wrapper over Node script**: A simple bash script is more portable for macOS, uses `open -a` for packaged app (proper macOS convention), and falls back to `electron` for dev mode. No Node.js dependency for the launcher itself.
- **`refreshProjectList` helper**: Extracted from duplicated code in the renderer — the same MRU sync logic was used in multiple places (project add, remove, reload). Now shared.

## Architecture decisions

- **IPC channel `open-project`**: Main process sends, renderer listens. Fits the existing fire-and-forget pattern (main → renderer) used by `terminal-data`, `terminal-exit`, etc.
- **`parseProjectPath` in main process**: Filters out flags (anything starting with `-`) and non-directory paths. Returns the first valid directory found in argv, or null.
- **Project auto-add**: When opening from CLI, the project is added to `projects.json` via `ProjectStore.addProject()` if not already present, then selected. This means `cct /some/new/path` is a one-step "add and open" operation.

## How it was tested

8 Playwright tests in `tests/step-034-cli-invocation.spec.js`:

1. **Launch with project path** — Launches Electron with a temp dir arg, verifies the project is auto-added and selected
2. **Project in sidebar** — Checks the project appears in the sidebar DOM
3. **Persisted in projects.json** — Reads the file and confirms the path is stored
4. **open-project IPC** — Adds a second project via IPC, simulates the open-project flow, verifies selection switches
5. **projects.onOpen exposed** — Confirms the preload listener is a function
6. **parseProjectPath ignores flags** — Verifies flags don't cause crashes or change project
7. **bin/cct exists and is executable** — Checks file exists with execute permission
8. **bin/cct contains open -a** — Confirms the script uses macOS `open -a` convention

All 21 tests pass (13 step-033 + 8 step-034) in ~2.8s.

## Lessons / gotchas

- **Bash empty array under `set -u`**: `"${ARGS[@]}"` fails with "unbound variable" when ARGS is empty under `set -u`. The fix is `"${ARGS[@]+\"${ARGS[@]}\"}"` which uses parameter expansion to handle the empty case.
- **`did-finish-load` timing**: Sending IPC immediately after `did-finish-load` can race with renderer initialization. The 500ms delay is a pragmatic solution — the renderer's `init()` sets up the `onOpen` listener early, but a small buffer prevents edge cases.
- **`additionalData` in single-instance lock**: This is an Electron feature that lets you pass structured data to the running instance. It's cleaner than parsing argv a second time and avoids ambiguity with Electron's own flags.
