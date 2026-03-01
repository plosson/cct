# Step 016 — Confirm Before Closing with Active Sessions

## What was done

Added a confirmation dialog when the user tries to close the window while terminal sessions are still running. This prevents accidental loss of work.

**Modified files:**
- `src/main/windows/MainWindow.js` — added `close` event handler with `dialog.showMessageBoxSync()`, `setTerminalService()` and `forceCloseWindow()` exports, `forceClose` flag
- `main.js` — wired `setTerminalService()` after creating terminal service, added `forceCloseWindow()` call in `before-quit` handler

**New files:**
- `tests/step-016-close-confirm.spec.js` — 6 Playwright tests

**Resulting behavior:**
- Clicking the window close button (red dot on macOS) with active sessions shows a native dialog: "You have N active terminal session(s). Closing the window will terminate all running sessions."
- "Close" button proceeds with closing
- "Cancel" button aborts the close (window stays open)
- `Cmd+Q` (app quit) skips the dialog — `before-quit` sets `forceClose = true` before the window `close` event fires
- Playwright's `electronApp.close()` also skips the dialog (uses `app.quit()`)
- No dialog when there are 0 active sessions

## Choices made

- **Native dialog (`dialog.showMessageBoxSync`)**: Synchronous dialog that blocks the close event. The `close` event must be handled synchronously — if we call `e.preventDefault()`, the close is cancelled. Async dialogs don't work here.
- **`forceClose` flag pattern**: Used by VS Code and many Electron apps. The `before-quit` handler sets a flag so the window `close` event can check it and skip the dialog.
- **Cancel as default button**: `defaultId: 1` makes "Cancel" the default. This is safer — pressing Enter accidentally won't close the app.
- **Plural-aware message**: Shows "1 active terminal session" or "N active terminal sessions" depending on count.

## Architecture decisions

- **`setTerminalService()` function**: MainWindow needs access to TerminalService to check session count, but TerminalService is created after the window. Using a setter avoids circular dependencies.
- **`forceCloseWindow()` exported**: Called from `before-quit` in `main.js`. Sets `forceClose = true` and then calls `mainWindow.close()`. This ensures the close event fires but skips the dialog.
- **Dialog lives in MainWindow, not main.js**: The close confirmation is a window-level concern. MainWindow owns the close event handler.
- **No test environment check**: Instead of adding a `CCT_SKIP_CLOSE_CONFIRM` env variable, the `forceClose` flag handles the test case naturally: Playwright calls `app.quit()` which triggers `before-quit` → `forceCloseWindow()`.

## How it was tested

6 Playwright tests:

1. Terminal count is 0 when no sessions exist
2. Terminal count increases when sessions are created (1 session → count 1)
3. Terminal count with multiple sessions (2 sessions → count 2)
4. Terminal count decreases when session is closed (2 → 1)
5. App closes gracefully via `app.quit()` even with active sessions (verifies `forceClose` works — no dialog blocking)
6. App relaunches cleanly after force close (sidebar visible)

All 6 tests pass. Full suite: 138 tests in ~66s.

## Lessons / gotchas

- **`before-quit` vs `close` event ordering**: On macOS, `Cmd+Q` triggers `before-quit` → then `close` on each window. Clicking the red close button triggers only `close` (no `before-quit`). This distinction is critical for the `forceClose` flag logic.
- **`dialog.showMessageBoxSync` blocks the event loop**: This is intentional — the `close` event handler must be synchronous. Using `showMessageBox` (async) would cause the window to close before the user responds.
- **Session count from TerminalService, not renderer**: Using `terminalService.count()` (main process) rather than asking the renderer via IPC. The main process has the authoritative count of PTY processes.
