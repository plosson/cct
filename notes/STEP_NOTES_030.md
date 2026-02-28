# Step 030 — App Version in Status Bar

## What was done

Added app version display to the status bar, fetched from package.json via `app.getVersion()`.

**Modified files:**
- `main.js` — added `get-version` IPC handler using `app.getVersion()`; fixed handler order (moved after `ipcMain` require)
- `src/renderer/index.js` — fetch version on init via `api.getVersion()`, display in status bar element
- `index.html` — added `<span data-testid="status-version">` element in status bar
- `styles/base.css` — added `.status-bar-version` style (smaller, dimmer text)

**New files:**
- `tests/step-030-app-version.spec.js` — 3 Playwright tests

**Resulting behavior:**
- Status bar shows "v0.1.0" (or whatever version is in package.json) at the far right
- Styled subtly (10px, #555) so it doesn't distract

## Choices made

- **`app.getVersion()` via IPC**: Standard Electron pattern. The version comes from `package.json`'s `version` field.
- **Position**: Far right of the status bar, after terminal size. Subtle and unobtrusive.
- **Prefixed with "v"**: Common convention for version display.

## Architecture decisions

- **Async fetch on init**: The version is fetched once during init() via `api.getVersion().then(...)`. No need to re-fetch since it doesn't change.
- **Fixed handler order**: The `get-version` IPC handler must be registered after the `ipcMain` require. Initially placed before the destructuring, causing a `ReferenceError`.

## How it was tested

3 Playwright tests:

1. Version element exists in status bar
2. Version matches package.json
3. getVersion IPC returns correct version string

All 3 tests pass.

## Lessons / gotchas

- **Handler registration order**: `ipcMain.handle('get-version', ...)` was placed before `const { ipcMain } = require('electron')`, causing a runtime error. Fixed by moving it after the require.
