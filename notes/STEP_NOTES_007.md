# Step 007 — Window State Persistence

## What was done

Added window state persistence so the app remembers its position, size, and maximized state across restarts.

**New files:**
- `src/main/services/WindowStateService.js` — reads/writes `window-state.json` from `userData`, debounced saves (300ms), validates saved position against current displays
- `tests/step-007-window-state.spec.js` — 7 Playwright tests

**Modified files:**
- `main.js` — imports and instantiates `WindowStateService`, passes it to `createMainWindow()`, registers IPC handlers for sidebar width (`get-sidebar-width`, `set-sidebar-width`, `get-window-state-path`)
- `src/main/windows/MainWindow.js` — accepts optional `windowStateService` parameter for initial bounds, calls `windowStateService.track(win)` to attach listeners
- `src/main/preload.js` — added `windowState` namespace with `getSidebarWidth()`, `setSidebarWidth()`, `getConfigPath()`

**Resulting behavior:**
- Window position/size saved on move, resize, maximize, and close
- On restart, window opens at saved position and size
- If saved position is off-screen (monitor disconnected), falls back to defaults (centered 1200×800)
- Maximized state restored on startup
- Sidebar width also persisted (used by step 008)

## Choices made

- **Debounced saves (300ms)**: Window resize fires dozens of events per second. Debouncing avoids excessive disk I/O while still capturing the final state quickly.
- **Immediate save on close**: The `close` event triggers an immediate flush to ensure state isn't lost if the debounce timer hasn't fired yet.
- **Display validation**: Checks saved bounds against `screen.getAllDisplays()` to handle monitor changes. Uses 100px visible threshold — at least 100px of the window must be visible on some display.
- **Separate file from projects.json**: Window state has different semantics (machine-specific, transient) vs project list (portable, intentional). Separate files avoid coupling.
- **Optional parameter to createMainWindow**: Non-breaking change — existing code works without WindowStateService, making the migration incremental.

## Architecture decisions

- **Service pattern**: Follows the same pattern as `ProjectStore` — a main-process service with file-backed persistence, accessed via IPC.
- **Track method**: `windowStateService.track(win)` encapsulates all listener attachment. The service owns the window lifecycle connection, keeping `MainWindow.js` focused on window creation.
- **Sidebar width in WindowStateService**: The sidebar is a visual preference tied to the window, not a project-level setting. Storing it alongside window bounds keeps related state together.

## How it was tested

7 Playwright tests:

1. Config file exists after launch
2. Config file is valid JSON with expected shape
3. Window bounds are stored after resize (move to 100,100 and resize to 900×600)
4. Stored width/height match actual window size
5. Window state file path is accessible via IPC
6. Sidebar width defaults to a reasonable value
7. Sidebar width can be set and retrieved via IPC

All 7 tests pass. Full suite: 63 tests in ~26s.

## Lessons / gotchas

- **File must exist immediately**: Test 1 checks for file existence right after launch. Initially the file was only written on first state change. Fixed by writing defaults in `_load()` when the file doesn't exist.
- **Display validation is essential for macOS**: Users with external monitors will hit this when they disconnect and relaunch. The 100px visible threshold is generous but covers the common case.
